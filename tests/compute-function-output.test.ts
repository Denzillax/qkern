import { describe, expect, it } from "vitest";
import {
  cutLine,
  FUNCTION_OUTPUT_LIMITS,
  FunctionOutputCollector,
} from "@/lib/server/compute/function-output";

/**
 * Der Sammler der Inhaltslogs (2.98), ohne Container und ohne Datenbank.
 *
 * Geprueft werden die drei Grenzen einzeln, weil die Mutationsprobe genau
 * eine davon streicht: Faellt dann nicht der passende Fall, ist die Grenze
 * unbelegt.
 */
function clock() {
  let tick = 0;
  return () => new Date(Date.parse("2026-09-29T10:00:00.000Z") + (tick++) * 10);
}

describe("function output collector", () => {
  it("keeps every line with its stream, its moment and the order of arrival", () => {
    const collector = new FunctionOutputCollector(clock());
    collector.line("stdout", "start");
    collector.line("stderr", "warn: something");
    collector.line("stdout", "done");
    const record = collector.snapshot();
    expect(record.lines.map((line) => [line.stream, line.text, line.at, line.cut])).toEqual([
      ["stdout", "start", "2026-09-29T10:00:00.000Z", false],
      ["stderr", "warn: something", "2026-09-29T10:00:00.010Z", false],
      ["stdout", "done", "2026-09-29T10:00:00.020Z", false],
    ]);
    expect(record).toMatchObject({
      lineCount: 3, stdoutLines: 2, stderrLines: 1, truncated: false, droppedLines: 0,
      byteCount: Buffer.byteLength("startwarn: somethingdone"),
    });
    expect(collector.isEmpty()).toBe(false);
  });

  it("is empty until a line arrives, and a dropped line counts as something", () => {
    expect(new FunctionOutputCollector(clock()).isEmpty()).toBe(true);
    const tiny = new FunctionOutputCollector(clock(), { maxBytes: 1, maxLines: 10, maxLineBytes: 10 });
    tiny.line("stdout", "too long for one byte");
    expect(tiny.isEmpty()).toBe(false);
    expect(tiny.snapshot()).toMatchObject({ lineCount: 0, droppedLines: 1, truncated: true, stdoutLines: 1 });
  });

  it("stops keeping lines at the line limit and counts the rest", () => {
    const collector = new FunctionOutputCollector(clock(), { ...FUNCTION_OUTPUT_LIMITS, maxLines: 3 });
    for (let index = 0; index < 5; index += 1) collector.line("stderr", `line ${index}`);
    const record = collector.snapshot();
    expect(record.lines.map((line) => line.text)).toEqual(["line 0", "line 1", "line 2"]);
    expect(record).toMatchObject({ lineCount: 3, stderrLines: 5, droppedLines: 2, truncated: true });
  });

  it("stops keeping lines at the byte limit, counted after cutting", () => {
    const collector = new FunctionOutputCollector(clock(), { maxBytes: 10, maxLines: 100, maxLineBytes: 100 });
    collector.line("stdout", "12345");
    collector.line("stdout", "67890");
    collector.line("stdout", "x");
    const record = collector.snapshot();
    expect(record.lines.map((line) => line.text)).toEqual(["12345", "67890"]);
    expect(record).toMatchObject({ byteCount: 10, lineCount: 2, droppedLines: 1, truncated: true });
  });

  it("cuts a long line at the byte limit without tearing a multi-byte character, and marks it", () => {
    const collector = new FunctionOutputCollector(clock(), { maxBytes: 1_000, maxLines: 10, maxLineBytes: 4 });
    // "aä" sind drei Bytes; das naechste "ä" passte nur zur Haelfte hinein
    // und bleibt darum ganz draussen.
    collector.line("stdout", "aääz");
    const [line] = collector.snapshot().lines;
    expect(line).toMatchObject({ text: "aä", cut: true });
    expect(Buffer.byteLength(line!.text, "utf8")).toBeLessThanOrEqual(4);
    expect(collector.snapshot().truncated).toBe(true);
    expect(collector.snapshot().droppedLines).toBe(0);
  });

  it("drops a trailing carriage return so CRLF containers look like LF containers", () => {
    expect(cutLine("hello\r", 100)).toEqual({ text: "hello", cut: false });
    expect(cutLine("hello", 3)).toEqual({ text: "hel", cut: true });
  });

  it("carries the same limits as migration 0069", () => {
    expect(FUNCTION_OUTPUT_LIMITS).toEqual({ maxBytes: 65_536, maxLines: 500, maxLineBytes: 2_048 });
  });
});
