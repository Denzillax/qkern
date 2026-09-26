import { describe, expect, it, vi } from "vitest";
import type { UsagePrincipal, UsageSeriesRecord } from "@/lib/server/usage/model";
import { MemoryUsageRepository, type UsageRepository } from "@/lib/server/usage/repository";
import { UsageService, seriesWindow } from "@/lib/server/usage/service";

/**
 * Die Zeitreihe (2.45) im reinen Teil: Fenster, leere Eimer, Reihenfolge,
 * Trennung von angenommen und abgelehnt, Grenzen. Die Aggregation selbst
 * laeuft in der Datenbank; hier steht, was der Dienst daraus macht.
 */
const now = new Date("2026-09-26T13:42:17.000Z");
const scope = { organizationId: "org-series", projectId: "project-series", environment: "development" as const };
const reader: UsagePrincipal = {
  organizationId: scope.organizationId, actorRef: "owner@qkern.test", subject: "owner-series", role: "reader",
};
const meter: UsagePrincipal = { ...reader, role: "meter" };

function record(start: string, accepted: bigint, rejected: bigint, events: number): UsageSeriesRecord {
  return { bucketStart: new Date(start), acceptedQuantity: accepted, rejectedQuantity: rejected, events };
}

/** Ein Port, der nur die Aggregation kann; alles andere braucht dieser Test nicht. */
function setup(rows: UsageSeriesRecord[] = []) {
  const readSeries = vi.fn().mockResolvedValue(rows);
  const repository = Object.assign(new MemoryUsageRepository(), { readSeries }) as unknown as UsageRepository;
  return { readSeries, service: new UsageService({ repository, now: () => new Date(now) }) };
}

describe("usage series", () => {
  it("asks the database for the window of the bucket size and fills every empty bucket with zero", async () => {
    const { readSeries, service } = setup([
      record("2026-09-26T13:00:00.000Z", 300n, 40n, 9),
      record("2026-09-26T11:00:00.000Z", 120n, 0n, 4),
    ]);
    const series = await service.readSeries(reader, scope, { metric: "api_requests", bucket: "hour" });

    expect(readSeries).toHaveBeenCalledWith(reader, scope, {
      metric: "api_requests", bucket: "hour",
      from: new Date("2026-09-24T14:00:00.000Z"),
      to: new Date("2026-09-26T14:00:00.000Z"),
      limit: 49,
    });
    expect(series.bucketCount).toBe(48);
    expect(series.buckets).toHaveLength(48);
    expect(series.windowStart).toBe("2026-09-24T14:00:00.000Z");
    expect(series.windowEnd).toBe("2026-09-26T14:00:00.000Z");
    expect(series.truncated).toBe(false);

    // Aufsteigend, lueckenlos, eine Stunde Abstand.
    const starts = series.buckets.map((entry) => Date.parse(entry.start));
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBe(3_600_000);
    }
    // Der laufende, noch unvollstaendige Eimer ist der letzte.
    expect(series.buckets.at(-1)).toMatchObject({ start: "2026-09-26T13:00:00.000Z", accepted: "300", rejected: "40", events: 9 });
    expect(series.buckets.at(-3)).toMatchObject({ start: "2026-09-26T11:00:00.000Z", accepted: "120", rejected: "0", events: 4 });
    // Ein Eimer ohne Ereignis ist Null, nicht abwesend.
    expect(series.buckets.at(-2)).toMatchObject({ start: "2026-09-26T12:00:00.000Z", accepted: "0", rejected: "0", events: 0 });
    expect(series.totals).toEqual({ accepted: "420", rejected: "40", events: 13 });
  });

  it("derives a ninety day window from the day bucket and keeps quantities exact", async () => {
    const { readSeries, service } = setup([
      record("2026-09-26T00:00:00.000Z", 9_007_199_254_740_993n, 1n, 2),
    ]);
    const series = await service.readSeries(reader, scope, { metric: "storage_egress_bytes", bucket: "day" });
    expect(readSeries.mock.calls[0][2]).toMatchObject({
      from: new Date("2026-06-29T00:00:00.000Z"),
      to: new Date("2026-09-27T00:00:00.000Z"),
      limit: 91,
    });
    expect(series.bucketCount).toBe(90);
    expect(series.bucket).toBe("day");
    expect(series.unit).toBe("bytes");
    expect(series.buckets.at(-1)).toMatchObject({ accepted: "9007199254740993", rejected: "1" });
    expect(series.totals.accepted).toBe("9007199254740993");
  });

  it("reports truncation when the aggregation returns more groups than the window can hold", async () => {
    const rows = Array.from({ length: 49 }, (_, index) =>
      record(new Date(Date.UTC(2026, 8, 24, 14 + index)).toISOString(), 1n, 0n, 1));
    const { service } = setup(rows);
    const series = await service.readSeries(reader, scope, { metric: "api_requests", bucket: "hour" });
    expect(series.truncated).toBe(true);
    expect(series.buckets).toHaveLength(48);
  });

  it("counts an event outside the window in no bucket at all", async () => {
    const { service } = setup([
      record("2026-09-24T13:00:00.000Z", 999n, 0n, 1),
      record("2026-09-24T14:00:00.000Z", 5n, 0n, 1),
    ]);
    const series = await service.readSeries(reader, scope, { metric: "api_requests", bucket: "hour" });
    expect(series.buckets[0]).toMatchObject({ start: "2026-09-24T14:00:00.000Z", accepted: "5" });
    expect(series.totals.accepted).toBe("5");
  });

  it("defaults to the hour bucket and rejects an unknown metric, an unknown bucket and a wrong role", async () => {
    const { readSeries, service } = setup();
    expect((await service.readSeries(reader, scope, { metric: "api_requests" })).bucket).toBe("hour");
    for (const input of [
      { metric: "antwortzeiten", bucket: "hour" },
      { metric: "api_requests; DROP TABLE usage_events", bucket: "hour" },
      { metric: "api_requests", bucket: "minute" },
      { metric: "api_requests", bucket: "week" },
      {},
    ]) {
      await expect(service.readSeries(reader, scope, input), JSON.stringify(input))
        .rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });
    }
    // Wer misst, liest nicht: die Reihe ist fuer Leser und Operatoren.
    await expect(service.readSeries(meter, scope, { metric: "api_requests" }))
      .rejects.toMatchObject({ code: "USAGE_ACCESS_DENIED" });
    await expect(service.readSeries({ ...reader, organizationId: "org-other" }, scope, { metric: "api_requests" }))
      .rejects.toMatchObject({ code: "USAGE_ACCESS_DENIED" });
    expect(readSeries).toHaveBeenCalledTimes(1);
  });

  it("says so instead of inventing an empty series when the port cannot aggregate", async () => {
    const service = new UsageService({ repository: new MemoryUsageRepository(), now: () => new Date(now) });
    await expect(service.readSeries(reader, scope, { metric: "api_requests" }))
      .rejects.toMatchObject({ code: "USAGE_METERING_DISABLED" });
  });

  it("ends every window with the running bucket, whatever the moment inside it", () => {
    for (const moment of ["2026-09-26T13:00:00.000Z", "2026-09-26T13:00:00.001Z", "2026-09-26T13:59:59.999Z"]) {
      expect(seriesWindow("hour", new Date(moment)).end.toISOString()).toBe("2026-09-26T14:00:00.000Z");
    }
    expect(seriesWindow("day", new Date("2026-09-26T13:42:17.000Z")).start.toISOString())
      .toBe("2026-06-29T00:00:00.000Z");
  });
});
