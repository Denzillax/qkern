import {
  LOG_EXPLORER_SOURCES,
  isAfterLogExplorerCursor,
  mergeLogExplorerPages,
  withinLogExplorerRange,
  type LogExplorerEntry,
  type LogExplorerQuery,
  type LogExplorerSourceId,
  type LogExplorerSourceState,
} from "@/lib/console/log-explorer";

/**
 * Der Faecher des Log-Explorers (2.65).
 *
 * Diese Datei stellt **keine** Abfrage. Sie kennt je Quelle eine Funktion, die
 * eine Seite liefert, und diese Funktionen sind in der Route duenne Huellen um
 * die Dienste, die es fuer jede Quelle ohnehin schon gibt. Dadurch gibt es
 * keine zweite Stelle, an der die Zugangspruefung oder die Projektion einer
 * Quelle formuliert waere -- und damit keine, an der sie auseinanderfallen
 * koennten.
 *
 * Alles, was hier steht, ist die Orchestrierung: wie weit je Quelle gelesen
 * wird, wann aufgehoert wird, und was passiert, wenn eine Quelle nicht
 * antwortet.
 */

export type LogExplorerSourcePage = Readonly<{
  entries: readonly LogExplorerEntry[];
  /** Der quelleneigene, undurchsichtige Cursor. Nicht der gemischte. */
  nextCursor: string | null;
}>;

/** Eine Seite, neueste zuerst. `cursor` stammt aus der vorigen Antwort. */
export type LogExplorerSourceFetcher =
  (input: { cursor: string | null; limit: number }) => Promise<LogExplorerSourcePage>;

/**
 * Eine Quelle, die nicht geliefert hat -- mit dem Grund, den der Aufrufer
 * sehen darf.
 *
 * `forbidden` ist ausdruecklich kein Fehler der Suche: Jede Quelle haelt ihre
 * eigene Tuer, und wer an einer nicht vorbeikommt, soll die uebrigen trotzdem
 * bekommen.
 */
export class LogExplorerSourceFailure extends Error {
  constructor(readonly state: Extract<LogExplorerSourceState, "forbidden" | "unavailable" | "failed">) {
    super(`LOG_EXPLORER_SOURCE:${state}`);
    this.name = "LogExplorerSourceFailure";
  }
}

/**
 * Wie viele Seiten je Quelle hoechstens gelesen werden.
 *
 * Die Grenze ist da, weil ein Zeitraum ueber einer vielbeschriebenen Quelle
 * sonst beliebig viele Abfragen ausloeste -- eine Suchmaske, die die Datenbank
 * belastet, so lange jemand tippt. Wird sie erreicht, sagt die Antwort das
 * ueber den Zustand `truncated`; sie tut nicht so, als waere sie vollstaendig.
 */
export const LOG_EXPLORER_MAX_PAGES = 5;
export const LOG_EXPLORER_PAGE_SIZE = 100;

export type LogExplorerSourceReport = Readonly<{
  id: LogExplorerSourceId;
  state: LogExplorerSourceState;
  /** Wie viele Eintraege dieser Quelle in die gemischte Liste gingen. */
  matched: number;
  /** Wie viele Seiten dafuer gelesen wurden. */
  pagesRead: number;
}>;

export type LogExplorerResult = Readonly<{
  entries: readonly LogExplorerEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  sources: readonly LogExplorerSourceReport[];
}>;

type Collected = { entries: LogExplorerEntry[]; state: LogExplorerSourceState; pagesRead: number };

/**
 * Liest eine Quelle so weit, wie sie fuer diese Seite gebraucht wird.
 *
 * Aufgehoert wird aus drei Gruenden, und der dritte ist der wichtigste: Sobald
 * ein Eintrag **aelter** als der Beginn des Zeitraums ist, kann kein weiterer
 * mehr passen -- die Quelle liefert neueste zuerst. Ohne dieses Abbruchkriterium
 * laese eine Suche ueber die letzte Stunde das ganze Budget durch Eintraege des
 * letzten Jahres.
 */
async function collect(
  fetch: LogExplorerSourceFetcher,
  query: LogExplorerQuery,
): Promise<Collected> {
  const entries: LogExplorerEntry[] = [];
  let cursor: string | null = null;
  let pagesRead = 0;
  let state: LogExplorerSourceState = "ok";

  while (pagesRead < LOG_EXPLORER_MAX_PAGES) {
    const page: LogExplorerSourcePage = await fetch({ cursor, limit: LOG_EXPLORER_PAGE_SIZE });
    pagesRead += 1;
    let passedStart = false;
    for (const entry of page.entries) {
      if (query.from !== null && entry.at < query.from) { passedStart = true; continue; }
      if (!withinLogExplorerRange(entry, query)) continue;
      if (query.before !== null && !isAfterLogExplorerCursor(entry, query.before)) continue;
      entries.push(entry);
    }
    // Genug fuer diese Seite, der Rest der Quelle wird nicht gebraucht.
    if (entries.length > query.limit) break;
    if (passedStart) break;
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
    if (pagesRead === LOG_EXPLORER_MAX_PAGES) state = "truncated";
  }
  return { entries, state, pagesRead };
}

/**
 * Faechert ueber die gewaehlten Quellen und mischt zu einer Seite.
 *
 * Die Quellen laufen nebeneinander und werden einzeln abgerechnet: `allSettled`
 * statt `all`, weil `all` beim ersten abgelehnten Versprechen die ganze Suche
 * fallen liesse. Eine Console, die nichts zeigt, weil **eine** von drei
 * Quellen gerade nicht erreichbar ist, waere schlechter als eine, die zwei
 * zeigt und die dritte benennt.
 */
export async function searchLogSources(
  fetchers: Readonly<Partial<Record<LogExplorerSourceId, LogExplorerSourceFetcher>>>,
  query: LogExplorerQuery,
): Promise<LogExplorerResult> {
  const chosen = LOG_EXPLORER_SOURCES.filter((source) => query.sources.includes(source));
  const settled = await Promise.allSettled(chosen.map(async (source) => {
    const fetch = fetchers[source];
    if (!fetch) throw new LogExplorerSourceFailure("unavailable");
    return await collect(fetch, query);
  }));

  const pages: Array<readonly LogExplorerEntry[]> = [];
  const collected = new Map<LogExplorerSourceId, Collected | null>();
  const reports: LogExplorerSourceReport[] = [];

  chosen.forEach((source, index) => {
    const outcome = settled[index];
    if (outcome.status === "fulfilled") {
      collected.set(source, outcome.value);
      pages.push(outcome.value.entries);
      return;
    }
    collected.set(source, null);
    const reason = outcome.reason;
    reports.push(Object.freeze({
      id: source,
      state: reason instanceof LogExplorerSourceFailure ? reason.state : "failed",
      matched: 0,
      pagesRead: 0,
    }));
  });

  const merged = mergeLogExplorerPages(pages, { limit: query.limit, before: query.before });
  for (const source of chosen) {
    const value = collected.get(source);
    if (!value) continue;
    reports.push(Object.freeze({
      id: source,
      state: value.state,
      matched: merged.entries.filter((entry) => entry.source === source).length,
      pagesRead: value.pagesRead,
    }));
  }
  // Die Reihenfolge der Berichte folgt der festen Quellenliste, nicht der
  // Antwortzeit der Dienste.
  reports.sort((a, b) => LOG_EXPLORER_SOURCES.indexOf(a.id) - LOG_EXPLORER_SOURCES.indexOf(b.id));

  return Object.freeze({
    entries: merged.entries,
    hasMore: merged.hasMore,
    nextCursor: merged.nextCursor,
    sources: Object.freeze(reports),
  });
}
