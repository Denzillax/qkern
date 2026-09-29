"use client";

import { useState } from "react";
import { Gauge, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatDecimal, formatNumber, formatPercent } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  hottestQueryPlanNode,
  QUERY_PLAN_COST_UNIT,
  QUERY_PLAN_ESTIMATES,
  QUERY_PLAN_HOT_SHARE,
  QUERY_PLAN_MAX_STATEMENT,
  QUERY_PLAN_NODE_MEANINGS,
  QUERY_PLAN_NOT_EXECUTED,
  QUERY_PLAN_NO_CONDITIONS,
  QUERY_PLAN_OWN_COST,
  QUERY_PLAN_PLANNING_TIME,
  QUERY_PLAN_REASONS,
  QUERY_PLAN_SAME_DOOR,
  QUERY_PLAN_UNKNOWN_NODE,
  QUERY_PLAN_WHY_NO_ANALYZE,
  type QueryPlanReading,
} from "@/lib/console/query-insights";

/**
 * Berichte → Abfrage-Einblicke (2.69). Die Seite war ein Platzhalter mit dem
 * Versprechen „Erklärungen zu einzelnen Abfrageplänen: welcher Index greift,
 * wo der Plan teuer wird".
 *
 * Eingeloest wird genau das, und nicht mehr. Die Ansicht schickt das
 * Statement an **eine** Route, und diese Route laesst die Abfrage nicht
 * laufen: `EXPLAIN` ohne `ANALYZE`. Warum diese Grenze gezogen ist und was
 * sie kostet, steht in `lib/console/query-insights` und, in Worten, in der
 * ersten Karte dieser Seite.
 *
 * Nichts laeuft von selbst. Die Seite stellt beim Oeffnen keine Anfrage und
 * laedt nicht nach: Den Knopf drueckt der Mensch, so wie im SQL-Editor.
 */
type Environment = "development" | "staging" | "production";
type State = "idle" | "running" | "ready" | "error";

const EXAMPLE = "SELECT table_name\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name";

/** Die Codes, die die Route nennt, in Worte dieser Seite uebersetzt. */
function reasonFor(code: unknown, fallback: string): string {
  if (code === "READ_ONLY_QUERY_REQUIRED") return t(QUERY_PLAN_REASONS.NOT_READ_ONLY);
  if (code === "QUERY_PLAN_REJECTED") return t(QUERY_PLAN_REASONS.PLAN_REJECTED);
  if (code === "DATA_PLANE_DISABLED") return t(QUERY_PLAN_REASONS.DATABASE_DISABLED);
  if (code === "DATA_PLANE_NOT_READY") return t(QUERY_PLAN_REASONS.DATABASE_NOT_READY);
  return fallback;
}

export function QueryInsightsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const [sql, setSql] = useState(EXAMPLE);
  const [plan, setPlan] = useState<QueryPlanReading | null>(null);
  const [state, setState] = useState<State>(initialState ?? "idle");
  const [message, setMessage] = useState("");

  async function explain() {
    const statement = sql.trim();
    if (statement === "") { setState("error"); setMessage(t(QUERY_PLAN_REASONS.EMPTY)); return; }
    if (statement.length > QUERY_PLAN_MAX_STATEMENT) {
      setState("error"); setMessage(t(QUERY_PLAN_REASONS.TOO_LONG)); return;
    }
    setState("running");
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/environments/${environment}/query/explain`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statement }),
        });
      const payload = await response.json() as {
        data?: { plan?: QueryPlanReading }; error?: string; code?: string;
      };
      if (!response.ok || !payload.data?.plan) {
        setPlan(null);
        setState("error");
        setMessage(reasonFor(payload.code, t(QUERY_PLAN_REASONS.DATABASE_UNAVAILABLE)));
        return;
      }
      setPlan(payload.data.plan);
      setState("ready");
    } catch {
      setPlan(null);
      setState("error");
      setMessage(t(QUERY_PLAN_REASONS.DATABASE_UNAVAILABLE));
    }
  }

  const hottest = plan === null ? null : hottestQueryPlanNode(plan);

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ABFRAGE-EINBLICKE")} · {environment.toUpperCase()}</span>
        <h3>{t("Der Plan einer Abfrage, ohne sie auszuführen")}</h3></div><Gauge size={18}/></div>
      <p className="muted">{t(QUERY_PLAN_NOT_EXECUTED)}</p>
      <p className="muted">{t(QUERY_PLAN_WHY_NO_ANALYZE)}</p>
      <p className="muted">{t(QUERY_PLAN_SAME_DOOR)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ABFRAGE")}</span>
        <h3>{t("Ein lesendes SELECT")}</h3></div></div>
      <textarea value={sql} maxLength={QUERY_PLAN_MAX_STATEMENT} spellCheck={false}
        aria-label={t("Abfrage, deren Plan erklärt werden soll")}
        onChange={(event) => { setSql(event.target.value); setState("idle"); setMessage(""); }}/>
      <div className="card-head"><div><span className="muted">{t(QUERY_PLAN_NO_CONDITIONS)}</span></div><div>
        <button className="button small" type="button" onClick={() => void explain()} disabled={state === "running"}>
          <Play size={13}/> <StableLabel current={state === "running" ? t("Plan wird geholt…") : t("Plan zeigen")}
            variants={tAll("Plan wird geholt…", "Plan zeigen")}/>
        </button>
      </div></div>
    </article>

    {state === "running" && <article className="console-card live-module-state span-2">
      <RefreshCw size={24}/><h3>{t("Plan wird geholt…")}</h3></article>}

    {state === "error" && <article className="console-card live-module-state span-2">
      <Gauge size={26}/><h3>{t("Kein Plan")}</h3><p>{message}</p></article>}

    {state === "ready" && plan !== null && <>
      <article className="console-card span-2">
        <div className="card-head"><div><span>{t("ÜBERBLICK")}</span>
          <h3>{t("Was der Planer schätzt")}</h3></div><ShieldCheck className="secure" size={18}/></div>
        <div className="detail-list">
          <div><span>{t("Geschätzte Gesamtkosten")}</span><strong>{formatDecimal(plan.totalCost, 2)}</strong></div>
          <div><span>{t("Geschätzte Zeilen")}</span><strong>{formatNumber(Math.round(plan.planRows))}</strong></div>
          <div><span>{t("Knoten im Plan")}</span><strong>{formatNumber(plan.nodes.length)}</strong></div>
          <div><span>{t("Gemessene Planungszeit in Millisekunden")}</span><strong>
            {plan.planningTimeMs === null ? t("nicht genannt") : formatDecimal(plan.planningTimeMs, 3)}
          </strong></div>
          <div><span>{t("Benutzte Indizes")}</span><strong>
            {plan.indexes.length === 0 ? t("keiner") : plan.indexes.join(", ")}
          </strong></div>
          <div><span>{t("Sequenziell gelesene Relationen")}</span><strong>
            {plan.sequentialScans.length === 0 ? t("keine") : plan.sequentialScans.join(", ")}
          </strong></div>
        </div>
        <p className="muted">{t(QUERY_PLAN_ESTIMATES)}</p>
        <p className="muted">{t(QUERY_PLAN_COST_UNIT)}</p>
        <p className="muted">{t(QUERY_PLAN_PLANNING_TIME)}</p>
      </article>

      <article className="console-card span-2">
        <div className="card-head"><div><span>{t("TEUERSTER KNOTEN")}</span>
          <h3>{t("Wo der Plan teuer wird")}</h3></div><Gauge size={18}/></div>
        {hottest === null && <p className="muted">
          {t("Kein einzelner Knoten trägt mindestens ein Fünftel der Kosten. Der Plan verteilt sie, und es gibt hier nichts herauszuheben.")}
        </p>}
        {hottest !== null && <p>
          <code>{hottest.operation}</code>{hottest.relation === null ? "" : ` (${hottest.relation})`}
          {" "}{t("trägt")} {formatPercent(hottest.costShare)} {t("der geschätzten Kosten.")}
          {" "}{t(QUERY_PLAN_NODE_MEANINGS[hottest.operation] ?? QUERY_PLAN_UNKNOWN_NODE)}
        </p>}
        <p className="muted">{t(QUERY_PLAN_OWN_COST)}</p>
      </article>

      <article className="console-card span-2">
        <div className="card-head"><div><span>{t("PLAN")}</span>
          <h3>{t("Knoten für Knoten")}</h3></div></div>
        <div className="log-row log-header">
          <span>{t("Knoten")}</span><span>{t("Relation")}</span><span>{t("Index")}</span>
          <span>{t("Gesamtkosten")}</span><span>{t("Eigenanteil")}</span><span>{t("Geschätzte Zeilen")}</span>
        </div>
        {plan.nodes.map((node) => <div className="log-row" key={node.id}
          title={t(QUERY_PLAN_NODE_MEANINGS[node.operation] ?? node.operation)}>
          <code style={{ paddingLeft: `${node.depth}rem` }}>{node.operation}</code>
          <span>{node.relation ?? ""}</span>
          <code className={node.indexName === null ? "muted" : "secure"}>
            {node.indexName ?? t("keiner")}
          </code>
          <span>{formatDecimal(node.totalCost, 2)}</span>
          <span className={node.costShare >= QUERY_PLAN_HOT_SHARE ? "risk high" : "muted"}>
            {formatPercent(node.costShare)}
          </span>
          <span>{formatNumber(Math.round(node.planRows))}</span>
        </div>)}
        {plan.truncated && <p className="muted">
          {t("Der Plan hat mehr Knoten, als diese Seite überträgt. Die Liste ist abgeschnitten, und sie sagt es, statt so zu tun, als wäre der Plan zu Ende.")}
        </p>}
      </article>
    </>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("KNOTENARTEN")}</span>
        <h3>{t("Was die Knoten bedeuten")}</h3></div></div>
      <div className="log-row log-header"><span>{t("Knoten")}</span><span>{t("Bedeutung")}</span></div>
      {Object.entries(QUERY_PLAN_NODE_MEANINGS).map(([operation, meaning]) => <div className="log-row" key={operation}>
        <code>{operation}</code>
        <span className="muted">{t(meaning)}</span>
      </div>)}
    </article>
  </div>;
}
