import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
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
 * Nicht gesehen hat den Endpunkt die AWS CLI selbst und rclone; beide
 * brauchen einen laufenden Next-Server im Stack, und den gibt es dort nicht.
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

/** Rechnet die Signatur wie ein S3-Client: HMAC-Kette aus dem Geheimnis, Header-Signatur. */
function sign(issued: Issued, method: string, path: string, options: {
  body?: Buffer; headers?: Record<string, string>; secret?: string;
} = {}): Request {
  const url = new URL(`${QKERN}${path}`);
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
