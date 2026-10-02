import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";
import {
  ClamAvProjectStorageScanner,
  ClamdInstreamClient,
} from "@/lib/server/project-storage/clamav-scanner";
import type { ProjectStoragePrincipal, ProjectStorageScope } from "@/lib/server/project-storage/model";
import {
  S3ProjectStorageProvider,
  StaticS3ProjectStorageCredentialsProvider,
} from "@/lib/server/project-storage/provider";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import {
  MemoryProjectStorageS3AccessKeyStore,
  ProjectStorageS3AccessKeyService,
} from "@/lib/server/project-storage/s3-access-keys";
import { ProjectStorageS3Endpoint } from "@/lib/server/project-storage/s3-endpoint";
import { ProjectStorageS3SecretProtector } from "@/lib/server/project-storage/s3-secret-protector";
import {
  checksumBase64,
  encodeAwsChunkedBody,
  sha256Hex,
  signSigV4Request,
  STREAMING_SIGNED_PAYLOAD_TRAILER,
} from "@/lib/server/project-storage/s3-sigv4";
import { ProjectStorageService } from "@/lib/server/project-storage/service";

/**
 * Der S3-Endpunkt (2.96, erweitert 2.99) gegen echtes versitygw und echtes
 * ClamAV, in zwei Faellen.
 *
 * Der erste rechnet jede Signatur selbst aus `node:crypto`, so wie ein
 * S3-Client es taete, und schickt sie an den Endpunkt. Hinter dem Endpunkt
 * steht derselbe Dienst wie im Fall daneben: Das Objekt landet beim echten
 * Provider, der echte Scanner liest es, und erst sein Urteil macht es lesbar.
 * Was der Fall belegt: Ein gueltiges Paar liest und schreibt; ein
 * widerrufenes faellt; eine falsche Signatur faellt; ein fremder Bucket
 * faellt; EICAR kommt nicht durch und laesst beim Provider nichts zurueck.
 *
 * Der zweite (2.99) laesst einen **echten S3-Client** sprechen: das AWS SDK
 * fuer JavaScript (`@aws-sdk/client-s3`, devDependency), ueber eine
 * HTTP-Bruecke aus `node:http` auf 127.0.0.1 an `handle()`. Der Client
 * entscheidet selbst, wie er signiert und wie er den Koerper schickt; der
 * Fall liest am Server mit, was ankam, und belegt, dass es die Formen sind,
 * die die AWS-Werkzeuge ueber HTTP waehlen: Pruefsumme im Header bei einem
 * Puffer, `aws-chunked` mit `STREAMING-UNSIGNED-PAYLOAD-TRAILER` bei einem
 * Strom.
 *
 * Der dritte (2.101) laesst denselben Client eine Datei hochladen, die ueber
 * der Multipart-Schwelle liegt, und **er teilt sie selbst**:
 * `@aws-sdk/lib-storage` schneidet sie in Teile von 5 MiB, schickt
 * `CreateMultipartUpload`, die Teile und `CompleteMultipartUpload`, und der
 * Fall liest am Server mit, dass genau diese Anfragen kamen. Danach belegt er,
 * was am Dienstweg haengt: Die Pruefsumme der ganzen Datei rechnet der
 * Endpunkt aus dem zusammengesetzten Objekt, der echte Scanner rechnet sie
 * nach, und erst dann ist das Objekt sauber und lesbar. Ein abgebrochener
 * Upload laesst beim echten Provider keinen begonnenen Upload stehen.
 *
 * Der vierte (2.123) laesst denselben Client die beiden Operationen fahren,
 * die ein echtes Werkzeug vermisst: `UploadPartCopy` und `ListObjects` in
 * Version 1. Beim Teil aus einem vorhandenen Objekt schickt der Client keinen
 * Koerper und keine Pruefsumme; dass das Teil beim echten Provider trotzdem
 * liegt, belegt, dass die Summe von QKERN kam und versitygw sie angenommen hat.
 * Die zusammengesetzte Datei bekommt der echte Scanner, und erst sein Urteil
 * macht sie lesbar. Bei der Liste entscheidet der Client die Form: Der Fall
 * liest am Server mit, dass die Anfrage ohne `list-type` ankam, und folgt dem
 * `NextMarker`, den das SDK selbst liest.
 *
 * Der fuenfte (2.127) und der sechste (2.128) lassen zwei **fremde Werkzeuge**
 * sprechen, als eigene Prozesse ueber TCP: die AWS CLI v2 und rclone. Bis 2.73.0
 * hatte den Endpunkt nur das AWS SDK fuer JavaScript gesehen, also eine
 * Bibliothek desselben Hauses, das die Signatur beschreibt. Die CLI bringt eine
 * dritte Implementierung mit (die AWS-CRT in C), rclone eine vierte (Go, ohne
 * AWS-Code darin).
 *
 * Beide fahren dieselbe Bruecke wie die Faelle davor, und der Fall wartet nicht
 * auf einen offenen Port, sondern auf eine **echte Runde** darueber
 * (`warmBridge`): geschrieben, vom echten Scanner freigegeben, zurueckgelesen,
 * Bytes verglichen. Erst dann startet der fremde Client.
 *
 * Was die zwei gebracht haben, das vier SDK-Faelle nicht gebracht haben:
 * Die CLI waehlt eine andere Form als das SDK (gepufferter Koerper, signierte
 * Nutzlast, Pruefsumme als **Header**, CRC64NVME als Standard, `Expect:
 * 100-continue`), und ihre CRT rechnet dieselbe CRC64NVME wie `s3-sigv4.ts`.
 * Gefunden haben sie zwei echte Abweichungen, die 2.73.0 nur benannt hatte:
 * `max-keys=0` war ein Fehler statt einer leeren Liste (die CLI brach mit Code
 * 254 ab), und derselbe `CommonPrefixes`-Eintrag stand auf zwei Seiten (`aws s3
 * ls --page-size 2` druckte `PRE sync/` zweimal). Beides ist in
 * `s3-endpoint.ts` behoben, und beide Faelle halten es fest.
 *
 * Kein Next-Server im Stack: die Begruendung steht in
 * `docker-compose.storage-certification.yml`.
 */
const enabled = process.env.QKERN_TEST_STORAGE_PROVIDER_E2E === "true";
const endpoint = process.env.QKERN_TEST_STORAGE_S3_ENDPOINT ?? "http://minio:9000";
const region = process.env.QKERN_TEST_STORAGE_S3_REGION ?? "us-east-1";
const providerBucket = process.env.QKERN_TEST_STORAGE_S3_BUCKET ?? "qkern-storage-certification";
const accessKeyId = process.env.QKERN_TEST_STORAGE_S3_ACCESS_KEY_ID ?? "qkern_cert_access";
const secretAccessKey = process.env.QKERN_TEST_STORAGE_S3_SECRET_ACCESS_KEY ??
  "qkern_cert_secret_change_me_32bytes";
const clamAvHost = process.env.QKERN_TEST_STORAGE_CLAMAV_HOST ?? "clamav";
const clamAvPort = Number(process.env.QKERN_TEST_STORAGE_CLAMAV_PORT ?? "3310");

const scope: ProjectStorageScope = {
  organizationId: "00000000-0000-4000-8000-000000000501",
  projectId: "00000000-0000-4000-8000-000000000502",
  environment: "development",
};
const admin: ProjectStoragePrincipal = {
  organizationId: scope.organizationId,
  actorRef: "s3-endpoint-certification",
  role: "admin",
  subject: "00000000-0000-4000-8000-000000000503",
};
const QKERN = "http://qkern.certification.test";

describe.runIf(enabled)("real versitygw and ClamAV: the S3 endpoint", () => {
  it("(S3) lets a valid pair write, list and read through SigV4, also aws-chunked with signed blocks, and refuses a tampered block, a revoked pair, a wrong signature, a foreign bucket and EICAR", async () => {
    const { s3, keys, storage, issued, other } = await certificationRuntime();
    const payload = Buffer.from(`QKERN S3 endpoint certification ${Date.now()}`, "utf8");

    // --- gueltiges Paar schreibt: echter Provider, echter Scan ------------
    const put = await s3.handle(sign(issued, "PUT", "/s3/cert-s3/reports/2026/summary.txt", {
      body: payload, headers: { "content-type": "text/plain" },
    }));
    expect(put.status, await put.clone().text()).toBe(200);
    // `clean`, nicht `quarantined`: ClamAV hat die Bytes wirklich gesehen.
    expect(put.headers.get("x-qkern-object-status")).toBe("clean");
    const stored = await storage.listObjects(admin, scope, "cert-s3", {});
    expect(stored.objects.map((object) => [object.key, object.status])).toEqual([["reports/2026/summary.txt", "clean"]]);
    // Der Beleg, dass die Bytes beim echten Provider liegen, ist die Zusage des
    // Dienstes, eingeloest gegen versitygw: dieselben Bytes, derselbe Hash.
    const grant = await storage.createDownloadGrant(admin, scope, "cert-s3", { key: "reports/2026/summary.txt" });
    const served = await fetch(grant.url, { redirect: "error" });
    expect(served.status).toBe(200);
    expect(sha256Base64(Buffer.from(await served.arrayBuffer()))).toBe(sha256Base64(payload));

    // --- gueltiges Paar listet und liest ------------------------------------
    const list = await s3.handle(sign(issued, "GET", "/s3/cert-s3?list-type=2&prefix=reports%2F"));
    expect(list.status).toBe(200);
    const listXml = await list.text();
    expect(listXml).toContain("<Key>reports/2026/summary.txt</Key>");
    expect(listXml).toContain(`<Size>${payload.byteLength}</Size>`);
    const get = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("text/plain");
    expect(Buffer.from(await get.arrayBuffer())).toEqual(payload);
    const head = await s3.handle(sign(issued, "HEAD", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(payload.byteLength));

    // --- aws-chunked mit signierten Bloecken und signiertem Trailer (2.99) --
    // So schickt es ein AWS-Werkzeug ueber HTTP, wenn es den Koerper signiert.
    // Die Bytes landen beim echten Provider, der Scanner sieht sie.
    const chunkedPayload = Buffer.from(`QKERN aws-chunked certification ${Date.now()} `.repeat(300), "utf8");
    const chunkedPut = await s3.handle(signChunked(issued, "/s3/cert-s3/reports/2026/chunked.txt", chunkedPayload));
    expect(chunkedPut.status, await chunkedPut.clone().text()).toBe(200);
    expect(chunkedPut.headers.get("x-qkern-object-status")).toBe("clean");
    const chunkedGet = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/chunked.txt"));
    expect(Buffer.from(await chunkedGet.arrayBuffer()).equals(chunkedPayload)).toBe(true);
    // Ein Byte in einem Block: die Kette reisst, und beim Provider liegt nichts Neues.
    const tamperedPut = await s3.handle(signChunked(issued, "/s3/cert-s3/reports/2026/tampered.txt", chunkedPayload, (body) => {
      const copy = Buffer.from(body);
      copy[body.indexOf("\r\n") + 2 + 50] ^= 0xff;
      return copy;
    }));
    expect(tamperedPut.status).toBe(403);
    expect(await tamperedPut.text()).toContain("<Code>SignatureDoesNotMatch</Code>");
    expect((await storage.listObjects(admin, scope, "cert-s3", {})).objects.map((object) => object.key))
      .toEqual(["reports/2026/chunked.txt", "reports/2026/summary.txt"]);

    // --- falsche Signatur: richtiges Paar, falsches Geheimnis --------------
    const forged = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt", {
      secret: issued.secret.slice(0, -1) + (issued.secret.endsWith("A") ? "B" : "A"),
    }));
    expect(forged.status).toBe(403);
    expect(await forged.text()).toContain("<Code>SignatureDoesNotMatch</Code>");
    // Und eine Signatur, die nur einen anderen Pfad meint.
    const replayed = sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt");
    const moved = new Request(`${QKERN}/s3/cert-s3/reports/2026/other.txt`, { method: "GET", headers: replayed.headers });
    const movedResponse = await s3.handle(moved);
    expect(movedResponse.status).toBe(403);
    expect(await movedResponse.text()).toContain("<Code>SignatureDoesNotMatch</Code>");

    // --- fremder Bucket: existiert, ist der Service-Rolle sichtbar, aber nicht im Satz
    const foreign = await s3.handle(sign(issued, "GET", "/s3/cert-s3-other/anything.txt"));
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toContain("<Code>NoSuchBucket</Code>");
    const foreignPut = await s3.handle(sign(issued, "PUT", "/s3/cert-s3-other/anything.txt", {
      body: payload, headers: { "content-type": "text/plain" },
    }));
    expect(foreignPut.status).toBe(404);
    expect((await storage.listObjects(admin, scope, other.id, {})).objects).toEqual([]);
    // Das Paar des anderen Buckets liest den ersten nicht.
    const otherPair = await keys.create(admin, scope, {
      name: "Anderes Werkzeug", bucketIds: [other.id],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const crossed = await s3.handle(sign(otherPair, "GET", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(crossed.status).toBe(404);

    // --- EICAR durch den Endpunkt: abgewiesen, und beim Provider liegt nichts
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "ascii");
    const infected = await s3.handle(sign(issued, "PUT", "/s3/cert-s3/reports/eicar.txt", {
      body: eicar, headers: { "content-type": "text/plain" },
    }));
    expect(infected.status).toBe(422);
    expect(await infected.text()).toContain("<Code>QkernObjectRejected</Code>");
    expect((await storage.listObjects(admin, scope, "cert-s3", {})).objects.map((object) => object.key))
      .toEqual(["reports/2026/chunked.txt", "reports/2026/summary.txt"]);
    const eicarGet = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/eicar.txt"));
    expect(eicarGet.status).toBe(404);

    // --- widerrufenes Paar: sofort, mit derselben Antwort wie ein unbekanntes
    await keys.revoke(admin, scope, issued.key.id);
    const revoked = await s3.handle(sign(issued, "GET", "/s3/cert-s3/reports/2026/summary.txt"));
    expect(revoked.status).toBe(403);
    expect(await revoked.text()).toContain("<Code>InvalidAccessKeyId</Code>");
    const revokedPut = await s3.handle(sign(issued, "PUT", "/s3/cert-s3/reports/after-revoke.txt", {
      body: payload, headers: { "content-type": "text/plain" },
    }));
    expect(revokedPut.status).toBe(403);
    expect((await storage.listObjects(admin, scope, "cert-s3", {})).objects).toHaveLength(2);
  }, 180_000);

  it("(S3-Client) is spoken to by the AWS SDK for JavaScript over HTTP: buffer put with header checksum, stream put as aws-chunked, list, head, get, range, copy, batch delete, presigned URL, and every refusal by name", async () => {
    const { s3, keys, storage, issued } = await certificationRuntime();
    const bridge = await bridgeTo(s3);
    try {
      const client = new S3Client({
        endpoint: `${bridge.origin}/s3`, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: issued.key.accessKeyId, secretAccessKey: issued.secret },
      });
      const payload = Buffer.from(`SDK certification ${Date.now()} `.repeat(200), "utf8");

      // --- ListBuckets: nur der Satz des Paars -------------------------------
      const buckets = await client.send(new ListBucketsCommand({}));
      expect(buckets.Buckets?.map((bucket) => bucket.Name)).toEqual(["cert-s3"]);

      // --- PutObject aus einem Puffer: der Client rechnet CRC32 und signiert den Koerper
      const put = await client.send(new PutObjectCommand({ Bucket: "cert-s3", Key: "sdk/buffer.txt", Body: payload, ContentType: "text/plain" }));
      expect(put.ETag).toMatch(/^"[^"]+"$/);
      const bufferSeen = bridge.seen.find((entry) => entry.method === "PUT" && entry.path === "/s3/cert-s3/sdk/buffer.txt");
      expect(bufferSeen?.headers["x-amz-checksum-crc32"]).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(bufferSeen?.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);

      // --- PutObject aus einem Strom: der Client waehlt aws-chunked mit Trailer
      await client.send(new PutObjectCommand({
        Bucket: "cert-s3", Key: "sdk/stream.txt", Body: Readable.from([payload.subarray(0, 3000), payload.subarray(3000)]),
        ContentLength: payload.byteLength, ContentType: "text/plain",
      }));
      const streamSeen = bridge.seen.find((entry) => entry.method === "PUT" && entry.path === "/s3/cert-s3/sdk/stream.txt");
      expect(streamSeen?.headers["x-amz-content-sha256"]).toBe("STREAMING-UNSIGNED-PAYLOAD-TRAILER");
      expect(streamSeen?.headers["content-encoding"]).toContain("aws-chunked");
      expect(streamSeen?.headers["x-amz-trailer"]).toBe("x-amz-checksum-crc32");
      expect(streamSeen?.headers["x-amz-decoded-content-length"]).toBe(String(payload.byteLength));
      // Beide liegen beim echten Provider, beide vom echten Scanner freigegeben.
      const stored = await storage.listObjects(admin, scope, "cert-s3", {});
      expect(stored.objects.map((object) => [object.key, object.sizeBytes, object.status]))
        .toEqual([["sdk/buffer.txt", payload.byteLength, "clean"], ["sdk/stream.txt", payload.byteLength, "clean"]]);

      // --- List, Head, Get, Range --------------------------------------------
      const listed = await client.send(new ListObjectsV2Command({ Bucket: "cert-s3", Prefix: "sdk/" }));
      expect(listed.Contents?.map((entry) => entry.Key)).toEqual(["sdk/buffer.txt", "sdk/stream.txt"]);
      const head = await client.send(new HeadObjectCommand({ Bucket: "cert-s3", Key: "sdk/stream.txt" }));
      expect(head.ContentLength).toBe(payload.byteLength);
      expect(head.ContentType).toBe("text/plain");
      const got = await client.send(new GetObjectCommand({ Bucket: "cert-s3", Key: "sdk/stream.txt" }));
      expect(Buffer.from(await got.Body!.transformToByteArray()).equals(payload)).toBe(true);
      const range = await client.send(new GetObjectCommand({ Bucket: "cert-s3", Key: "sdk/buffer.txt", Range: "bytes=4-9" }));
      expect(range.$metadata.httpStatusCode).toBe(206);
      expect(range.ContentRange).toBe(`bytes 4-9/${payload.byteLength}`);
      expect(await range.Body!.transformToString()).toBe(payload.toString("utf8", 4, 10));

      // --- CopyObject, wie das SDK die Quelle schreibt: `bucket/key` ------------
      const copied = await client.send(new CopyObjectCommand({ Bucket: "cert-s3", Key: "sdk/copy.txt", CopySource: "cert-s3/sdk/buffer.txt" }));
      expect(copied.CopyObjectResult?.ETag).toMatch(/^"[^"]+"$/);
      const copy = await client.send(new GetObjectCommand({ Bucket: "cert-s3", Key: "sdk/copy.txt" }));
      expect(Buffer.from(await copy.Body!.transformToByteArray()).equals(payload)).toBe(true);

      // --- Presigned URL: 5 Minuten gehen, eine Stunde nicht ------------------
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: "cert-s3", Key: "sdk/copy.txt" }), { expiresIn: 300 });
      const anonymous = await fetch(url, { redirect: "error" });
      expect(anonymous.status).toBe(200);
      expect(Buffer.from(await anonymous.arrayBuffer()).equals(payload)).toBe(true);
      const hour = await getSignedUrl(client, new GetObjectCommand({ Bucket: "cert-s3", Key: "sdk/copy.txt" }), { expiresIn: 3600 });
      const refused = await fetch(hour, { redirect: "error" });
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain("<Code>AuthorizationQueryParametersError</Code>");

      // --- EICAR durch das SDK: der Fehler traegt den Namen des Scanners ------
      const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "ascii");
      const infected = await client.send(new PutObjectCommand({ Bucket: "cert-s3", Key: "sdk/eicar.txt", Body: eicar, ContentType: "text/plain" })).catch((error) => error);
      expect(infected).toBeInstanceOf(S3ServiceException);
      expect((infected as S3ServiceException).name).toBe("QkernObjectRejected");
      expect((infected as S3ServiceException).$metadata.httpStatusCode).toBe(422);

      // --- DeleteObjects: drei auf einmal, einer davon gibt es nicht ----------
      const deleted = await client.send(new DeleteObjectsCommand({
        Bucket: "cert-s3", Delete: { Objects: [{ Key: "sdk/buffer.txt" }, { Key: "sdk/copy.txt" }, { Key: "sdk/never.txt" }] },
      }));
      expect(deleted.Deleted?.map((entry) => entry.Key).sort()).toEqual(["sdk/buffer.txt", "sdk/copy.txt", "sdk/never.txt"]);
      expect(deleted.Errors ?? []).toEqual([]);
      expect((await storage.listObjects(admin, scope, "cert-s3", {})).objects.map((object) => object.key)).toEqual(["sdk/stream.txt"]);

      // --- Ein Client mit falschem Geheimnis und einer mit widerrufenem Paar --
      const forger = new S3Client({
        endpoint: `${bridge.origin}/s3`, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: issued.key.accessKeyId, secretAccessKey: issued.secret.slice(0, -1) + (issued.secret.endsWith("A") ? "B" : "A") },
      });
      const forged = await forger.send(new ListObjectsV2Command({ Bucket: "cert-s3" })).catch((error) => error);
      expect((forged as S3ServiceException).name).toBe("SignatureDoesNotMatch");
      await keys.revoke(admin, scope, issued.key.id);
      const revoked = await client.send(new ListObjectsV2Command({ Bucket: "cert-s3" })).catch((error) => error);
      expect((revoked as S3ServiceException).name).toBe("InvalidAccessKeyId");
      client.destroy();
      forger.destroy();
    } finally {
      await bridge.close();
    }
  }, 180_000);

  it("(S3-Client) is split by the AWS SDK itself above the multipart threshold: create, parts, list, complete through the same service path, the whole-file checksum verified by the real scanner, and an aborted upload leaving nothing at the provider", async () => {
    const { s3, keys, storage, provider } = await certificationRuntime();
    const bridge = await bridgeTo(s3);
    try {
      // Ein eigener Bucket und ein eigenes Paar: Der Fall daneben zaehlt die
      // Buckets seines Paars, und diese Datei ist groesser als das, was dort
      // je Objekt erlaubt ist.
      const bucket = await storage.createBucket(admin, scope, {
        name: "cert-s3-mp", readPolicy: "service", writePolicy: "service",
        allowedMimeTypes: ["text/plain"], maxObjectBytes: 32 * 1024 * 1024, quotaBytes: 96 * 1024 * 1024,
      });
      const pair = await keys.create(admin, scope, {
        name: "Zertifizierung Multipart", bucketIds: [bucket.id],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const client = new S3Client({
        endpoint: `${bridge.origin}/s3`, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: pair.key.accessKeyId, secretAccessKey: pair.secret },
      });

      // 12 MiB, also ueber der Schwelle, ab der die AWS-Werkzeuge von sich aus
      // teilen. Der Inhalt ist nicht zufaellig, damit der Vergleich am Ende
      // etwas aussagt.
      const payload = Buffer.alloc(12 * 1024 * 1024);
      for (let offset = 0; offset < payload.byteLength; offset += 64) {
        payload.write(`qkern multipart certification ${offset} `.padEnd(64, "."), offset, 64, "utf8");
      }
      const wholeFile = createHash("sha256").update(payload).digest("base64");

      const upload = new Upload({
        client,
        params: { Bucket: "cert-s3-mp", Key: "mp/big.txt", Body: payload, ContentType: "text/plain" },
        partSize: 5 * 1024 * 1024,
        queueSize: 2,
      });
      const finished = await upload.done();
      expect(finished.Key).toBe("mp/big.txt");

      // Der Client hat geteilt, nicht der Fall: drei Teile, ein Anfang, ein Abschluss.
      const started = bridge.seen.filter((entry) => entry.method === "POST" && entry.query.includes("uploads"));
      const parts = bridge.seen.filter((entry) => entry.method === "PUT" && entry.query.includes("partNumber"));
      const completed = bridge.seen.filter((entry) => entry.method === "POST" &&
        entry.query.includes("uploadId") && !entry.query.includes("uploads"));
      expect(started).toHaveLength(1);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(completed).toHaveLength(1);
      // Jedes Teil kam mit der Pruefsumme, die der Client selbst gerechnet hat.
      for (const part of parts) {
        expect(part.headers["x-amz-checksum-crc32"] ?? part.headers["x-amz-trailer"]).toBeDefined();
      }

      // Am Dienstweg gepruefte Bytes: Groesse, Urteil des echten Scanners, und
      // die Pruefsumme der ganzen Datei, die der Endpunkt aus dem
      // zusammengesetzten Objekt gerechnet hat.
      const stored = await storage.listObjects(admin, scope, "cert-s3-mp", {});
      expect(stored.objects.map((object) => [object.key, object.sizeBytes, object.status]))
        .toEqual([["mp/big.txt", payload.byteLength, "clean"]]);
      const head = await client.send(new HeadObjectCommand({ Bucket: "cert-s3-mp", Key: "mp/big.txt" }));
      expect(head.ContentLength).toBe(payload.byteLength);
      const read = await client.send(new GetObjectCommand({ Bucket: "cert-s3-mp", Key: "mp/big.txt" }));
      const readBack = Buffer.from(await read.Body!.transformToByteArray());
      expect(createHash("sha256").update(readBack).digest("base64")).toBe(wholeFile);

      // Ein zweiter Upload, diesmal ueber die einzelnen Befehle des SDK, und
      // unterwegs abgebrochen: `ListMultipartUploads` und `ListParts` sagen,
      // was offen ist, und danach steht beim echten Provider nichts mehr.
      const openUpload = await client.send(new CreateMultipartUploadCommand({
        Bucket: "cert-s3-mp", Key: "mp/abort.txt", ContentType: "text/plain",
      }));
      expect(openUpload.UploadId).toMatch(/^[0-9a-f-]{36}$/);
      const partBody = Buffer.alloc(5 * 1024 * 1024, "q");
      const firstPart = await client.send(new UploadPartCommand({
        Bucket: "cert-s3-mp", Key: "mp/abort.txt", UploadId: openUpload.UploadId, PartNumber: 1, Body: partBody,
      }));
      expect(firstPart.ETag).toMatch(/^"[^"]+"$/);
      const inFlight = await client.send(new ListMultipartUploadsCommand({ Bucket: "cert-s3-mp", Prefix: "mp/" }));
      expect(inFlight.Uploads?.map((entry) => entry.Key)).toEqual(["mp/abort.txt"]);
      const listedParts = await client.send(new ListPartsCommand({
        Bucket: "cert-s3-mp", Key: "mp/abort.txt", UploadId: openUpload.UploadId,
      }));
      expect(listedParts.Parts?.map((part) => [part.PartNumber, part.Size]))
        .toEqual([[1, partBody.byteLength]]);

      await client.send(new AbortMultipartUploadCommand({
        Bucket: "cert-s3-mp", Key: "mp/abort.txt", UploadId: openUpload.UploadId,
      }));
      const keyPrefix = `${scope.organizationId}/${scope.projectId}/${scope.environment}/`;
      expect(await provider.listMultipartUploads({ keyPrefix })).toHaveLength(0);
      const afterAbort = (await storage.listBuckets(admin, scope)).find((entry) => entry.id === bucket.id)!;
      expect(afterAbort.reservedBytes).toBe(0);
      expect(afterAbort.usedBytes).toBe(payload.byteLength);
      const gone = await client.send(new ListPartsCommand({
        Bucket: "cert-s3-mp", Key: "mp/abort.txt", UploadId: openUpload.UploadId,
      })).catch((error) => error);
      expect((gone as S3ServiceException).name).toBe("NoSuchUpload");
      expect((await client.send(new ListMultipartUploadsCommand({ Bucket: "cert-s3-mp" }))).Uploads ?? [])
        .toEqual([]);
      client.destroy();
    } finally {
      await bridge.close();
    }
  }, 300_000);

  it("(2.123) is driven by the AWS SDK through UploadPartCopy and ListObjects version 1: a part copied out of a real object, a range of it, the whole-file checksum from the real scanner, marker paging, and every refusal by name", async () => {
    const { s3, keys, storage } = await certificationRuntime();
    const bridge = await bridgeTo(s3);
    try {
      // Ein eigener Bucket: Die Faelle daneben zaehlen die Objekte ihrer
      // Buckets, und ein Teil ist hier grosser als das, was dort je Objekt
      // erlaubt ist.
      const bucket = await storage.createBucket(admin, scope, {
        name: "cert-s3-copy", readPolicy: "service", writePolicy: "service",
        allowedMimeTypes: ["text/plain"], maxObjectBytes: 32 * 1024 * 1024, quotaBytes: 96 * 1024 * 1024,
      });
      const pair = await keys.create(admin, scope, {
        name: "Zertifizierung Teilkopie", bucketIds: [bucket.id],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const client = new S3Client({
        endpoint: `${bridge.origin}/s3`, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: pair.key.accessKeyId, secretAccessKey: pair.secret },
      });

      // Die Quelle: 5 MiB, weil versitygw wie S3 nur das letzte Teil kleiner
      // als 5 MiB zusammensetzt. Der Inhalt ist nicht zufaellig, damit der
      // Vergleich am Ende etwas aussagt.
      const source = Buffer.alloc(5 * 1024 * 1024);
      for (let offset = 0; offset < source.byteLength; offset += 64) {
        source.write(`qkern upload part copy ${offset} `.padEnd(64, "."), offset, 64, "utf8");
      }
      await client.send(new PutObjectCommand({
        Bucket: "cert-s3-copy", Key: "copy/source.txt", Body: source, ContentType: "text/plain",
      }));

      // --- UploadPartCopy: ein ganzes Objekt als Teil, ein Bereich als zweites
      const started = await client.send(new CreateMultipartUploadCommand({
        Bucket: "cert-s3-copy", Key: "copy/assembled.txt", ContentType: "text/plain",
      }));
      const first = await client.send(new UploadPartCopyCommand({
        Bucket: "cert-s3-copy", Key: "copy/assembled.txt", UploadId: started.UploadId,
        PartNumber: 1, CopySource: "cert-s3-copy/copy/source.txt",
      }));
      expect(first.CopyPartResult?.ETag).toMatch(/^"[^"]+"$/);
      const second = await client.send(new UploadPartCopyCommand({
        Bucket: "cert-s3-copy", Key: "copy/assembled.txt", UploadId: started.UploadId,
        PartNumber: 2, CopySource: "cert-s3-copy/copy/source.txt", CopySourceRange: "bytes=0-1023",
      }));
      expect(second.CopyPartResult?.ETag).toMatch(/^"[^"]+"$/);

      // Der Client hat die Bytes nie gesehen: Er schickte keinen Koerper und
      // keine Pruefsumme. Beim echten Provider liegt das Teil trotzdem, und das
      // geht nur, wenn die Summe, die QKERN selbst gerechnet hat, in der
      // signierten Zusage stimmte — versitygw weist ein Teil mit falscher
      // `x-amz-checksum-sha256` mit 400 ab.
      const copyRequests = bridge.seen.filter((entry) => entry.method === "PUT" &&
        entry.headers["x-amz-copy-source"] !== undefined && entry.query.includes("partNumber"));
      expect(copyRequests).toHaveLength(2);
      for (const entry of copyRequests) {
        expect(entry.headers["content-length"] ?? "0").toBe("0");
        for (const name of Object.keys(entry.headers)) {
          expect(name.startsWith("x-amz-checksum-"), name).toBe(false);
        }
      }

      // Die Teile stehen beim Dienst mit ihren Groessen, wie bei hochgeladenen.
      const listedParts = await client.send(new ListPartsCommand({
        Bucket: "cert-s3-copy", Key: "copy/assembled.txt", UploadId: started.UploadId,
      }));
      expect(listedParts.Parts?.map((part) => [part.PartNumber, part.Size]))
        .toEqual([[1, source.byteLength], [2, 1024]]);

      const completed = await client.send(new CompleteMultipartUploadCommand({
        Bucket: "cert-s3-copy", Key: "copy/assembled.txt", UploadId: started.UploadId,
        MultipartUpload: { Parts: [
          { PartNumber: 1, ETag: first.CopyPartResult!.ETag },
          { PartNumber: 2, ETag: second.CopyPartResult!.ETag },
        ] },
      }));
      expect(completed.Key).toBe("copy/assembled.txt");

      // Der echte Scanner hat die Summe der ganzen zusammengesetzten Datei
      // bekommen und freigegeben; erst dann ist das Objekt da und lesbar.
      const assembled = Buffer.concat([source, source.subarray(0, 1024)]);
      const stored = await storage.listObjects(admin, scope, bucket.id, { prefix: "copy/" });
      expect(stored.objects.map((object) => [object.key, object.sizeBytes, object.status])).toEqual([
        ["copy/assembled.txt", assembled.byteLength, "clean"],
        ["copy/source.txt", source.byteLength, "clean"],
      ]);
      const read = await client.send(new GetObjectCommand({ Bucket: "cert-s3-copy", Key: "copy/assembled.txt" }));
      expect(createHash("sha256").update(Buffer.from(await read.Body!.transformToByteArray())).digest("base64"))
        .toBe(createHash("sha256").update(assembled).digest("base64"));

      // --- ListObjects Version 1, wie ein aelteres SDK sie schickt -----------
      // Der Client entscheidet die Form: `ListObjectsCommand` sendet GET ohne
      // `list-type`. Der Fall liest am Server mit, dass genau das ankam.
      const v1 = await client.send(new ListObjectsCommand({ Bucket: "cert-s3-copy", Prefix: "copy/" }));
      expect(v1.Contents?.map((entry) => entry.Key)).toEqual(["copy/assembled.txt", "copy/source.txt"]);
      expect(v1.IsTruncated).toBe(false);
      // Das SDK schreibt den Bucket mit Schraegstrich am Ende (`/s3/{bucket}/`),
      // so wie bei Version 2; beides ist derselbe Bucket ohne Schluessel.
      const v1Seen = bridge.seen.filter((entry) => entry.method === "GET" &&
        entry.path.replace(/\/$/, "") === "/s3/cert-s3-copy" && !entry.query.includes("uploadId"));
      expect(v1Seen.length).toBeGreaterThanOrEqual(1);
      expect(v1Seen.every((entry) => !entry.query.includes("list-type"))).toBe(true);

      // Fortsetzung mit marker/NextMarker, vom SDK selbst gelesen und gesetzt.
      const page = await client.send(new ListObjectsCommand({ Bucket: "cert-s3-copy", Prefix: "copy/", MaxKeys: 1 }));
      expect(page.Contents?.map((entry) => entry.Key)).toEqual(["copy/assembled.txt"]);
      expect(page.IsTruncated).toBe(true);
      expect(page.NextMarker).toBe("copy/assembled.txt");
      const rest = await client.send(new ListObjectsCommand({
        Bucket: "cert-s3-copy", Prefix: "copy/", Marker: page.NextMarker,
      }));
      expect(rest.Contents?.map((entry) => entry.Key)).toEqual(["copy/source.txt"]);
      expect(rest.IsTruncated).toBe(false);

      // Delimiter und CommonPrefixes in v1, wie in v2.
      const grouped = await client.send(new ListObjectsCommand({ Bucket: "cert-s3-copy", Delimiter: "/" }));
      expect(grouped.CommonPrefixes?.map((entry) => entry.Prefix)).toEqual(["copy/"]);
      expect(grouped.Contents ?? []).toEqual([]);

      // --- Jede Weigerung mit ihrem Namen, durch das SDK ---------------------
      const open = await client.send(new CreateMultipartUploadCommand({
        Bucket: "cert-s3-copy", Key: "copy/refused.txt", ContentType: "text/plain",
      }));
      const beyond = await client.send(new UploadPartCopyCommand({
        Bucket: "cert-s3-copy", Key: "copy/refused.txt", UploadId: open.UploadId, PartNumber: 1,
        CopySource: "cert-s3-copy/copy/source.txt", CopySourceRange: `bytes=0-${source.byteLength}`,
      })).catch((error) => error);
      expect((beyond as S3ServiceException).$metadata.httpStatusCode).toBe(416);
      const foreign = await client.send(new UploadPartCopyCommand({
        Bucket: "cert-s3-copy", Key: "copy/refused.txt", UploadId: open.UploadId, PartNumber: 1,
        CopySource: "cert-s3/sdk/buffer.txt",
      })).catch((error) => error);
      expect((foreign as S3ServiceException).name).toBe("NoSuchBucket");
      const missing = await client.send(new UploadPartCopyCommand({
        Bucket: "cert-s3-copy", Key: "copy/refused.txt", UploadId: open.UploadId, PartNumber: 1,
        CopySource: "cert-s3-copy/copy/nowhere.txt",
      })).catch((error) => error);
      expect((missing as S3ServiceException).name).toBe("NoSuchKey");
      // Nichts von den Weigerungen hat Bytes gebucht.
      const stillOpen = await client.send(new ListPartsCommand({
        Bucket: "cert-s3-copy", Key: "copy/refused.txt", UploadId: open.UploadId,
      }));
      expect(stillOpen.Parts ?? []).toEqual([]);
      await client.send(new AbortMultipartUploadCommand({
        Bucket: "cert-s3-copy", Key: "copy/refused.txt", UploadId: open.UploadId,
      }));
      const settled = (await storage.listBuckets(admin, scope)).find((entry) => entry.id === bucket.id)!;
      expect(settled.reservedBytes).toBe(0);
      expect(settled.usedBytes).toBe(source.byteLength + assembled.byteLength);
      client.destroy();
    } finally {
      await bridge.close();
    }
  }, 300_000);

  it("(2.127) is driven by the real AWS CLI over HTTP: list, copy, a file split by the CLI above the multipart threshold, a round trip back, an idempotent sync, ListObjects version 1 and an explicit checksum algorithm", async () => {
    const { s3, keys, storage } = await certificationRuntime();
    const bridge = await bridgeTo(s3);
    const workspace = await mkdtemp(join(tmpdir(), "qkern-aws-cli-"));
    try {
      const bucket = await storage.createBucket(admin, scope, {
        name: "cert-s3-cli", readPolicy: "service", writePolicy: "service",
        allowedMimeTypes: ["text/plain"], maxObjectBytes: 32 * 1024 * 1024, quotaBytes: 128 * 1024 * 1024,
      });
      const pair = await keys.create(admin, scope, {
        name: "Zertifizierung AWS CLI", bucketIds: [bucket.id],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const cli = await awsCliClient(workspace, bridge.origin, pair);

      // --- Der Healthcheck: eine echte Runde, nicht ein offener Port --------
      await warmBridge(bridge.origin, pair, "cert-s3-cli");

      // --- aws s3 ls: ListBuckets, von der CLI geparst ----------------------
      const listed = await runClient(cli, ["s3", "ls"]);
      expect(listed.status, listed.output).toBe(0);
      expect(listed.output).toContain("cert-s3-cli");

      // --- aws s3 cp: ein Objekt, von der CLI signiert ----------------------
      const small = Buffer.from(`qkern aws cli certification ${Date.now()}\n`, "utf8");
      await writeFile(join(workspace, "small.txt"), small);
      const smallMark = bridge.seen.length;
      const copied = await runClient(cli, [
        "s3", "cp", join(workspace, "small.txt"), "s3://cert-s3-cli/cli/small.txt",
      ]);
      expect(copied.status, copied.output).toBe(0);
      // Der Beleg, dass es wirklich durch den Dienst ging: der echte Scanner hat
      // die Bytes gesehen, und der echte Provider haelt sie.
      const afterSmall = await storage.listObjects(admin, scope, bucket.id, { prefix: "cli/" });
      expect(afterSmall.objects.map((object) => [object.key, object.status]))
        .toEqual([["cli/small.txt", "clean"]]);
      const smallGrant = await storage.createDownloadGrant(admin, scope, bucket.id, { key: "cli/small.txt" });
      const smallServed = await fetch(smallGrant.url, { redirect: "error" });
      expect(smallServed.status).toBe(200);
      expect(sha256Base64(Buffer.from(await smallServed.arrayBuffer()))).toBe(sha256Base64(small));
      // Welche Form die CLI von sich aus waehlt. Sie rechnet seit v2 eine
      // Pruefsumme mit, auch ohne `--checksum-algorithm`, und legt sie als
      // Trailer hinter einen `aws-chunked`-Koerper.
      const smallSeen = bridge.seen.slice(smallMark)
        .find((entry) => entry.method === "PUT" && entry.path === "/s3/cert-s3-cli/cli/small.txt");
      expect(smallSeen, "the CLI did not PUT through the bridge").toBeDefined();
      // Die CLI v2 waehlt eine **andere** Form als das AWS SDK fuer JavaScript,
      // und das ist der Gewinn an diesem Fall: Sie puffert die Datei, signiert
      // den Koerper als Ganzes und legt die Pruefsumme in einen **Header**, nicht
      // in einen Trailer hinter `aws-chunked`. Ihr Standardalgorithmus ist
      // CRC64NVME, nicht CRC32. Dieser Weg durch den Endpunkt ist vor 2.127 von
      // keinem echten Client gefahren worden.
      expect(smallSeen!.headers["content-encoding"]).toBeUndefined();
      expect(smallSeen!.headers["x-amz-trailer"]).toBeUndefined();
      expect(smallSeen!.headers["x-amz-sdk-checksum-algorithm"]).toBe("CRC64NVME");
      expect(smallSeen!.headers["x-amz-content-sha256"]).toBe(sha256Hex(small));
      expect(smallSeen!.headers["content-length"]).toBe(String(small.byteLength));
      // `Expect: 100-continue`: Die CLI wartet auf die Zwischenantwort, bevor
      // sie den Koerper schickt. Dass das Objekt da ist, belegt, dass der Weg
      // die Fortsetzung gibt; das SDK fragt sie nicht.
      expect(smallSeen!.headers["expect"]).toBe("100-continue");
      // Und die Quervergleich, der etwas ueber QKERN sagt: Die CRC64NVME, die
      // die AWS-CRT-Bibliothek gerechnet hat, ist Byte fuer Byte die, die
      // `s3-sigv4.ts` rechnet. Zwei unabhaengige Implementierungen desselben
      // Polynoms, und der Endpunkt hat sie angenommen.
      expect(smallSeen!.headers["x-amz-checksum-crc64nvme"])
        .toBe(checksumBase64("x-amz-checksum-crc64nvme", small));

      // --- aws s3 cp ueber der Multipart-Schwelle: die CLI teilt selbst -----
      // 12 MiB, also ueber den 8 MiB, ab denen die CLI von sich aus teilt. Der
      // Inhalt ist nicht zufaellig, damit der Vergleich am Ende etwas aussagt.
      const big = Buffer.alloc(12 * 1024 * 1024);
      for (let offset = 0; offset < big.byteLength; offset += 64) {
        big.write(`qkern aws cli multipart ${offset} `.padEnd(64, "."), offset, 64, "utf8");
      }
      await writeFile(join(workspace, "big.txt"), big);
      const bigMark = bridge.seen.length;
      const bigCopy = await runClient(cli, [
        "s3", "cp", join(workspace, "big.txt"), "s3://cert-s3-cli/cli/big.txt",
      ]);
      expect(bigCopy.status, bigCopy.output).toBe(0);
      const bigSeen = bridge.seen.slice(bigMark);
      expect(bigSeen.filter((entry) => entry.method === "POST" && entry.query.includes("uploads")).length).toBe(1);
      // Die Teile, wie die CLI sie geschnitten hat: 5 MiB aus der Konfiguration
      // oben, das letzte kleiner. Die Reihenfolge ist nicht festgelegt, weil die
      // CLI mehrere Teile gleichzeitig schickt; die Groessen sind es. Das letzte
      // Teil darf unter 5 MiB liegen, jedes andere nicht, und genau so kommt es
      // an: Der Endpunkt erzwingt die Untergrenze nicht, aber kein Client
      // verlangt es von ihm.
      const partSizes = bigSeen
        .filter((entry) => entry.method === "PUT" && entry.query.includes("partNumber"))
        .map((entry) => Number(entry.headers["content-length"]))
        .sort((a, b) => b - a);
      expect(partSizes).toEqual([5 * 1024 * 1024, 5 * 1024 * 1024, 2 * 1024 * 1024]);
      expect(partSizes.reduce((sum, size) => sum + size, 0)).toBe(big.byteLength);
      expect(bigSeen.filter((entry) => entry.method === "POST" && entry.query.includes("uploadId") &&
        !entry.query.includes("uploads")).length).toBe(1);
      // Die Pruefsumme der ganzen Datei rechnet der Endpunkt aus dem
      // zusammengesetzten Objekt, und erst das Urteil des echten Scanners macht
      // sie lesbar.
      const bigStored = (await storage.listObjects(admin, scope, bucket.id, { prefix: "cli/big" })).objects;
      expect(bigStored.map((object) => [object.key, object.status, object.sizeBytes]))
        .toEqual([["cli/big.txt", "clean", big.byteLength]]);

      // --- aws s3 cp zurueck: der Rueckweg, von der CLI gelesen -------------
      const back = await runClient(cli, [
        "s3", "cp", "s3://cert-s3-cli/cli/big.txt", join(workspace, "back.txt"),
      ]);
      expect(back.status, back.output).toBe(0);
      expect(sha256Base64(await readFile(join(workspace, "back.txt")))).toBe(sha256Base64(big));

      // --- aws s3 sync, zweimal: beim zweiten Mal darf nichts hochgehen -----
      // Das haengt an unserer Liste: Die CLI vergleicht `Size` und
      // `LastModified` aus `ListObjectsV2` mit der Datei. Stimmt eins davon
      // nicht, laedt sie beim zweiten Lauf wieder hoch, und der Fall sagt es.
      await mkdir(join(workspace, "tree"), { recursive: true });
      await writeFile(join(workspace, "tree", "a.txt"), "qkern sync a\n");
      await writeFile(join(workspace, "tree", "b.txt"), "qkern sync b\n");
      const firstSync = await runClient(cli, [
        "s3", "sync", join(workspace, "tree"), "s3://cert-s3-cli/cli/sync/",
      ]);
      expect(firstSync.status, firstSync.output).toBe(0);
      const secondMark = bridge.seen.length;
      const secondSync = await runClient(cli, [
        "s3", "sync", join(workspace, "tree"), "s3://cert-s3-cli/cli/sync/",
      ]);
      expect(secondSync.status, secondSync.output).toBe(0);
      expect(bridge.seen.slice(secondMark).filter((entry) => entry.method === "PUT").map((entry) => entry.path))
        .toEqual([]);

      // --- aws s3api list-objects: Version 1, von der CLI gewaehlt ----------
      const v1Mark = bridge.seen.length;
      const v1 = await runClient(cli, [
        "s3api", "list-objects", "--bucket", "cert-s3-cli", "--prefix", "cli/", "--delimiter", "/",
      ]);
      expect(v1.status, v1.output).toBe(0);
      const v1Seen = bridge.seen.slice(v1Mark).filter((entry) => entry.method === "GET");
      expect(v1Seen.length).toBeGreaterThanOrEqual(1);
      // `list-objects` ist Version 1: keine `list-type` in der Anfrage.
      expect(v1Seen.every((entry) => !entry.query.includes("list-type"))).toBe(true);
      const v1Body = JSON.parse(v1.output) as {
        Contents?: Array<{ Key: string }>; CommonPrefixes?: Array<{ Prefix: string }>;
      };
      expect(v1Body.Contents?.map((entry) => entry.Key)).toEqual(["cli/big.txt", "cli/small.txt"]);
      expect(v1Body.CommonPrefixes?.map((entry) => entry.Prefix)).toEqual(["cli/sync/"]);

      // --- --checksum-algorithm sha256: eine andere Summe, dieselbe Tuer ----
      const sha = Buffer.from(`qkern aws cli sha256 ${Date.now()}\n`, "utf8");
      await writeFile(join(workspace, "sha.txt"), sha);
      const shaMark = bridge.seen.length;
      const shaPut = await runClient(cli, [
        "s3api", "put-object", "--bucket", "cert-s3-cli", "--key", "cli/sha.txt",
        "--body", join(workspace, "sha.txt"), "--content-type", "text/plain",
        "--checksum-algorithm", "SHA256",
      ]);
      expect(shaPut.status, shaPut.output).toBe(0);
      const shaSeen = bridge.seen.slice(shaMark)
        .find((entry) => entry.method === "PUT" && entry.path === "/s3/cert-s3-cli/cli/sha.txt");
      expect(shaSeen, "the CLI did not PUT with an explicit checksum algorithm").toBeDefined();
      expect(shaSeen!.headers["x-amz-sdk-checksum-algorithm"]).toBe("SHA256");
      // Auch hier ein Header, kein Trailer, und auch hier stimmt die Summe der
      // CRT mit der von `s3-sigv4.ts` ueberein.
      expect(shaSeen!.headers["x-amz-trailer"]).toBeUndefined();
      expect(shaSeen!.headers["x-amz-checksum-sha256"])
        .toBe(checksumBase64("x-amz-checksum-sha256", sha));
      expect((await storage.listObjects(admin, scope, bucket.id, { prefix: "cli/sha" })).objects
        .map((object) => object.status)).toEqual(["clean"]);
      // --- Die zwei Abweichungen, die 2.73.0 benannt hat --------------------
      // Beide hat die CLI gefunden, und bei beiden hat sich QKERN bewegt.
      //
      // Erstens `max-keys=0`. Bis 2.73.0 war die untere Grenze 1, und die CLI
      // brach mit `InvalidArgument` und Code 254 ab, wo S3 eine leere Liste
      // gibt. Jetzt ist es eine leere Liste, und `IsTruncated` ist falsch:
      // waere es wahr, gaebe es keine Fortsetzung dazu und ein Aufrufer, der
      // ihr folgt, liefe endlos.
      const zero = await runClient(cli, [
        "s3api", "list-objects", "--bucket", "cert-s3-cli", "--max-keys", "0",
      ]);
      expect(zero.status, zero.output).toBe(0);
      const zeroBody = JSON.parse(zero.output || "{}") as {
        Contents?: unknown[]; IsTruncated?: boolean; NextMarker?: string;
      };
      expect(zeroBody.Contents ?? []).toEqual([]);
      expect(zeroBody.IsTruncated ?? false).toBe(false);
      expect(zeroBody.NextMarker).toBeUndefined();

      // Zweitens die Gruppe auf zwei Seiten. `--page-size 2` zwingt die CLI zu
      // mehreren Seiten, und `aws s3 ls` setzt dabei einen Delimiter. Vor 2.127
      // stand `PRE sync/` zweimal in der Ausgabe, weil die Fortsetzung ein
      // Schluessel **in** der Gruppe war. Jetzt wird eine begonnene Gruppe auf
      // ihrer Seite fertig gelesen, und jeder Eintrag steht genau einmal da.
      const paged = await runClient(cli, ["s3", "ls", "s3://cert-s3-cli/cli/", "--page-size", "2"]);
      expect(paged.status, paged.output).toBe(0);
      const prefixLines = paged.output.split("\n").filter((line) => line.includes("PRE "));
      expect(prefixLines.map((line) => line.trim())).toEqual(["PRE sync/"]);
      // Und nichts ist dabei verloren gegangen: dieselben Dateien wie ohne Paging.
      const fileNames = paged.output.split("\n")
        .filter((line) => line.trim() !== "" && !line.includes("PRE "))
        .map((line) => line.trim().split(/\s+/).at(-1));
      expect(fileNames.sort()).toEqual(["big.txt", "sha.txt", "small.txt"]);
    } finally {
      await bridge.close();
      await rm(workspace, { recursive: true, force: true });
    }
  }, 900_000);

  it("(2.128) is driven by rclone, a client with no AWS code in it: copy, lsjson, a file split by rclone itself, a round trip checked against the files, and a delete", async () => {
    const { s3, keys, storage } = await certificationRuntime();
    const bridge = await bridgeTo(s3);
    const workspace = await mkdtemp(join(tmpdir(), "qkern-rclone-"));
    try {
      const bucket = await storage.createBucket(admin, scope, {
        name: "cert-s3-rclone", readPolicy: "service", writePolicy: "service",
        allowedMimeTypes: ["text/plain"], maxObjectBytes: 32 * 1024 * 1024, quotaBytes: 128 * 1024 * 1024,
      });
      const pair = await keys.create(admin, scope, {
        name: "Zertifizierung rclone", bucketIds: [bucket.id],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      const rclone = await rcloneClient(workspace, bridge.origin, pair);
      await warmBridge(bridge.origin, pair, "cert-s3-rclone");

      const source = join(workspace, "tree");
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "one.txt"), "qkern rclone one\n");
      const big = Buffer.alloc(9 * 1024 * 1024);
      for (let offset = 0; offset < big.byteLength; offset += 64) {
        big.write(`qkern rclone chunked ${offset} `.padEnd(64, "."), offset, 64, "utf8");
      }
      await writeFile(join(source, "two.txt"), big);

      // rclone teilt ab `--s3-upload-cutoff` selbst. 5 MiB, damit die 9 MiB
      // sicher darueber fallen und die Teile gueltige S3-Teile sind.
      const mark = bridge.seen.length;
      const copied = await runClient(rclone, [
        "copy", source, "qkern:cert-s3-rclone/rclone",
        "--s3-upload-cutoff", "5Mi", "--s3-chunk-size", "5Mi",
      ]);
      expect(copied.status, copied.output).toBe(0);
      const seen = bridge.seen.slice(mark);
      expect(seen.filter((entry) => entry.method === "POST" && entry.query.includes("uploads")).length).toBe(1);
      expect(seen.filter((entry) => entry.method === "PUT" && entry.query.includes("partNumber")).length)
        .toBeGreaterThanOrEqual(2);
      const stored = await storage.listObjects(admin, scope, bucket.id, { prefix: "rclone/" });
      expect(stored.objects.map((object) => [object.key, object.status, object.sizeBytes])).toEqual([
        ["rclone/one.txt", "clean", 17],
        ["rclone/two.txt", "clean", big.byteLength],
      ]);

      // `rclone lsjson` liest die Liste mit seinem eigenen XML-Parser.
      const listedJson = await runClient(rclone, ["lsjson", "qkern:cert-s3-rclone/rclone"]);
      expect(listedJson.status, listedJson.output).toBe(0);
      const entries = JSON.parse(listedJson.output) as Array<{ Path: string; Size: number }>;
      expect(entries.map((entry) => [entry.Path, entry.Size]).sort())
        .toEqual([["one.txt", 17], ["two.txt", big.byteLength]]);

      // Der Rueckweg, von rclone geprueft: es laedt herunter und vergleicht
      // gegen die Dateien. Faellt eine Groesse oder ein Byte auseinander, sagt
      // `check` das und gibt einen Fehlercode.
      const target = join(workspace, "back");
      await mkdir(target, { recursive: true });
      const down = await runClient(rclone, ["copy", "qkern:cert-s3-rclone/rclone", target]);
      expect(down.status, down.output).toBe(0);
      expect(sha256Base64(await readFile(join(target, "two.txt")))).toBe(sha256Base64(big));
      const checked = await runClient(rclone, ["check", source, target]);
      expect(checked.status, checked.output).toBe(0);

      const deleted = await runClient(rclone, ["delete", "qkern:cert-s3-rclone/rclone/one.txt"]);
      expect(deleted.status, deleted.output).toBe(0);
      expect((await storage.listObjects(admin, scope, bucket.id, { prefix: "rclone/" })).objects
        .map((object) => object.key)).toEqual(["rclone/two.txt"]);
    } finally {
      await bridge.close();
      await rm(workspace, { recursive: true, force: true });
    }
  }, 900_000);
});

type Seen = { method: string; path: string; query: string; headers: Record<string, string> };

/**
 * Die HTTP-Bruecke: `node:http` auf 127.0.0.1, jede Anfrage als `Request` an
 * `handle()`, die Antwort zurueck auf die Leitung. Kein Next, kein Routing;
 * genau das, was `app/s3/[...path]/route.ts` sonst tut. Was ankam, wird
 * mitgeschrieben, damit der Fall sagen kann, wie der Client wirklich sprach.
 */
async function bridgeTo(s3: ProjectStorageS3Endpoint): Promise<{ origin: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const headers = new Headers();
    const flat: Record<string, string> = {};
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined) continue;
      const joined = Array.isArray(value) ? value.join(", ") : value;
      headers.set(name, joined);
      flat[name] = joined;
    }
    const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "127.0.0.1"}`);
    seen.push({ method: incoming.method ?? "", path: url.pathname, query: url.search, headers: flat });
    const withBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(url, {
      method: incoming.method, headers,
      body: withBody ? (Readable.toWeb(incoming) as NodeReadableStream as ReadableStream) : undefined,
      ...(withBody ? { duplex: "half" } : {}),
    } as RequestInit);
    const response = await s3.handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body && incoming.method !== "HEAD") {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) outgoing.write(chunk);
    }
    outgoing.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bridge did not listen");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    seen,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

type Issued = Awaited<ReturnType<ProjectStorageS3AccessKeyService["create"]>>;

/**
 * Ein fremder Client (2.127, 2.128): die Binaerdatei, die Umgebung, in der sie
 * laeuft, und die Zeichenketten, die aus ihrer Ausgabe heraus muessen, bevor
 * irgendetwas davon in ein Protokoll geraet.
 */
type ForeignClient = {
  readonly name: string;
  readonly binary: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string>;
  readonly secrets: ReadonlyArray<string>;
};

/**
 * Startet den fremden Client als Kindprozess und gibt zurueck, was er gesagt
 * hat. Die Ausgabe wird vorher um die Zugangsdaten bereinigt: Ein Fall, der
 * faellt, haengt seine Ausgabe an die Erwartung, und das Protokoll des Stacks
 * wird archiviert. Ein Geheimnis darf dort nicht landen, auch nicht in einer
 * Fehlermeldung des Clients.
 *
 * `--debug` gibt es hier darum nicht: Die CLI schreibt im Debugmodus die
 * kanonische Anfrage samt Zugangsschluessel ins Protokoll.
 */
async function runClient(
  client: ForeignClient,
  args: ReadonlyArray<string>,
  timeoutMs = 240_000,
): Promise<{ status: number; output: string }> {
  const child = spawn(client.binary, [...client.args, ...args], {
    env: { ...client.env } as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"] as const,
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const status = await new Promise<number>((resolve, reject) => {
    child.on("error", (error: Error & { code?: string }) => reject(
      error.code === "ENOENT"
        ? new Error(`${client.name} is not installed in the certification image; the stack installs it with apk.`)
        : error,
    ));
    child.on("close", (code: number | null) => resolve(code ?? 1));
  }).finally(() => clearTimeout(timer));
  const raw = Buffer.concat(chunks).toString("utf8");
  const output = client.secrets.reduce((text, secret) => text.split(secret).join("<redacted>"), raw);
  return { status, output };
}

/**
 * Die AWS CLI (2.127). Der Endpunkt kommt als Argument, nicht aus einer Datei,
 * weil die Bruecke jedes Mal einen anderen Port hat. Pfadadressierung steht in
 * einer eigenen Konfigurationsdatei: Die Bruecke hat keinen DNS-Namen je
 * Bucket, und `auto` waere eine Wette darauf, wie botocore einen
 * IP-Endpunkt bewertet.
 *
 * Der Zugangsschluessel geht ueber die Umgebung, nicht in die Datei: Die Datei
 * liegt im Arbeitsverzeichnis des Falls, die Umgebung stirbt mit dem Prozess.
 * `HOME` zeigt daneben, damit kein `~/.aws` vom Rechner dazwischenkommt.
 */
async function awsCliClient(workspace: string, origin: string, pair: Issued): Promise<ForeignClient> {
  const home = join(workspace, "aws-home");
  await mkdir(home, { recursive: true });
  const config = join(home, "config");
  await writeFile(config, [
    "[default]",
    "region = us-east-1",
    "s3 =",
    "    addressing_style = path",
    "    multipart_threshold = 8MB",
    "    multipart_chunksize = 5MB",
    "",
  ].join("\n"));
  return {
    name: "the AWS CLI",
    binary: process.env.QKERN_TEST_STORAGE_AWS_CLI ?? "aws",
    args: ["--endpoint-url", `${origin}/s3`, "--no-cli-pager", "--output", "json"],
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: home,
      AWS_CONFIG_FILE: config,
      AWS_SHARED_CREDENTIALS_FILE: join(home, "credentials-absent"),
      AWS_ACCESS_KEY_ID: pair.key.accessKeyId,
      AWS_SECRET_ACCESS_KEY: pair.secret,
      AWS_DEFAULT_REGION: "us-east-1",
      // Ohne das sucht die CLI eine Instanzrolle und wartet dabei.
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_PAGER: "",
    },
    secrets: [pair.secret],
  };
}

/**
 * rclone (2.128). Kein AWS-Code darin: eine eigene Implementierung von SigV4
 * und von der S3-API, in Go geschrieben. Der staerkere Zeuge von beiden.
 *
 * Die Konfiguration kommt aus Umgebungsvariablen der Form
 * `RCLONE_CONFIG_<REMOTE>_<SCHLUESSEL>`, damit das Geheimnis nicht in eine
 * Datei muss. `provider = Other` statt `AWS`, weil rclone sonst Dinge annimmt,
 * die nur bei AWS gelten; `force_path_style` aus demselben Grund wie bei der
 * CLI.
 */
async function rcloneClient(workspace: string, origin: string, pair: Issued): Promise<ForeignClient> {
  const home = join(workspace, "rclone-home");
  await mkdir(home, { recursive: true });
  return {
    name: "rclone",
    binary: process.env.QKERN_TEST_STORAGE_RCLONE ?? "rclone",
    args: ["--config", join(home, "rclone.conf"), "--log-level", "ERROR"],
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: home,
      RCLONE_CONFIG_QKERN_TYPE: "s3",
      RCLONE_CONFIG_QKERN_PROVIDER: "Other",
      RCLONE_CONFIG_QKERN_ENDPOINT: `${origin}/s3`,
      RCLONE_CONFIG_QKERN_REGION: "us-east-1",
      RCLONE_CONFIG_QKERN_FORCE_PATH_STYLE: "true",
      RCLONE_CONFIG_QKERN_ACCESS_KEY_ID: pair.key.accessKeyId,
      RCLONE_CONFIG_QKERN_SECRET_ACCESS_KEY: pair.secret,
      RCLONE_CONFIG_QKERN_NO_CHECK_BUCKET: "true",
    },
    secrets: [pair.secret],
  };
}

/**
 * Der Healthcheck der Bruecke (2.127): eine echte Runde, nicht ein offener
 * Port. Geschrieben und zurueckgelesen **ueber die Leitung**, mit derselben
 * Signatur, die die Faelle daneben selbst rechnen, und mit dem Paar, mit dem
 * nachher der fremde Client spricht.
 *
 * Nur am Port zu haengen waere zu wenig: Der Port ist offen, sobald
 * `server.listen` zurueckkommt, auch wenn Provider, Scanner oder
 * Schluesseldienst noch nicht tragen. Der Fall wuerde dann in der CLI
 * scheitern, und die Diagnose waere "An error occurred (InternalError)" statt
 * dem Grund. Hier faellt er an der Stelle, an der etwas fehlt.
 */
async function warmBridge(origin: string, pair: Issued, bucket: string): Promise<void> {
  const payload = Buffer.from(`qkern bridge health ${Date.now()}`, "utf8");
  const key = "health/round.txt";
  const put = await fetch(sign(pair, "PUT", `/s3/${bucket}/${key}`, {
    body: payload, headers: { "content-type": "text/plain" }, origin,
  }));
  if (put.status !== 200) {
    throw new Error(`the bridge did not take a real round: PUT answered ${put.status} ${await put.text()}`);
  }
  if (put.headers.get("x-qkern-object-status") !== "clean") {
    throw new Error(`the real scanner did not clear the health object: ${put.headers.get("x-qkern-object-status")}`);
  }
  const read = await fetch(sign(pair, "GET", `/s3/${bucket}/${key}`, { origin }));
  if (read.status !== 200) {
    throw new Error(`the bridge did not take a real round: GET answered ${read.status} ${await read.text()}`);
  }
  const served = Buffer.from(await read.arrayBuffer());
  if (sha256Base64(served) !== sha256Base64(payload)) {
    throw new Error("the bridge answered a real round with other bytes than were written");
  }
}

/** Rechnet die Signatur wie ein S3-Client: HMAC-Kette aus dem Geheimnis, Header-Signatur. */
function sign(issued: Issued, method: string, path: string, options: {
  body?: Buffer; headers?: Record<string, string>; secret?: string; origin?: string;
} = {}): Request {
  // `origin` seit 2.127: Die Signatur deckt den Host-Header. Wer die Anfrage
  // nicht an `handle()` gibt, sondern ueber die Bruecke auf die Leitung legt,
  // muss fuer deren Herkunft signieren, sonst faellt sie an der Signatur und
  // nicht an der Sache.
  const url = new URL(`${options.origin ?? QKERN}${path}`);
  const body = options.body;
  const headers = signSigV4Request({
    method, url,
    payloadHash: sha256Hex(body ?? ""),
    headers: { ...(body ? { "content-length": String(body.byteLength) } : {}), ...(options.headers ?? {}) },
    accessKeyId: issued.key.accessKeyId,
    secret: options.secret ?? issued.secret,
    region: "us-east-1",
    now: new Date(),
  });
  return new Request(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
}

/**
 * Ein PUT als `aws-chunked` mit signierten Bloecken und signiertem Trailer
 * (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER`), Blockgroesse 8 KiB wie bei
 * der AWS CLI, CRC32C im Trailer. Die Kopfsignatur ist der Anfang der Kette.
 */
function signChunked(issued: Issued, path: string, payload: Buffer, tamper?: (body: Buffer) => Buffer): Request {
  const url = new URL(`${QKERN}${path}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const scopeParts = { date: amzDate.slice(0, 8), region: "us-east-1" };
  const declared = STREAMING_SIGNED_PAYLOAD_TRAILER;
  const trailers = { "x-amz-checksum-crc32c": checksumBase64("x-amz-checksum-crc32c", payload) };
  const build = (seed: string) => encodeAwsChunkedBody({
    payload, declared, seedSignature: seed, amzDate, scope: scopeParts, secret: issued.secret, chunkBytes: 8192, trailers,
  });
  const encodedLength = build("0".repeat(64)).byteLength;
  const headers = signSigV4Request({
    method: "PUT", url, payloadHash: declared,
    headers: {
      "content-type": "text/plain", "content-encoding": "aws-chunked", "content-length": String(encodedLength),
      "x-amz-decoded-content-length": String(payload.byteLength), "x-amz-trailer": "x-amz-checksum-crc32c",
    },
    accessKeyId: issued.key.accessKeyId, secret: issued.secret, region: "us-east-1", now,
  });
  const seed = /Signature=([0-9a-f]{64})/.exec(headers.authorization)![1];
  let body = build(seed);
  if (tamper) body = tamper(body);
  return new Request(url, { method: "PUT", headers, body: new Uint8Array(body) });
}

async function certificationRuntime() {
  await waitForProviderBucket();
  const credentials = new StaticS3ProjectStorageCredentialsProvider({ accessKeyId, secretAccessKey });
  const provider = new S3ProjectStorageProvider({
    endpoint, region, bucket: providerBucket, production: false, timeoutMs: 10_000,
  }, credentials);
  const client = new ClamdInstreamClient({
    host: clamAvHost, port: clamAvPort, connectTimeoutMs: 3_000, scanTimeoutMs: 30_000,
    maxObjectBytes: 25 * 1024 * 1024,
  });
  await waitForClamAv(client);
  const scanner = new ClamAvProjectStorageScanner(provider, client, {
    downloadTimeoutMs: 30_000, maxObjectBytes: 25 * 1024 * 1024,
  });
  const repository = new MemoryProjectStorageRepository();
  const storage = new ProjectStorageService({ repository, provider, scanner, grantTtlSeconds: 60 });
  const keys = new ProjectStorageS3AccessKeyService({
    store: new MemoryProjectStorageS3AccessKeyStore(),
    buckets: repository,
    protector: new ProjectStorageS3SecretProtector(randomBytes(32)),
  });
  const bucket = await storage.createBucket(admin, scope, {
    name: "cert-s3", readPolicy: "service", writePolicy: "service",
    allowedMimeTypes: ["text/plain"], maxObjectBytes: 1024 * 1024, quotaBytes: 4 * 1024 * 1024,
  });
  const other = await storage.createBucket(admin, scope, {
    name: "cert-s3-other", readPolicy: "service", writePolicy: "service",
    allowedMimeTypes: ["text/plain"], maxObjectBytes: 1024 * 1024, quotaBytes: 4 * 1024 * 1024,
  });
  const issued = await keys.create(admin, scope, {
    name: "Zertifizierung", bucketIds: [bucket.id],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  expect(issued.key.verifiable).toBe(true);
  const s3 = new ProjectStorageS3Endpoint({ storage, keys });
  return { s3, keys, storage, provider, issued, bucket, other };
}

async function waitForProviderBucket() {
  const deadline = Date.now() + 90_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await createProviderBucket();
      lastStatus = response.status;
      if (response.ok || response.status === 409) return;
    } catch { lastStatus = 0; }
    await delay(1_000);
  }
  throw new Error(`versitygw did not become ready; last status ${lastStatus}.`);
}

async function waitForClamAv(client: ClamdInstreamClient) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await client.scan(singleChunk(Buffer.from("qkern scanner ready", "utf8"))) === "clean") return;
    await delay(1_000);
  }
  throw new Error("ClamAV did not become ready.");
}

/** Der Provider-Bucket, mit dem Wurzelkonto des Stacks angelegt; derselbe Signierer wie der Fall selbst. */
async function createProviderBucket() {
  const url = new URL(endpoint);
  url.pathname = `/${providerBucket}`;
  const headers = signSigV4Request({
    method: "PUT", url, payloadHash: sha256Hex(""), accessKeyId, secret: secretAccessKey, region, now: new Date(),
  });
  return await fetch(url, { method: "PUT", redirect: "error", headers });
}

async function* singleChunk(value: Uint8Array) { yield value; }
function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function sha256Base64(value: Uint8Array) { return createHash("sha256").update(value).digest("base64"); }
