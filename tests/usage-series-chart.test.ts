import { describe, expect, it } from "vitest";
import { buildUsageSeriesChart, type UsageChartBucket } from "@/lib/console/usage-series-chart";

/**
 * Das Bild der Nutzungs-Zeitreihe (2.45) ist eine reine Funktion: gleiche
 * Eingabe, gleiche Ausgabe, keine Farbe, keine Sprache. Genau das steht hier.
 */
function bucket(start: string, accepted: string, rejected = "0", events = 1): UsageChartBucket {
  return { start, accepted, rejected, events };
}

const BUCKETS: UsageChartBucket[] = [
  bucket("2026-09-26T08:00:00.000Z", "120", "0", 4),
  bucket("2026-09-26T09:00:00.000Z", "0", "0", 0),
  bucket("2026-09-26T10:00:00.000Z", "300", "40", 9),
  bucket("2026-09-26T11:00:00.000Z", "60", "0", 2),
];

describe("usage series chart", () => {
  it("draws the same picture for the same buckets", () => {
    const first = buildUsageSeriesChart({ buckets: BUCKETS });
    const second = buildUsageSeriesChart({ buckets: BUCKETS.map((entry) => ({ ...entry })) });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Der hoechste Eimer ist angenommen plus abgelehnt, exakt.
    expect(first.max).toBe("340");
    expect(first.bars).toHaveLength(4);
    expect(first.bars.map((bar) => bar.total)).toEqual(["120", "0", "340", "60"]);
  });

  it("never lets two bars overlap and stacks the rejected part on top without covering the accepted one", () => {
    const chart = buildUsageSeriesChart({ buckets: BUCKETS });
    for (let index = 1; index < chart.bars.length; index += 1) {
      const left = chart.bars[index - 1];
      const right = chart.bars[index];
      expect(left.x + left.width, `Balken ${index} ueberlappt seinen Vorgaenger`).toBeLessThanOrEqual(right.x + 0.001);
    }
    for (const bar of chart.bars) {
      // Angenommen steht auf der Grundlinie, abgelehnt stoesst von oben an.
      expect(bar.accepted.y + bar.accepted.height).toBeCloseTo(chart.baselineY, 5);
      expect(bar.rejected.y + bar.rejected.height).toBeCloseTo(bar.accepted.y, 5);
      expect(bar.accepted.height).toBeGreaterThanOrEqual(0);
      expect(bar.rejected.height).toBeGreaterThanOrEqual(0);
      expect(bar.accepted.y).toBeGreaterThanOrEqual(chart.plot.y - 0.001);
      expect(bar.x).toBeGreaterThanOrEqual(chart.plot.x - 0.001);
      expect(bar.x + bar.width).toBeLessThanOrEqual(chart.plot.x + chart.plot.width + 0.001);
    }
    // Der hoechste Eimer reicht genau bis an den oberen Rand der Flaeche.
    const tallest = chart.bars[2];
    expect(tallest.rejected.y).toBeCloseTo(chart.plot.y, 1);
  });

  it("marks an empty bucket as empty and keeps it in the row", () => {
    const chart = buildUsageSeriesChart({ buckets: BUCKETS });
    expect(chart.bars.map((bar) => bar.empty)).toEqual([false, true, false, false]);
    expect(chart.bars[1].accepted.height).toBe(0);
    expect(chart.bars[1].rejected.height).toBe(0);
  });

  it("survives a series without a single event and one with a single bucket", () => {
    const nothing = buildUsageSeriesChart({ buckets: [] });
    expect(nothing.bars).toEqual([]);
    expect(nothing.labels).toEqual([]);
    expect(nothing.empty).toBe(true);
    expect(nothing.max).toBe("0");
    expect(nothing.plot.width).toBeGreaterThan(0);
    expect(nothing.plot.height).toBeGreaterThan(0);

    const zeros = buildUsageSeriesChart({ buckets: [bucket("2026-09-26T08:00:00.000Z", "0", "0", 0)] });
    expect(zeros.empty).toBe(true);
    expect(zeros.bars[0].accepted.height).toBe(0);
    expect(zeros.ticks).toEqual([{ value: "0", y: zeros.baselineY }]);

    const single = buildUsageSeriesChart({ buckets: [bucket("2026-09-26T08:00:00.000Z", "7")] });
    expect(single.bars).toHaveLength(1);
    expect(single.bars[0].accepted.height).toBeCloseTo(single.plot.height, 1);
    expect(single.labels).toEqual([{ index: 0, start: "2026-09-26T08:00:00.000Z", x: single.bars[0].x + single.bars[0].width / 2 }]);
  });

  it("keeps quantities exact beyond the safe integer range", () => {
    const huge = buildUsageSeriesChart({ buckets: [
      bucket("2026-09-26T08:00:00.000Z", "9007199254740993", "1", 1),
      bucket("2026-09-26T09:00:00.000Z", "4503599627370496", "0", 1),
    ] });
    expect(huge.max).toBe("9007199254740994");
    expect(huge.bars[0].total).toBe("9007199254740994");
    // Die Hoehe ist ein Verhaeltnis, kein Rundungsopfer: die Haelfte bleibt die Haelfte.
    expect(huge.bars[1].accepted.height / huge.bars[0].accepted.height).toBeCloseTo(0.5, 3);
  });

  it("carries no colour and no language in its output", () => {
    const serialised = JSON.stringify(buildUsageSeriesChart({ buckets: BUCKETS }));
    for (const word of ["#", "rgb", "hsl", "var(", "currentColor", "fill", "stroke", "class"]) {
      expect(serialised.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  it("labels at most eight points of the time axis, evenly spaced", () => {
    const many = Array.from({ length: 48 }, (_, index) =>
      bucket(new Date(Date.UTC(2026, 8, 26, index)).toISOString(), String(index)));
    const chart = buildUsageSeriesChart({ buckets: many });
    expect(chart.labels.length).toBeLessThanOrEqual(8);
    const steps = new Set(chart.labels.slice(1).map((label, index) => label.index - chart.labels[index].index));
    expect(steps.size).toBe(1);
    expect(chart.labels[0].index).toBe(0);
  });
});
