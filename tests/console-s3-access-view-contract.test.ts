import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  S3_ACCESS_ENDPOINT,
  S3_ACCESS_NO_SERVER_KEY,
  S3_ACCESS_NOT_VERIFIABLE,
  S3_ACCESS_OPERATIONS_BUILT,
  S3_ACCESS_OPERATIONS_MISSING,
  S3_ACCESS_ROLE,
  S3_ACCESS_SECRET_AT_REST,
  S3_ACCESS_WHY_NO_PROVIDER_KEYS,
  s3AccessTexts,
  validateS3AccessDraft,
} from "@/lib/console/s3-access-texts";

/**
 * Die Ansicht Storage, S3-Zugang (2.78, Endpunkt 2.96) muss ihre Grenzen zeigen.
 *
 * Seit 2.96 nimmt der Endpunkt /s3 ein Paar an. Die Seite muss sagen, wo er
 * haengt, als wer ein Paar handelt, welche Operationen gehen und welche mit
 * 501 antworten, und sie muss ein Paar ohne hinterlegtes Geheimnis als
 * solches zeigen. Faellt einer dieser Saetze weg, sieht die Seite aus wie
 * ein vollstaendiger S3-Dienst, und genau dann soll dieser Vertrag fallen.
 * Dazu haelt er die Wege fest, die die Ansicht abfragt: Ein Weg, der ein
 * Geheimnis zurueckbringen koennte, ist keiner.
 */
const VIEW = path.resolve(process.cwd(), "components/console/s3-access-view.tsx");

async function view(): Promise<string> {
  return readFile(VIEW, "utf8");
}

describe("console S3 access view contract", () => {
  it("names the endpoint, the role of a pair, what works, what answers 501 and where the secret lies", async () => {
    const source = await view();
    const constants = {
      S3_ACCESS_ENDPOINT, S3_ACCESS_ROLE, S3_ACCESS_OPERATIONS_BUILT, S3_ACCESS_OPERATIONS_MISSING,
      S3_ACCESS_SECRET_AT_REST, S3_ACCESS_WHY_NO_PROVIDER_KEYS, S3_ACCESS_NO_SERVER_KEY, S3_ACCESS_NOT_VERIFIABLE,
    };
    for (const constant of Object.keys(constants)) {
      // Der Text steht als Konstante im Modul und laeuft ueber t(variable);
      // gepruft wird, dass die Ansicht ihn wirklich rendert.
      expect(source, constant).toContain(`t(${constant})`);
    }
    // Die Adresse des Endpunkts kommt aus dem Browser und endet auf /s3.
    expect(source).toContain("`${window.location.origin}/s3`");
    // Ein Paar ohne Geheimnis zaehlt nicht als gueltig.
    expect(source).toContain("!key.revokedAt && key.verifiable");
    // Die Operationen, die die Seite als fehlend nennt, sind die, die der
    // Endpunkt mit 501 beantwortet; die seit 2.101 gebauten stehen bei "Was geht",
    // und seit 2.123 gehoeren UploadPartCopy und die alte Listenform dazu.
    for (const missing of ["ACLs", "Versionen", "Tags", "POST-Policy", "bucket.host"]) {
      expect(S3_ACCESS_OPERATIONS_MISSING, missing).toContain(missing);
      expect(S3_ACCESS_OPERATIONS_BUILT, missing).not.toContain(missing);
    }
    for (const built of ["Presigned", "Range", "CopyObject", "DeleteObjects", "aws-chunked", "15 Minuten",
      "CreateMultipartUpload", "UploadPart bis 64 MiB", "UploadPartCopy", "marker", "ListParts",
      "CompleteMultipartUpload", "AbortMultipartUpload"]) {
      expect(S3_ACCESS_OPERATIONS_BUILT, built).toContain(built);
      expect(S3_ACCESS_OPERATIONS_MISSING, built).not.toContain(built);
    }
  });

  it("asks only for the two paths it needs and never for a secret", async () => {
    const source = await view();
    const targets = [...source.matchAll(/fetch\(`([^`]+)`/g)].map((match) => match[1]);
    expect(targets).toEqual([
      "${base}/s3-keys",
      "${base}/buckets",
      "${base}/s3-keys",
      "${base}/s3-keys/${keyId}",
    ]);
    const methods = [...source.matchAll(/method: "([A-Z]+)"/g)].map((match) => match[1]);
    expect([...new Set(methods)].sort()).toEqual(["DELETE", "POST"]);
    // Es gibt keinen Weg, der ein ausgegebenes Geheimnis erneut holen koennte.
    expect(source).not.toMatch(/s3-keys\/\$\{[^}]+\}\/secret/);
    expect(source).not.toContain("secretHash");
  });

  it("keeps the shown secret in local state and never reloads it", async () => {
    const source = await view();
    // Der Wert kommt aus der Antwort des POST und wird nirgends sonst gesetzt.
    expect([...source.matchAll(/setIssued\(/g)]).toHaveLength(2);
    expect(source).toContain("setIssued({ accessKeyId:");
    expect(source).toContain("setIssued(null)");
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it("renders every moment through console-display", async () => {
    const source = await view();
    expect(source).toContain('from "@/components/console/console-display"');
    for (const forbidden of ["toLocaleString(", "toLocaleDateString(", "toFixed(", "new Intl."]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("offers every text of the module for translation", async () => {
    // Der i18n-Vertrag liest diese Liste; sie darf nicht leer laufen, wenn ein
    // Text aus dem Modul verschwindet.
    expect(s3AccessTexts().length).toBeGreaterThanOrEqual(16);
    expect(new Set(s3AccessTexts()).size).toBe(s3AccessTexts().length);
  });

  it("rejects a draft the service would also reject", async () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const bucketIds = ["11111111-1111-4111-8111-111111111111"];
    const valid = validateS3AccessDraft({
      name: " Werkzeug ", bucketIds, expiresAt: "2026-10-27T12:00:00.000Z", now,
    });
    expect(valid.name).toBe("Werkzeug");
    expect(valid.bucketIds).toEqual(bucketIds);
    expect(() => validateS3AccessDraft({
      name: "", bucketIds, expiresAt: "2026-10-27T12:00:00.000Z", now,
    })).toThrowError(/INVALID_NAME/);
    expect(() => validateS3AccessDraft({
      name: "Werkzeug", bucketIds: [], expiresAt: "2026-10-27T12:00:00.000Z", now,
    })).toThrowError(/NO_BUCKET/);
    // Eine Minute in der Zukunft ist zu kurz, zwei Jahre zu lang.
    expect(() => validateS3AccessDraft({
      name: "Werkzeug", bucketIds, expiresAt: "2026-09-27T12:01:00.000Z", now,
    })).toThrowError(/INVALID_EXPIRY/);
    expect(() => validateS3AccessDraft({
      name: "Werkzeug", bucketIds, expiresAt: "2028-09-27T12:00:00.000Z", now,
    })).toThrowError(/INVALID_EXPIRY/);
  });
});
