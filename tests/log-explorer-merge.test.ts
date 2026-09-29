import { describe, expect, it } from "vitest";
import {
  LOG_EXPLORER_SOURCES,
  LogExplorerError,
  logExplorerCursor,
  logExplorerMoment,
  mergeLogExplorerPages,
  parseLogExplorerQuery,
  withinLogExplorerRange,
  type LogExplorerEntry,
  type LogExplorerQuery,
  type LogExplorerSourceId,
} from "@/lib/console/log-explorer";
import {
  LOG_EXPLORER_MAX_PAGES,
  LogExplorerSourceFailure,
  searchLogSources,
  type LogExplorerSourceFetcher,
} from "@/lib/server/logs/log-explorer-search";

/**
 * Das Mischen des Log-Explorers (2.65) ohne Datenbank.
 *
 * Geprueft wird genau das, was beim Faechern ueber mehrere Quellen schiefgehen
 * kann und in einer Ansicht niemandem auffiele:
 *
 * 1. Die Ordnung ist stabil, auch wenn zwei Quellen denselben Zeitpunkt
 *    liefern und in wechselnder Reihenfolge antworten.
 * 2. Geblaettert wird ueber Quellen hinweg, ohne Ueberspringen und ohne
 *    Doppelung -- auch am Uebergang zwischen zwei Eintraegen derselben
 *    Mikrosekunde.
 * 3. Eine Quelle, die nicht antwortet, nimmt die anderen nicht mit.
 */
const entry = (
  source: LogExplorerSourceId, id: string, at: string,
  over: Partial<LogExplorerEntry> = {},
): LogExplorerEntry => Object.freeze({
  source, id, at: logExplorerMoment(at),
  action: `${source}.event`, subject: id, outcome: "ok" as const, detail: "",
  ...over,
});

const query = (over: Partial<LogExplorerQuery> = {}): LogExplorerQuery => Object.freeze({
  sources: LOG_EXPLORER_SOURCES, from: null, to: null, limit: 50, before: null, filters: {},
  ...over,
});

/** Eine Quelle, die ihre Eintraege in Seiten der Groesse `size` herausgibt. */
function paged(entries: readonly LogExplorerEntry[], size: number): LogExplorerSourceFetcher {
  return async ({ cursor }) => {
    const offset = cursor === null ? 0 : Number(cursor);
    const page = entries.slice(offset, offset + size);
    return {
      entries: page,
      nextCursor: offset + size < entries.length ? String(offset + size) : null,
    };
  };
}

describe("log explorer merge", () => {
  it("orders by time, then source, then id — and the same input twice gives the same page", () => {
    // Derselbe Zeitpunkt in drei Quellen. Die Eingabereihenfolge ist einmal so
    // und einmal umgekehrt; das Ergebnis darf sich nicht unterscheiden.
    const at = "2026-09-20T10:00:00.000Z";
    const a = entry("auth_audit", "b", at);
    const b = entry("auth_audit", "a", at);
    const c = entry("function_invocations", "z", at);
    const d = entry("storage_objects", "a", at);

    const first = mergeLogExplorerPages([[a, b], [c], [d]], { limit: 10 });
    const second = mergeLogExplorerPages([[d], [c], [b, a]], { limit: 10 });
    const ids = first.entries.map((item) => `${item.source}:${item.id}`);
    expect(ids).toEqual([
      "auth_audit:a", "auth_audit:b", "function_invocations:z", "storage_objects:a",
    ]);
    expect(second.entries.map((item) => `${item.source}:${item.id}`)).toEqual(ids);
  });

  it("puts the newest first across sources", () => {
    const merged = mergeLogExplorerPages([
      [entry("auth_audit", "old", "2026-09-19T08:00:00.000Z")],
      [entry("function_invocations", "new", "2026-09-20T08:00:00.000Z")],
      [entry("storage_objects", "middle", "2026-09-19T20:00:00.000Z")],
    ], { limit: 10 });
    expect(merged.entries.map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("compares moments of different precision in the right order", () => {
    // Der Fall, der ohne feste Schreibweise falsch herauskaeme: lexikografisch
    // steht der Punkt vor dem Z, und ".500Z" waere damit **kleiner** als "Z".
    const merged = mergeLogExplorerPages([
      [entry("auth_audit", "whole", "2026-09-20T10:00:00Z")],
      [entry("auth_audit", "half", "2026-09-20T10:00:00.500Z")],
    ], { limit: 10 });
    expect(merged.entries.map((item) => item.id)).toEqual(["half", "whole"]);
  });

  it("reads the text form of a timestamptz, including a two-digit zone", () => {
    // Genau die Zeichenketten, die `started_at::text` herausgibt. Postgres
    // kuerzt den Versatz auf zwei Ziffern, wenn er auf volle Stunden faellt,
    // und schneidet Nullen der Millisekunden ab.
    expect(logExplorerMoment("2026-09-27 08:23:40.35+00")).toBe("2026-09-27T08:23:40.350Z");
    expect(logExplorerMoment("2026-09-27 10:23:40+02")).toBe("2026-09-27T08:23:40.000Z");
    expect(logExplorerMoment("2026-09-27 10:23:40.5+02:00")).toBe("2026-09-27T08:23:40.500Z");
    // Eine Zeit ohne Zone gilt weiterhin als UTC.
    expect(logExplorerMoment("2026-09-27 08:23:40.35")).toBe("2026-09-27T08:23:40.350Z");
    // Und was kein Zeitpunkt ist, wird abgewiesen statt stillschweigend
    // zu einer erfundenen Stelle in der Ordnung zu werden.
    expect(() => logExplorerMoment("2026-09-27 08:23:40.35+00Z")).toThrow(LogExplorerError);
  });

  it("pages across sources without skipping or repeating an entry", () => {
    const at = "2026-09-20T10:00:00.000Z";
    const pages = [
      [entry("auth_audit", "a1", at), entry("auth_audit", "a2", at)],
      [entry("function_invocations", "f1", at), entry("function_invocations", "f2", at)],
      [entry("storage_objects", "s1", at)],
    ];
    const seen: string[] = [];
    let before: string | null = null;
    for (let round = 0; round < 10; round += 1) {
      const page: ReturnType<typeof mergeLogExplorerPages> =
        mergeLogExplorerPages(pages, { limit: 2, before });
      seen.push(...page.entries.map((item) => `${item.source}:${item.id}`));
      if (!page.hasMore || page.nextCursor === null) break;
      before = page.nextCursor;
    }
    // Alle fuenf, jeder genau einmal, in der Gesamtordnung.
    expect(seen).toEqual([
      "auth_audit:a1", "auth_audit:a2", "function_invocations:f1",
      "function_invocations:f2", "storage_objects:s1",
    ]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("shows an entry once even when a source repeats it across pages", () => {
    const duplicate = entry("auth_audit", "a1", "2026-09-20T10:00:00.000Z");
    const merged = mergeLogExplorerPages([[duplicate], [duplicate]], { limit: 10 });
    expect(merged.entries).toHaveLength(1);
  });

  it("reports the cursor of the last shown entry, not of the last read one", () => {
    const merged = mergeLogExplorerPages([
      [entry("auth_audit", "a", "2026-09-20T10:00:00.000Z")],
      [entry("auth_audit", "b", "2026-09-19T10:00:00.000Z")],
    ], { limit: 1 });
    expect(merged.hasMore).toBe(true);
    expect(merged.nextCursor).toBe(logExplorerCursor(merged.entries[0]));
  });

  it("keeps the range half-open: from counts, to does not", () => {
    const range = { from: "2026-09-20T10:00:00.000Z", to: "2026-09-20T11:00:00.000Z" };
    expect(withinLogExplorerRange(entry("auth_audit", "a", range.from), range)).toBe(true);
    expect(withinLogExplorerRange(entry("auth_audit", "b", range.to), range)).toBe(false);
    expect(withinLogExplorerRange(
      entry("auth_audit", "c", "2026-09-20T10:30:00.000Z"), range)).toBe(true);
  });
});

describe("log explorer fan-out", () => {
  it("leaves the other sources usable when one fails", async () => {
    const result = await searchLogSources({
      auth_audit: paged([entry("auth_audit", "a", "2026-09-20T10:00:00.000Z")], 10),
      function_invocations: async () => { throw new LogExplorerSourceFailure("forbidden"); },
      function_output: paged([entry("function_output", "o", "2026-09-20T09:30:00.000Z")], 10),
      storage_objects: paged([entry("storage_objects", "s", "2026-09-20T09:00:00.000Z")], 10),
    }, query());

    expect(result.entries.map((item) => item.id)).toEqual(["a", "o", "s"]);
    const states = Object.fromEntries(result.sources.map((report) => [report.id, report.state]));
    expect(states).toEqual({
      auth_audit: "ok", function_invocations: "forbidden", function_output: "ok", storage_objects: "ok",
    });
    // Die Berichte folgen der festen Quellenliste, nicht der Antwortzeit.
    expect(result.sources.map((report) => report.id))
      .toEqual([...LOG_EXPLORER_SOURCES]);
  });

  it("calls an unexpected rejection a failure and still answers", async () => {
    const result = await searchLogSources({
      auth_audit: async () => { throw new Error("boom"); },
      function_invocations: paged([entry("function_invocations", "f", "2026-09-20T10:00:00.000Z")], 10),
    }, query({ sources: ["auth_audit", "function_invocations"] }));
    expect(result.entries.map((item) => item.id)).toEqual(["f"]);
    expect(result.sources.find((report) => report.id === "auth_audit")?.state).toBe("failed");
  });

  it("marks a source unavailable when nothing can read it", async () => {
    const result = await searchLogSources({}, query({ sources: ["storage_objects"] }));
    expect(result.entries).toEqual([]);
    expect(result.sources[0]).toMatchObject({ id: "storage_objects", state: "unavailable" });
  });

  it("stops reading a source as soon as it is past the start of the range", async () => {
    // Zehn Seiten waeren da; der Zeitraum deckt nur die erste. Ohne das
    // Abbruchkriterium liefe das ganze Budget durch.
    const entries = Array.from({ length: 50 }, (_, index) =>
      entry("auth_audit", `a${index}`,
        new Date(Date.parse("2026-09-20T10:00:00.000Z") - index * 3_600_000).toISOString()));
    const result = await searchLogSources({ auth_audit: paged(entries, 5) },
      query({ sources: ["auth_audit"], from: "2026-09-20T08:00:00.000Z" }));
    expect(result.entries.map((item) => item.id)).toEqual(["a0", "a1", "a2"]);
    expect(result.sources[0]).toMatchObject({ state: "ok", pagesRead: 1 });
  });

  it("says truncated instead of pretending the answer is complete", async () => {
    // Jede Seite traegt genau einen Eintrag, und alle liegen im Zeitraum. Nach
    // dem Budget ist die Quelle nicht am Ende -- und sagt das.
    const entries = Array.from({ length: 100 }, (_, index) =>
      entry("auth_audit", `a${index}`,
        new Date(Date.parse("2026-09-20T10:00:00.000Z") - index * 1_000).toISOString()));
    const result = await searchLogSources({ auth_audit: paged(entries, 1) },
      query({ sources: ["auth_audit"], limit: 50 }));
    expect(result.sources[0]).toMatchObject({
      state: "truncated", pagesRead: LOG_EXPLORER_MAX_PAGES,
    });
    expect(result.entries).toHaveLength(LOG_EXPLORER_MAX_PAGES);
  });

  it("counts per source only what really made it into the page", async () => {
    const result = await searchLogSources({
      auth_audit: paged([
        entry("auth_audit", "a1", "2026-09-20T10:00:00.000Z"),
        entry("auth_audit", "a2", "2026-09-20T09:00:00.000Z"),
      ], 10),
      storage_objects: paged([entry("storage_objects", "s", "2026-09-20T08:00:00.000Z")], 10),
    }, query({ sources: ["auth_audit", "storage_objects"], limit: 1 }));
    expect(result.entries.map((item) => item.id)).toEqual(["a1"]);
    expect(result.sources.find((report) => report.id === "auth_audit")?.matched).toBe(1);
    expect(result.sources.find((report) => report.id === "storage_objects")?.matched).toBe(0);
    expect(result.hasMore).toBe(true);
  });
});

describe("log explorer query", () => {
  it("defaults to every source, newest fifty", () => {
    const parsed = parseLogExplorerQuery({});
    expect(parsed.sources).toEqual([...LOG_EXPLORER_SOURCES]);
    expect(parsed.limit).toBe(50);
    expect(parsed.from).toBeNull();
    expect(parsed.filters).toEqual({});
  });

  it("orders the chosen sources by the fixed list, not by the input", () => {
    expect(parseLogExplorerQuery({ sources: "storage_objects,auth_audit" }).sources)
      .toEqual(["auth_audit", "storage_objects"]);
  });

  it("normalises both ends of the range to one spelling", () => {
    const parsed = parseLogExplorerQuery({
      from: "2026-09-20T10:00:00Z", to: "2026-09-20T11:00:00.5Z",
    });
    expect(parsed.from).toBe("2026-09-20T10:00:00.000Z");
    expect(parsed.to).toBe("2026-09-20T11:00:00.500Z");
  });

  it("refuses what it does not understand instead of ignoring it", () => {
    const codes = (raw: Record<string, string>) => {
      try { parseLogExplorerQuery(raw); return "accepted"; }
      catch (error) { return error instanceof LogExplorerError ? error.code : "other"; }
    };
    expect(codes({ statement: "SELECT 1" })).toBe("UNKNOWN_PARAMETER");
    expect(codes({ sql: "SELECT 1" })).toBe("UNKNOWN_PARAMETER");
    expect(codes({ outcomes: "completed" })).toBe("UNKNOWN_PARAMETER");
    expect(codes({ sources: "audit_logs" })).toBe("UNKNOWN_SOURCE");
    expect(codes({ sources: "" })).toBe("UNKNOWN_SOURCE");
    expect(codes({ from: "yesterday" })).toBe("INVALID_RANGE");
    expect(codes({ from: "2026-09-20T11:00:00Z", to: "2026-09-20T10:00:00Z" })).toBe("INVALID_RANGE");
    expect(codes({ limit: "0" })).toBe("INVALID_LIMIT");
    expect(codes({ limit: "101" })).toBe("INVALID_LIMIT");
    expect(codes({ limit: "20 " })).toBe("INVALID_LIMIT");
    expect(codes({ before: "nonsense" })).toBe("INVALID_CURSOR");
    expect(codes({ outcome: "maybe" })).toBe("INVALID_FILTER");
    // Ein Filter ohne seine Quelle ist eine Suche, die nichts bedeutet.
    expect(codes({ sources: "auth_audit", outcome: "completed" })).toBe("INVALID_FILTER");
    expect(codes({ sources: "auth_audit", authStatus: "failed" })).toBe("accepted");
  });
});
