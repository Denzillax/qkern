"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Receipt, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { InvoicesCard } from "@/components/console/invoices-card";
import type { ViewId } from "@/components/console/navigation";
import { billingProjectionState, periodRange, type BillingProjectionState } from "@/lib/console/billing";
import { formatMoneyMicros, formatUnitPriceMicros, parseMicros } from "@/lib/console/money";

/**
 * Einstellungen → Abrechnung, wie bei Supabase unter Project Settings →
 * Billing, aber nur lesend.
 *
 * Preisblatt und laufender Monat kommen aus einer Anfrage an
 * `GET .../usage/billing` (die Monatsprojektion; ein eigenes Preisblatt hat
 * keine REST-Flaeche, die bepreisten Zeilen tragen den Preis am Ende der
 * Periode). Die Rechnungen laedt `InvoicesCard` unabhaengig davon ueber
 * `GET .../usage/invoices`. Beide Wege sind nur GET; Preise setzt ein
 * Operator ausserhalb der Console.
 *
 * Kein Betrag und keine Waehrung steht im Quelltext: alles kommt aus der
 * Antwort und geht durch `lib/console/money.ts`.
 */
type Environment = "development" | "staging" | "production";
type Payload = Record<string, unknown>;

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

/** Die sechs Metriken aus USAGE_METRIC_DEFINITIONS, uebersetzt; unbekannte bleiben roh. */
export function billingMetricLabel(metric: string): string {
  switch (metric) {
    case "api_requests": return t("API-Anfragen");
    case "database_row_reads": return t("Gelesene Datenbankzeilen");
    case "storage_egress_bytes": return t("Storage-Egress");
    case "realtime_messages": return t("Realtime-Nachrichten");
    case "queue_operations": return t("Queue-Operationen");
    case "function_invocations": return t("Function-Aufrufe");
    default: return metric;
  }
}

function unitLabel(unit: string): string {
  switch (unit) {
    case "operations": return t("Vorgänge");
    case "rows": return t("Zeilen");
    case "bytes": return t("Bytes");
    default: return unit;
  }
}

const GROUPING = new Intl.NumberFormat("de-CH");
function quantity(value: string | null, unit: string): string {
  const parsed = parseMicros(value);
  return parsed === null ? "–" : `${GROUPING.format(parsed)} ${unitLabel(unit)}`;
}

export function BillingSettingsView({ projectId, environment, navigate }: {
  projectId: string;
  environment: Environment;
  navigate: (view: ViewId) => void;
}) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/usage/billing`;
  const [result, setResult] = useState<BillingProjectionState | { state: "loading" }>({ state: "loading" });

  // Eigener AbortController je Ladung: eine neue Ladung, ein Wechsel der
  // Umgebung oder das Aushaengen bricht die alte ab, und die setzt dann
  // keinen Zustand mehr.
  const current = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setResult({ state: "loading" });
    const { status, payload } = await readJson(url, controller.signal);
    if (controller.signal.aborted) return;
    setResult(billingProjectionState(status, payload));
  }, [url]);
  useEffect(() => {
    void load();
    return () => { current.current?.abort(); };
  }, [load]);

  const loading = result.state === "loading";
  const reload = <button className="secondary-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>;
  const projection = result.state === "ready" ? result.projection : null;
  const priced = projection ? projection.lines.filter((line) => line.priced) : [];
  const range = projection ? periodRange(projection.period) : null;

  const notReady = <>
    {result.state === "loading" && <p className="muted">{t("Projektion wird geladen…")}</p>}
    {result.state === "disabled" && <p><strong>{t("Abgeschaltet")}</strong> · {t("Usage Metering ist für diese Installation abgeschaltet; ohne Zähler gibt es weder Projektion noch Rechnungen. Eingeschaltet wird es über QKERN_USAGE_METERING_ENABLED.")}</p>}
    {result.state === "unavailable" && <p className="muted">{t("Die Abrechnung ist gerade nicht erreichbar. Versuche es gleich noch einmal.")}</p>}
    {result.state === "error" && <p className="muted">{t("Die Projektion konnte nicht geladen werden.")}{result.message ? ` ${result.message}` : ""}</p>}
  </>;

  return <div className="module-grid">
    <div className="product-preview-notice span-2"><ShieldCheck size={16}/><div><strong>{t("Abrechnung, nur lesend")}</strong><span>{t("Es gibt keine Zahlungsanbindung. Rechnungen entstehen im Rechnungslauf aus dem Nutzungsledger abgeschlossener Monate und werden nicht versandt.")}</span></div></div>

    <article className="console-card">
      <div className="card-head"><div><span>{t("PREISBLATT")} · {environment.toUpperCase()}</span><h3>{t("Preise der Organisation")}</h3></div>{reload}</div>
      {notReady}
      {projection && priced.length === 0 && <p className="muted">{t("Für diese Organisation ist noch kein Preis gesetzt. Preise setzt ein Operator, nicht die Console.")}</p>}
      {projection && priced.length > 0 && <div className="detail-list">
        {priced.map((line) => <div key={line.metric}>
          <span title={line.metric}>{billingMetricLabel(line.metric)}<small>{t("je")} {quantity(line.perUnits, line.unit)} · {projection.currency ?? "–"}</small></span>
          <strong>{line.unitPriceMicros !== null && projection.currency ? formatUnitPriceMicros(line.unitPriceMicros, projection.currency) : "–"}</strong>
        </div>)}
      </div>}
      {projection && <p className="muted">{t("Es gilt der Preis, der am Ende des laufenden Monats wirksam ist. Ein Gültig-ab-Datum liefert die REST-Fläche noch nicht.")}</p>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("LAUFENDER MONAT")}</span><h3>{projection ? `${t("Projektion")} ${projection.period}` : t("Projektion")}</h3></div><Receipt size={18}/></div>
      {notReady}
      {projection && <>
        <p>
          <strong>{projection.currency ? formatMoneyMicros(projection.totalMicros, projection.currency) : t("Kein Betrag, weil noch kein Preis gesetzt ist.")}</strong>
          {range && <> · {range.first} {t("bis")} {range.last} (UTC)</>}
        </p>
        <div className="detail-list">
          {projection.lines.map((line) => <div key={line.metric}>
            <span title={line.metric}>{billingMetricLabel(line.metric)}<small>{quantity(line.used, line.unit)}</small></span>
            <strong className={line.priced ? undefined : "muted"}>{line.priced && line.amountMicros !== null && projection.currency ? formatMoneyMicros(line.amountMicros, projection.currency) : t("ohne Preis")}</strong>
          </div>)}
        </div>
        {projection.unpricedMetrics.length > 0 && <p className="muted">{t("Ohne Preis und nicht in der Summe:")} {projection.unpricedMetrics.map(billingMetricLabel).join(", ")}</p>}
        <p className="muted">{t("Eine Projektion aus den laufenden Zählern, keine Rechnung. Je Metrik ist auf die Mikro-Einheit abgerundet; angezeigt wird auf zwei Nachkommastellen gerundet.")}</p>
      </>}
    </article>

    <div className="span-2"><InvoicesCard projectId={projectId} environment={environment} onOpenUsage={() => navigate("monitoring")}/></div>
  </div>;
}
