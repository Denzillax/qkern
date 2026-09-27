import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  S3_ACCESS_LIMIT,
  S3_ACCESS_WHY_NO_PROVIDER_KEYS,
  S3_ACCESS_WHY_NO_SIGNATURE_CHECK,
  s3AccessTexts,
  validateS3AccessDraft,
} from "@/lib/console/s3-access-texts";

/**
 * Die Ansicht Storage, S3-Zugang (2.78) muss ihre Grenze zeigen.
 *
 * Der Slice gibt Schluesselpaare aus, die heute kein Endpunkt annimmt. Das ist
 * vertretbar, solange die Seite es sagt. Faellt der Satz irgendwann weg, sieht
 * die Seite aus wie ein fertiger Zugang, und genau dann soll dieser Vertrag
 * fallen. Dazu haelt er die Wege fest, die die Ansicht abfragt: Ein Weg, der
 * ein Geheimnis zurueckbringen koennte, ist keiner.
 */
const VIEW = path.resolve(process.cwd(), "components/console/s3-access-view.tsx");

async function view(): Promise<string> {
  return readFile(VIEW, "utf8");
}

describe("console S3 access view contract", () => {
  it("names the limit and both reasons on the page itself", async () => {
    const source = await view();
    for (const text of [S3_ACCESS_LIMIT, S3_ACCESS_WHY_NO_PROVIDER_KEYS, S3_ACCESS_WHY_NO_SIGNATURE_CHECK]) {
      // Der Text steht als Konstante im Modul und laeuft ueber t(variable);
      // gepruft wird, dass die Ansicht ihn wirklich rendert.
      const constant = Object.entries({
        S3_ACCESS_LIMIT, S3_ACCESS_WHY_NO_PROVIDER_KEYS, S3_ACCESS_WHY_NO_SIGNATURE_CHECK,
      }).find(([, value]) => value === text)![0];
      expect(source, constant).toContain(`t(${constant})`);
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
    expect(s3AccessTexts().length).toBeGreaterThanOrEqual(11);
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
