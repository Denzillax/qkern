import { describe, expect, it } from "vitest";
import {
  formatEvidenceDate,
  summarizeCertification,
  type ArchivedManifest,
} from "@/lib/server/evidence/certification-summary";

/**
 * Die Landingpage-Zahlen (1.91): je Stack der beste gruene Lauf, das Datum des
 * juengsten gruenen Laufs, Mutationslaeufe als Gegenproben — rote Laeufe
 * zaehlen nie als Bestand.
 */
const manifest = (over: Partial<ArchivedManifest>): ArchivedManifest => ({
  stack: "PostgreSQL 17", passed: 10, failed: 0, exitCode: 0, date: "2026-09-01", file: "x-run1.manifest.json", ...over,
});

describe("certification summary", () => {
  it("takes the best green run per stack and the newest green date", () => {
    const summary = summarizeCertification([
      manifest({ passed: 150, date: "2026-08-16" }),
      manifest({ passed: 160, date: "2026-09-24", file: "b-run1.manifest.json" }),
      manifest({ passed: 170, failed: 1, exitCode: 1, date: "2026-09-25", file: "c-mutation.manifest.json" }),
      manifest({ stack: "MinIO und ClamAV", passed: 8, date: "2026-08-16" }),
      manifest({ stack: "unknown-stack", passed: 99 }),
    ]);
    expect(summary.rows).toEqual([
      { name: "Control Plane und Data API", stack: "PostgreSQL 17", passed: 160, date: "2026-09-24" },
      { name: "Object Storage", stack: "MinIO und ClamAV", passed: 8, date: "2026-08-16" },
    ]);
    expect(summary.mutationRuns).toBe(1);
    expect(summary.archivedRuns).toBe(5);
    expect(summary.latestDate).toBe("2026-09-24");
  });

  it("shows no row for a stack without a green run and no date without rows", () => {
    const summary = summarizeCertification([
      manifest({ failed: 2, exitCode: 1, file: "a-run1.manifest.json" }),
    ]);
    expect(summary.rows).toEqual([]);
    expect(summary.latestDate).toBeNull();
    expect(summary.mutationRuns).toBe(0);
  });

  it("formats evidence dates the way the page always did", () => {
    expect(formatEvidenceDate("2026-09-24")).toBe("24. September 2026");
    expect(formatEvidenceDate("2026-08-06")).toBe("6. August 2026");
  });
});
