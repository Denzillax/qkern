"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { SECURITY_RULES, type SecurityRuleId, type SecuritySeverity } from "@/lib/console/security-advisor-texts";

/**
 * Der Sicherheitsberater (2.39), wie bei Supabase unter Advisors → Security
 * Advisor, aber nur lesend: keine Reparatur, kein Schreibzugriff.
 *
 * Die Route rechnet die Befunde auf dem Server aus Daten, die QKERN schon
 * liest. Die Ansicht zeigt sie nach Schwere und sagt zu jeder Regel, ob sie
 * lief. Texte kommen deutsch vom Server und laufen durch den Katalog.
 */
type Environment = "development" | "staging" | "production";
type Finding = { id: string; rule: SecurityRuleId; severity: SecuritySeverity; object: { kind: string; name: string }; summary: string; remedy: string };
type Check = { rule: SecurityRuleId; ran: boolean; reason?: string };
type State = "loading" | "ready" | "error";
type Payload = Record<string, unknown>;

const SEVERITIES: SecuritySeverity[] = ["high", "medium", "low"];

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

// Gleich gebaut wie im Leistungsberater, aber nicht dieselbe Sache: Die
// Stufen, die Objektarten und die Regeltabelle gehoeren jeder Seite fuer
// sich, und eine gemeinsame Fassung wuerde die beiden Berater aneinander
// binden, ohne dass sie etwas teilen.
function severityLabel(severity: SecuritySeverity): string {
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
    case "policy": return t("Policy");
    case "bucket": return t("Bucket");
    case "api_key": return t("API-Key");
    case "auth_provider": return t("Anmeldeanbieter");
    default: return kind;
  }
}

function ruleTitle(rule: SecurityRuleId): string {
  const text = SECURITY_RULES[rule];
  return text ? t(text.title) : rule;
}

export function SecurityAdvisorView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/advisors/security`;
  const [state, setState] = useState<State>(initialState ?? "loading");
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
    setMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Sicherheitsberater nicht verfügbar"));
    setState("error");
  }, [url]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Regeln werden geprüft…")}</h3></div>;
  if (state === "error") return <div className="console-card live-module-state"><ShieldAlert size={26}/><h3>{t("Sicherheitsberater nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const count = (severity: SecuritySeverity) => findings.filter((item) => item.severity === severity).length;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("HOCH")}</span><strong>{count("high")}</strong><small>{t("Befunde")}</small></div>
      <div><span>{t("MITTEL")}</span><strong>{count("medium")}</strong><small>{t("Befunde")}</small></div>
      <div><span>{t("NIEDRIG")}</span><strong>{count("low")}</strong><small>{t("Befunde")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ADVISORS")} · {environment.toUpperCase()}</span><h3>{t("Sicherheitsbefunde")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Prüft…") : t("Neu prüfen")} variants={tAll("Prüft…", "Neu prüfen")}/></button>
      </div></div>
      <p className="muted">{t("Der Berater prüft nur die aufgeführten Regeln. Was er nicht sieht, steht darunter.")}</p>
      {findings.length === 0 && <p className="muted">{t("Keine Befunde in den geprüften Regeln")}{" "}{t("Hier erscheint ein Befund, sobald eine der Regeln zutrifft; welche geprüft werden, steht in der Liste darunter.")}</p>}
      {SEVERITIES.map((severity) => {
        const group = findings.filter((item) => item.severity === severity);
        if (group.length === 0) return null;
        return <section key={severity}>
          <h4><span className={`risk ${severity}`}>{severityLabel(severity)}</span> {group.length}</h4>
          {group.map((item) => <div className="bucket-row" key={item.id}>
            <span className="bucket-icon"><ShieldAlert size={16}/></span>
            <div>
              <strong>{ruleTitle(item.rule)}</strong> · <span className="muted">{objectLabel(item.object.kind)}</span> <code>{item.object.name}</code>
              <p className="muted">{t(item.summary)}</p>
              <p><strong>{t("Was zu tun ist")}:</strong> {t(item.remedy)}</p>
            </div>
          </div>)}
        </section>;
      })}
      {checkedAt && <p className="muted">{t("Geprüft")}: {formatMoment(checkedAt, "dateTimeSeconds")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was geprüft wurde")}</h3></div><ShieldCheck size={18}/></div>
      <div className="log-row log-header"><span>{t("Regel")}</span><span>{t("Status")}</span></div>
      {checks.map((item) => <div className="log-row" key={item.rule}>
        <div><strong>{ruleTitle(item.rule)}</strong> <code>{item.rule}</code>{SECURITY_RULES[item.rule] && <p className="muted">{t(SECURITY_RULES[item.rule].reads)}</p>}{item.reason && <p className="muted">{t(item.reason)}</p>}</div>
        <span className={item.ran ? "secure" : "risk medium"}>{item.ran ? t("geprüft") : t("nicht geprüft")}</span>
      </div>)}
      <p className="muted">{t("Nicht im Blick: Funktionen mit SECURITY DEFINER, Views ohne security_invoker, Spaltenrechte, Schemas ausser public und an den Anmeldeanbietern alles ausser der Frage, ob sie email_verified verlangen.")}</p>
    </article>
  </div>;
}
