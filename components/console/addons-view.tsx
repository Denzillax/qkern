"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Gauge, Receipt, RefreshCw, ShieldCheck, Tag } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { billingMetricLabel, perUnits } from "@/components/console/billing-settings-view";
import { billingProjectionState, type BillingProjectionState } from "@/lib/console/billing";
import { formatUnitPriceMicros } from "@/lib/console/money";
import { USAGE_SERIES_METRIC_IDS, USAGE_SERIES_METRIC_TEXTS } from "@/lib/console/usage-series-texts";
import { ADDONS_STATES, ADDONS_TEXTS, INVOICE_SHAPE } from "@/lib/console/addons-texts";

/**
 * Einstellungen → Add-ons (2.88), nur lesend.
 *
 * Der Platzhalter versprach „Zusatzleistungen wie eigene Domain oder mehr
 * Backups". Nachgesehen in der Abrechnung gibt es beides nicht, und zwar
 * nicht, weil es noch fehlt, sondern weil die Abrechnung keine Stelle hat, an
 * der eine Zusatzleistung stehen koennte.
 *
 * Abgerechnet wird ausschliesslich je Metrik. Dieselben sechs Kennungen
 * stehen als Pruefbedingung in der Migration des Preisblatts, noch einmal in
 * der Migration der Rechnungszeilen und ein drittes Mal als Aufzaehlung in
 * der Schnittstellenbeschreibung. Eine Rechnungszeile traegt eine dieser
 * sechs, eine Menge, einen Stueckpreis, eine Bezugsgroesse und den Betrag
 * daraus; ein Feld fuer eine Bezeichnung gibt es nicht, und je Rechnung darf
 * jede Kennung genau einmal vorkommen.
 *
 * Die Seite wiederholt darum nicht die Projektion aus Einstellungen →
 * Abrechnung. Dort stehen die bepreisten Zeilen; hier steht der ganze
 * Katalog, auch die Metriken ohne Preis, denn die Frage lautet nicht „was
 * kostet es", sondern „was kann ueberhaupt etwas kosten".
 *
 * Gelesen wird dieselbe Route wie unter Abrechnung, und nur sie. Geld laeuft
 * ueber `lib/console/money.ts`; kein Betrag und keine Waehrung steht im
 * Quelltext.
 *
 * Nur lesend: ein GET, kein Schreibverb, kein Eingabefeld.
 */
type Environment = "development" | "staging" | "production";
type Payload = Record<string, unknown>;

async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    if (signal.aborted) return { status: 0, payload: {} };
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

export function AddonsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [result, setResult] = useState<BillingProjectionState | { state: "loading" }>({ state: "loading" });
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const answer = await readJson(
      `/api/v1/projects/${projectId}/environments/${environment}/usage/billing`,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    setResult(billingProjectionState(answer.status, answer.payload));
  }, [projectId, environment]);

  useEffect(() => {
    setResult({ state: "loading" });
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = result.state === "loading";
  const reload = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const projection = result.state === "ready" ? result.projection : null;
  // Der Katalog fuehrt, nicht die Antwort: Eine Metrik ohne Zeile in der
  // Projektion faellt so nicht heraus, sondern steht als unbepreist da.
  const rows = USAGE_SERIES_METRIC_IDS.map((metric) => ({
    metric,
    line: projection?.lines.find((entry) => entry.metric === metric) ?? null,
  }));
  const pricedCount = rows.filter((row) => row.line?.priced === true).length;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(ADDONS_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(ADDONS_TEXTS.title)}</h3></div><div>{reload}</div></div>
      <p className="risk medium">{t(ADDONS_TEXTS.noAddons)}</p>
      <p className="muted">{t(ADDONS_TEXTS.closedList)}</p>
      <p className="muted">{t(ADDONS_TEXTS.scope)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DER GANZE KATALOG")}</span><h3>{t(ADDONS_TEXTS.catalogTitle)}</h3></div><Tag size={18}/></div>
      <p className="muted">{t(ADDONS_TEXTS.catalogMeaning)}</p>

      {loading && <p className="muted">{t("Die Preise werden gelesen…")}</p>}
      {result.state === "disabled" && <p className="muted">{t(ADDONS_STATES.disabled)}</p>}
      {result.state === "unavailable" && <p className="muted">{t(ADDONS_STATES.unavailable)}</p>}
      {result.state === "error" && <p className="muted">{t(ADDONS_STATES.failed)}{result.message ? ` ${result.message}` : ""}</p>}

      <div className="log-row log-header"><span>{t("Metrik")}</span><span>{t("Einheit")}</span><span>{t("Stückpreis")}</span></div>
      {rows.map((row) => {
        const line = row.line;
        const priced = line?.priced === true && line.unitPriceMicros !== null && projection?.currency;
        return <div className="log-row" key={row.metric}>
          <span title={row.metric}>{billingMetricLabel(row.metric)}</span>
          <span className="muted">{t(USAGE_SERIES_METRIC_TEXTS[row.metric].unit)}</span>
          {priced
            ? <strong>{formatUnitPriceMicros(line.unitPriceMicros!, projection!.currency!)} <small className="muted">{perUnits(line.perUnits, line.unit)}</small></strong>
            : <span className="muted">{t(ADDONS_STATES.noPrice)}</span>}
        </div>;
      })}

      {projection && pricedCount === 0 && <p className="muted">{t(ADDONS_TEXTS.catalogNoPrices)}</p>}
      <p className="muted">{t(ADDONS_TEXTS.catalogPriceSource)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DIE FORM DER RECHNUNG")}</span><h3>{t("Warum eine Zusatzleistung keine Zeile hätte")}</h3></div><Receipt size={18}/></div>
      {INVOICE_SHAPE.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Gauge size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WER EINEN PREIS SETZT")}</span><h3>{t(ADDONS_TEXTS.whoSetsTitle)}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(ADDONS_TEXTS.whoSetsMeaning)}</p>
      <p className="muted">{t(ADDONS_TEXTS.whoSetsHistory)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES NICHT GIBT")}</span><h3>{t(ADDONS_TEXTS.noPaymentTitle)}</h3></div><Ban size={18}/></div>
      <p className="muted">{t(ADDONS_TEXTS.noPaymentMeaning)}</p>
      <p className="muted">{t(ADDONS_TEXTS.noPaymentNoPlans)}</p>
      <p className="muted">{t(ADDONS_TEXTS.noPaymentNoQuota)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(ADDONS_TEXTS.operatorTitle)}</h3></div><Gauge size={18}/></div>
      <p className="muted">{t(ADDONS_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(ADDONS_TEXTS.operatorMeter)}</p>
    </article>
  </div>;
}
