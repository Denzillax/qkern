"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleGauge, RefreshCw, TrendingUp } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { PERFORMANCE_RULES, type PerformanceRuleId, type PerformanceSeverity } from "@/lib/console/performance-advisor-texts";

/**
 * Der Leistungsberater (2.40), wie bei Supabase unter Advisors → Performance
 * Advisor, aber nur lesend: keine Reparatur, kein Schreibzugriff, kein Reset
 * eines Zaehlers.
 *
 * Die Route rechnet die Befunde auf dem Server aus der Statistik der
 * Projektdatenbank. Die Ansicht zeigt sie nach Schwere und sagt zu jeder
 * Regel, ob sie lief. Texte kommen deutsch vom Server und laufen durch den
 * Katalog. Ohne Betrieb gibt es keine Statistik und darum auch keinen Befund;
 * das sagt die Ansicht selbst.
 */
type Environment = "development" | "staging" | "production";
type Finding = { id: string; rule: PerformanceRuleId; severity: PerformanceSeverity; object: { kind: string; name: string }; summary: string; remedy: string };
type Check = { rule: PerformanceRuleId; ran: boolean; reason?: string };
type State = "loading" | "ready" | "error";
type Payload = Record<string, unknown>;

const SEVERITIES: PerformanceSeverity[] = ["high", "medium", "low"];

/** GET mit JSON-Antwort; ein Body, der kein Objekt ist, wird zu `{}`. */
async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

function severityLabel(severity: PerformanceSeverity): string {
  switch (severity) {
    case "high": return t("Hoch");
    case "medium": return t("Mittel");
    case "low": return t("Niedrig");
    default: return t("unbekannt");
  }
}

function objectLabel(kind: string): string {
  switch (kind) {
    case "table": return t("Tabelle");
    case "index": return t("Index");
    case "statement": return t("Statement");
    default: return kind;
  }
}

function ruleTitle(rule: PerformanceRuleId): string {
  const text = PERFORMANCE_RULES[rule];
  return text ? t(text.title) : rule;
}

export function PerformanceAdvisorView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/advisors/performance`;
  const [state, setState] = useState<State>("loading");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    const result = await readJson(url, controller.signal);
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const data = result.payload.data as { findings?: unknown; checks?: unknown; checkedAt?: unknown } | undefined;
    if (result.status === 200 && data && Array.isArray(data.findings) && Array.isArray(data.checks)) {
      setFindings(data.findings as Finding[]);
      setChecks(data.checks as Check[]);
      setCheckedAt(typeof data.checkedAt === "string" ? data.checkedAt : "");
      setState("ready");
      return;
    }
    setMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Leistungsberater nicht verfügbar"));
    setState("error");
  }, [url]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Regeln werden geprüft…")}</h3></div>;
  if (state === "error") return <div className="console-card live-module-state"><CircleGauge size={26}/><h3>{t("Leistungsberater nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const count = (severity: PerformanceSeverity) => findings.filter((item) => item.severity === severity).length;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("HOCH")}</span><strong>{count("high")}</strong><small>{t("Befunde")}</small></div>
      <div><span>{t("MITTEL")}</span><strong>{count("medium")}</strong><small>{t("Befunde")}</small></div>
      <div><span>{t("NIEDRIG")}</span><strong>{count("low")}</strong><small>{t("Befunde")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ADVISORS")} · {environment.toUpperCase()}</span><h3>{t("Leistungsbefunde")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Prüft…") : t("Neu prüfen")} variants={tAll("Prüft…", "Neu prüfen")}/></button>
      </div></div>
      <p className="muted">{t("Der Berater prüft nur die aufgeführten Regeln, und er braucht Statistiken aus dem Betrieb. Eine frische Datenbank hat noch keine.")}</p>
      {findings.length === 0 && <p className="muted">{t("Keine Befunde in den geprüften Regeln")}</p>}
      {SEVERITIES.map((severity) => {
        const group = findings.filter((item) => item.severity === severity);
        if (group.length === 0) return null;
        return <section key={severity}>
          <h4><span className={`risk ${severity}`}>{severityLabel(severity)}</span> {group.length}</h4>
          {group.map((item) => <div className="bucket-row" key={item.id}>
            <span className="bucket-icon"><TrendingUp size={16}/></span>
            <div>
              <strong>{ruleTitle(item.rule)}</strong> · <span className="muted">{objectLabel(item.object.kind)}</span> <code>{item.object.name}</code>
              <p className="muted">{t(item.summary)}</p>
              <p><strong>{t("Was zu tun ist")}:</strong> {t(item.remedy)}</p>
            </div>
          </div>)}
        </section>;
      })}
      {checkedAt && <p className="muted">{t("Geprüft")}: {new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "medium" }).format(new Date(checkedAt))}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was geprüft wurde")}</h3></div><CircleGauge size={18}/></div>
      <div className="log-row log-header"><span>{t("Regel")}</span><span>{t("Status")}</span></div>
      {checks.map((item) => <div className="log-row" key={item.rule}>
        <div><strong>{ruleTitle(item.rule)}</strong> <code>{item.rule}</code>{PERFORMANCE_RULES[item.rule] && <p className="muted">{t(PERFORMANCE_RULES[item.rule].reads)}</p>}{item.reason && <p className="muted">{t(item.reason)}</p>}</div>
        <span className={item.ran ? "secure" : "risk medium"}>{item.ran ? t("geprüft") : t("nicht geprüft")}</span>
      </div>)}
      <p className="muted">{t("Nicht im Blick: einzelne Abfragepläne, Sperren, Cache-Trefferquoten, Verbindungen, die Grösse der Tabellen selbst und Schemas ausser public.")}</p>
    </article>
  </div>;
}
