"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileClock, ListFilter, RefreshCw, Save, Search } from "lucide-react";
import { formatMoment } from "@/components/console/console-display";
import { t, tAll } from "@/components/console/console-i18n";
import { OptionMenu } from "@/components/console/option-menu";
import { StableLabel } from "@/components/stable-label";
import {
  LOG_EXPLORER_BUDGET,
  LOG_EXPLORER_FILTERS,
  LOG_EXPLORER_NOT_SQL,
  LOG_EXPLORER_ORDER,
  LOG_EXPLORER_OUTCOMES,
  LOG_EXPLORER_OUT_OF_REACH,
  LOG_EXPLORER_SAME_DOOR,
  LOG_EXPLORER_SAVED,
  LOG_EXPLORER_SOURCES,
  LOG_EXPLORER_SOURCE_DEFINITIONS,
  LOG_EXPLORER_SOURCE_STATES,
  LOG_EXPLORER_WHY_NOT_SQL,
  type LogExplorerEntry,
  type LogExplorerFilterId,
  type LogExplorerSourceId,
  type LogExplorerSourceState,
} from "@/lib/console/log-explorer";

/**
 * Logs → Explorer (2.65). Die Seite war ein Platzhalter mit dem Versprechen
 * „Logs mit SQL durchsuchen, speichern, als Vorlage ablegen".
 *
 * Eingeloest werden das Durchsuchen und das Speichern. Nicht eingeloest — und
 * auf der Seite als erster Satz gesagt — wird das SQL: Alle log-artigen Zeilen
 * von QKERN liegen in der Control Plane, und dort stehen die Zeilen aller
 * Organisationen in denselben Tabellen. Die Begruendung steht ausfuehrlich in
 * `lib/console/log-explorer`.
 *
 * Die Ansicht stellt genau eine Anfrage, an genau eine Route, mit GET. Sie
 * kennt kein Schreibverb und kein Abfragefeld.
 *
 * Eine gespeicherte Suche haelt den strukturierten Filter und liegt in der
 * Ablage dieses Browsers. Sie bekommt bewusst keine Tabelle in der Control
 * Plane: Eine Migration fuer eine Bequemlichkeit, die eine Person auf einem
 * Geraet benutzt, waere fuer diesen Schnitt ausser Verhaeltnis, und eine
 * gespeicherte Suche ist auch nichts, was zwei Personen je teilen muessten.
 */
type Environment = "development" | "staging" | "production";
type Payload = Record<string, unknown>;

type SourceReport = {
  id: LogExplorerSourceId; state: LogExplorerSourceState;
  matched: number; pagesRead: number; route: string; capability: string;
};
type Result = {
  entries: LogExplorerEntry[]; hasMore: boolean; nextCursor: string | null;
  sources: SourceReport[];
};
type State = "loading" | "ready" | "error";

/** Die Zeitraeume der Maske. Feste Fenster statt zweier freier Felder. */
const RANGES = [
  { id: "1h", label: "Letzte Stunde", hours: 1 },
  { id: "24h", label: "Letzte 24 Stunden", hours: 24 },
  { id: "7d", label: "Letzte 7 Tage", hours: 24 * 7 },
  { id: "30d", label: "Letzte 30 Tage", hours: 24 * 30 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

type Draft = {
  range: RangeId;
  sources: LogExplorerSourceId[];
  filters: Partial<Record<LogExplorerFilterId, string>>;
};

const EMPTY: Draft = { range: "24h", sources: [...LOG_EXPLORER_SOURCES], filters: {} };
const PAGE_SIZE = 50;

/**
 * Die Beschriftung des Eintrags, der einen getypten Filter wieder weglaesst --
 * je Filter in seinen eigenen Worten, weil zwei Filter gleichzeitig offen
 * stehen koennen und zweimal "Jeder Ausgang" nebeneinander nichts unterscheidet.
 *
 * Als `switch` mit festen Zeichenketten und nicht als Tabelle: Der
 * Uebersetzungsvertrag sucht im Quelltext nach Aufrufen von `t` mit einem
 * festen Text darin, und ein Text hinter einer Variablen faellt durch diese
 * Suche.
 */
function anyLabel(id: LogExplorerFilterId): string {
  switch (id) {
    case "authStatus": return t("Jeder Ausgang der Handlung");
    case "authActor": return t("Jede Art von Akteur");
    case "outcome": return t("Jeder Ausgang des Aufrufs");
    case "objectStatus": return t("Jedes Urteil");
  }
}

function storageKey(projectId: string, environment: Environment): string {
  return `qkern.log-explorer.${projectId}.${environment}`;
}

type SavedSearch = { name: string; draft: Draft };

function readSaved(key: string): SavedSearch[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Was aus der Ablage kommt, ist Eingabe: Es wird geprueft wie eine, nicht
    // geglaubt. Ein fremder Eintrag faellt weg statt die Seite zu brechen.
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as { name?: unknown; draft?: unknown };
      const draft = candidate.draft as Draft | undefined;
      if (typeof candidate.name !== "string" || !draft || typeof draft !== "object") return [];
      if (!RANGES.some((range) => range.id === draft.range)) return [];
      if (!Array.isArray(draft.sources)) return [];
      const sources = LOG_EXPLORER_SOURCES.filter((source) => draft.sources.includes(source));
      if (sources.length === 0) return [];
      const filters: Partial<Record<LogExplorerFilterId, string>> = {};
      for (const [id, definition] of Object.entries(LOG_EXPLORER_FILTERS)) {
        const value = (draft.filters ?? {})[id as LogExplorerFilterId];
        if (typeof value === "string" && (definition.values as readonly string[]).includes(value) &&
            sources.includes(definition.source)) {
          filters[id as LogExplorerFilterId] = value;
        }
      }
      return [{ name: candidate.name.slice(0, 60), draft: { range: draft.range, sources, filters } }];
    }).slice(0, 20);
  } catch { return []; }
}

function writeSaved(key: string, searches: SavedSearch[]): void {
  try { window.localStorage.setItem(key, JSON.stringify(searches)); } catch { /* privater Modus */ }
}

async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return {
      status: response.status,
      payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {},
    };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

export function LogExplorerView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/logs/search`;
  const key = storageKey(projectId, environment);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [name, setName] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => { setSaved(readSaved(key)); }, [key]);

  const load = useCallback(async (initial: boolean, next: Draft, before: string | null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);

    const hours = RANGES.find((range) => range.id === next.range)?.hours ?? 24;
    const query = new URLSearchParams({
      sources: next.sources.join(","),
      from: new Date(Date.now() - hours * 3_600_000).toISOString(),
      limit: String(PAGE_SIZE),
    });
    for (const [id, value] of Object.entries(next.filters)) {
      if (value) query.set(id, value);
    }
    if (before) query.set("before", before);

    const answer = await readJson(`${base}?${query.toString()}`, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);

    const data = answer.payload.data as Result | undefined;
    if (answer.status !== 200 || !data || !Array.isArray(data.entries)) {
      const reason = typeof answer.payload.reason === "string" ? answer.payload.reason : "";
      const error = typeof answer.payload.error === "string" ? answer.payload.error : "";
      setResult(null);
      setMessage(reason || error || t("Die Suche hat nicht geantwortet."));
      setState("error");
      return;
    }
    setResult(data);
    setMessage("");
    setState("ready");
  }, [base]);

  useEffect(() => {
    void load(true, draft, cursor);
    return () => request.current?.abort();
  }, [load, draft, cursor]);

  const change = (next: Partial<Draft>) => {
    // Jede Aenderung der Maske setzt den Seitenschnitt zurueck: Seite 3 einer
    // anderen Suche waere eine Aussage ueber nichts.
    setCursor(null);
    setDraft((current) => {
      const merged = { ...current, ...next };
      // Ein Filter ohne seine Quelle ist eine Suche, die nichts bedeutet --
      // und ausserdem ein 400.
      const filters: Partial<Record<LogExplorerFilterId, string>> = {};
      for (const [id, value] of Object.entries(merged.filters)) {
        const definition = LOG_EXPLORER_FILTERS[id as LogExplorerFilterId];
        if (value && merged.sources.includes(definition.source)) {
          filters[id as LogExplorerFilterId] = value;
        }
      }
      return { ...merged, filters };
    });
  };

  const keepSearch = () => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const next = [...saved.filter((entry) => entry.name !== trimmed), { name: trimmed, draft }].slice(-20);
    setSaved(next);
    writeSaved(key, next);
    setName("");
  };

  const forgetSearch = (entry: SavedSearch) => {
    const next = saved.filter((candidate) => candidate.name !== entry.name);
    setSaved(next);
    writeSaved(key, next);
  };

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LOGS")} · {environment.toUpperCase()}</span>
        <h3>{t("Log-Explorer")}</h3></div><FileClock size={18}/></div>
      <p className="muted">{t(LOG_EXPLORER_NOT_SQL)}</p>
      <p className="muted">{t(LOG_EXPLORER_WHY_NOT_SQL)}</p>
      <p className="muted">{t(LOG_EXPLORER_SAME_DOOR)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("SUCHE")}</span><h3>{t("Zeitraum, Quellen, Filter")}</h3></div><div>
        {/* Dasselbe Bauteil wie das Umgebungsmenue in der Kopfzeile. Ohne
            Erklaerzeile: "Letzte 7 Tage" sagt das Fenster schon, und was
            darueber hinaus gilt -- dass ein langes Fenster am Lesebudget
            einer Quelle enden kann -- gilt fuer jeden Eintrag gleich und
            steht darum als Satz unter der Maske. */}
        <OptionMenu value={draft.range} ariaLabel={t("Zeitraum")} listLabel={t("Zeitraum wählen")}
          icon={<ListFilter size={14} aria-hidden="true"/>}
          onChange={(next) => change({ range: next })}
          options={RANGES.map((range) => ({ id: range.id, label: t(range.label) }))}/>
        <button className="secondary-button" onClick={() => void load(false, draft, cursor)} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")}
            variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>

      <div className="log-row log-header"><span>{t("Quelle")}</span><span>{t("Was eine Zeile ist")}</span>
        <span>{t("Rolle")}</span></div>
      {LOG_EXPLORER_SOURCES.map((source) => {
        const definition = LOG_EXPLORER_SOURCE_DEFINITIONS[source];
        return <div className="log-row" key={source}>
          <label><input type="checkbox" checked={draft.sources.includes(source)}
            onChange={(event) => change({
              sources: event.target.checked
                ? LOG_EXPLORER_SOURCES.filter((entry) => entry === source || draft.sources.includes(entry))
                : draft.sources.filter((entry) => entry !== source),
            })}/> {t(definition.label)}</label>
          <span className="muted">{t(definition.meaning)}</span>
          <code>{definition.capability}</code>
        </div>;
      })}

      <div className="card-head"><div><span>{t("GETYPTE FILTER")}</span></div><div>
        {(Object.keys(LOG_EXPLORER_FILTERS) as LogExplorerFilterId[]).map((id) => {
          const definition = LOG_EXPLORER_FILTERS[id];
          if (!draft.sources.includes(definition.source)) return null;
          return <OptionMenu key={id} value={draft.filters[id] ?? ""}
            ariaLabel={t(definition.label)} listLabel={t(definition.label)}
            icon={<Search size={14} aria-hidden="true"/>}
            onChange={(next) => change({ filters: { ...draft.filters, [id]: next } })}
            options={[
              // Der erste Eintrag laesst den Filter weg, und die Erklaerzeile
              // sagt die Folge: Ohne Wert steht der Name nicht in der Anfrage.
              { id: "", label: anyLabel(id), hint: t("Dieser Filter wird nicht mitgeschickt") },
              // Die Werte selbst bleiben, wie die Route sie annimmt. `app_user`
              // ist ein Parameterwert und keine Prosa; uebersetzt waere er in
              // jeder Sprache ein anderer Filter, und die Route kennt nur
              // diesen einen.
              ...definition.values.map((value) => ({ id: value, label: value })),
            ]}/>;
        })}
      </div></div>
      <p className="muted">{t(LOG_EXPLORER_ORDER)}</p>
      <p className="muted">{t(LOG_EXPLORER_BUDGET)}</p>
    </article>

    {state === "loading" && <article className="console-card live-module-state span-2">
      <RefreshCw size={24}/><h3>{t("Die Suche läuft…")}</h3></article>}

    {state === "error" && <article className="console-card live-module-state span-2">
      <FileClock size={26}/><h3>{t("Die Suche hat nicht geantwortet.")}</h3><p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true, draft, cursor)}>
        <RefreshCw size={14}/> {t("Noch einmal")}</button>
    </article>}

    {state === "ready" && result && <>
      <article className="console-card span-2">
        <div className="card-head"><div><span>{t("TREFFER")}</span>
          <h3>{result.entries.length} {t("Einträge")}</h3></div><FileClock size={18}/></div>
        {result.entries.length === 0 &&
          <p className="muted">{t("In diesem Zeitraum hat keine der gewählten Quellen einen Eintrag.")}</p>}
        {result.entries.length > 0 && <>
          <div className="log-row log-header">
            <span>{t("Zeitpunkt")}</span><span>{t("Quelle")}</span><span>{t("Handlung")}</span>
            <span>{t("Gegenstand")}</span><span>{t("Ausgang")}</span><span>{t("Zusatz")}</span>
          </div>
          {result.entries.map((entry) => <div className="log-row" key={`${entry.source}:${entry.id}`}>
            <time>{formatMoment(entry.at, "dateTimeSeconds")}</time>
            <span>{t(LOG_EXPLORER_SOURCE_DEFINITIONS[entry.source].label)}</span>
            <code>{entry.action}</code>
            <span>{entry.subject}</span>
            <span className={entry.outcome === "ok" ? "secure" : entry.outcome === "failed" ? "risk high" : "muted"}>
              {t(LOG_EXPLORER_OUTCOMES[entry.outcome])}
            </span>
            <span className="muted">{entry.detail}</span>
          </div>)}
          <p className="muted">{t("neueste zuerst")}</p>
        </>}
        <div className="card-head"><div/><div>
          <button className="secondary-button" onClick={() => setCursor(null)} disabled={refreshing || cursor === null}>
            {t("Von vorn")}
          </button>
          <button className="secondary-button" onClick={() => setCursor(result.nextCursor)}
            disabled={refreshing || !result.hasMore || !result.nextCursor}>
            {t("Ältere")}
          </button>
        </div></div>
      </article>

      <article className="console-card span-2">
        <div className="card-head"><div><span>{t("JE QUELLE")}</span>
          <h3>{t("Was gelesen wurde und was nicht")}</h3></div><FileClock size={18}/></div>
        <div className="log-row log-header"><span>{t("Quelle")}</span><span>{t("Zustand")}</span>
          <span>{t("Treffer")}</span><span>{t("Route")}</span></div>
        {result.sources.map((report) => <div className="log-row" key={report.id}>
          <span>{t(LOG_EXPLORER_SOURCE_DEFINITIONS[report.id].label)}</span>
          <span className={report.state === "ok" ? "secure" : report.state === "truncated" ? "muted" : "risk high"}>
            {t(LOG_EXPLORER_SOURCE_STATES[report.state])}
          </span>
          <span>{report.matched}</span>
          <code>{report.route}</code>
        </div>)}
      </article>
    </>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("GESPEICHERT")}</span>
        <h3>{t("Gespeicherte Suchen")}</h3></div><Save size={18}/></div>
      <p className="muted">{t(LOG_EXPLORER_SAVED)}</p>
      <div className="card-head"><div>
        <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)}
          aria-label={t("Name der Suche")} placeholder={t("Name der Suche")}/>
      </div><div>
        <button className="secondary-button" onClick={keepSearch} disabled={name.trim() === ""}>
          <Save size={14}/> {t("Suche merken")}
        </button>
      </div></div>
      {saved.length === 0 && <p className="muted">{t("Hier ist noch keine Suche gemerkt. Eine gemerkte Suche hält Quelle, Fenster und Filter fest, damit dieselbe Frage nicht jedes Mal neu zusammengeklickt werden muss.")}</p>}
      {saved.map((entry) => <div className="log-row" key={entry.name}>
        <span>{entry.name}</span>
        <span className="muted">{entry.draft.sources.map((source) =>
          t(LOG_EXPLORER_SOURCE_DEFINITIONS[source].label)).join(", ")}</span>
        <button className="secondary-button" onClick={() => { setCursor(null); setDraft(entry.draft); }}>
          {t("Anwenden")}
        </button>
        <button className="secondary-button" onClick={() => forgetSearch(entry)}>{t("Vergessen")}</button>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("AUSSERHALB")}</span>
        <h3>{t("Was dieser Explorer nicht erreicht")}</h3></div><FileClock size={18}/></div>
      <div className="log-row log-header"><span>{t("Quelle")}</span><span>{t("Warum nicht")}</span></div>
      {LOG_EXPLORER_OUT_OF_REACH.map((entry) => <div className="log-row" key={entry.label}>
        <span>{t(entry.label)}</span>
        <span className="muted">{t(entry.reason)}</span>
      </div>)}
    </article>
  </div>;
}
