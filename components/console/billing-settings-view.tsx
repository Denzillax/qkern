"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Receipt, RefreshCw, ShieldCheck, Tags } from "lucide-react";
import { consoleLocale, t, tAll } from "@/components/console/console-i18n";
import { formatDay, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { InvoicesCard } from "@/components/console/invoices-card";
import type { ViewId } from "@/components/console/navigation";
import {
  billingProjectionState,
  nextInvoiceOutlook,
  periodRange,
  type BillingProjectionState,
} from "@/lib/console/billing";
import { formatMoneyMicros, formatUnitPriceMicros, parseMicros } from "@/lib/console/money";
import { getPricingDictionary } from "@/lib/i18n/pricing";
import { PRICING_PLANS, formatPlanPrice } from "@/lib/pricing/plans";

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
 *
 * Seit 0080 traegt die Projektion neben den Metriken auch die Pauschalen der
 * Umgebung. Sie stehen in derselben Karte wie der laufende Monat, weil sie in
 * derselben Summe stehen -- eine Pauschale in einer eigenen Karte waere ein
 * Betrag, den die Summe nennt und die Seite nicht zeigt.
 *
 * ## Der Tarif (2.140)
 *
 * Die Seite beantwortet vier Fragen in dieser Reihenfolge: Was ist mein
 * Tarif, was kostet er, was verbrauche ich, wann kommt die naechste Rechnung.
 *
 * Die erste Antwort ist ein Nein, und sie steht als Erstes. An einem Projekt
 * haengt kein Tarif: Es gibt im Backend keine Tarifzeile dazu. Gemessen wird
 * je Metrik, Preise setzt ein Operator, eine Rechnung entsteht im
 * Rechnungslauf. Darum zeigt die Karte den Katalog aus `lib/pricing/plans.ts`
 * und sagt dabei, dass er ein Katalog ist und keine Wahl. Es gibt keinen Knopf
 * "Tarif wechseln": Ohne Bestellweg und ohne Zahlungsanbindung waere er ein
 * Versprechen ohne Deckung.
 *
 * Die Namen und die Zielgruppen der Tarife kommen aus `lib/i18n/pricing.ts`,
 * die Betraege aus `lib/pricing/plans.ts` und durch `formatPlanPrice`. Zwei
 * Listen mit Preisen waeren zwei Wahrheiten, und die Console haette die
 * veraltete.
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

/** Einheit in Einzahl oder Mehrzahl, je nach Menge. */
function unitLabel(unit: string, count: bigint): string {
  const one = count === 1n || count === -1n;
  switch (unit) {
    case "operations": return one ? t("Vorgang") : t("Vorgänge");
    case "rows": return one ? t("Zeile") : t("Zeilen");
    case "bytes": return one ? t("Byte") : t("Bytes");
    default: return unit;
  }
}

/**
 * Die Einheit als Wort zu einer Menge, die als Dezimalstring hereinkommt.
 *
 * Die Nutzung braucht dasselbe Wort wie die Abrechnung, und `usage-view.tsx`
 * holt es sich darum hier, so wie Einstellungen -> Add-ons sich `perUnits`
 * hier holt. Dieselbe Einheit an zwei Stellen zu uebersetzen hiesse, sie
 * irgendwann verschieden zu uebersetzen.
 */
export function usageUnitLabel(unit: string, amount: string): string {
  return unitLabel(unit, parseMicros(amount) ?? 0n);
}

function quantity(value: string | null, unit: string): string {
  const parsed = parseMicros(value);
  return parsed === null ? "–" : `${formatNumber(parsed)} ${unitLabel(unit, parsed)}`;
}

/**
 * "je Vorgang" bei einer Einheit, sonst "je 1'000 Vorgänge".
 *
 * Seit 2.88 auch von Einstellungen -> Add-ons verwendet. Dieselbe Bezugsgroesse
 * an zwei Stellen zweimal zu schreiben hiesse, sie irgendwann verschieden zu
 * schreiben.
 */
export function perUnits(value: string | null, unit: string): string {
  const parsed = parseMicros(value);
  if (parsed === null) return "–";
  return parsed === 1n ? `${t("je")} ${unitLabel(unit, parsed)}` : `${t("je")} ${quantity(value, unit)}`;
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
  const outlook = projection ? nextInvoiceOutlook(projection.period) : null;

  // Der Katalog haengt an keiner Ladung: Er steht auch da, wenn die
  // Projektion nicht erreichbar ist, denn er sagt nichts ueber dieses Projekt
  // aus. Die Worte kommen in der Sprache der Console herein.
  const pricing = getPricingDictionary(consoleLocale());

  // Solange keine Projektion da ist, steht der Zustand einmal auf der Seite,
  // in einer Karte fuer Preisblatt und laufenden Monat.
  const notReady = !projection && <article className="console-card span-2">
    <div className="card-head"><div><span>{t("PREISBLATT")} · {t("LAUFENDER MONAT")} · {environment.toUpperCase()}</span><h3>{t("Abrechnung")}</h3></div>{reload}</div>
    {result.state === "loading" && <p className="muted">{t("Projektion wird geladen…")}</p>}
    {result.state === "disabled" && <p><strong>{t("Abgeschaltet")}</strong> · {t("Usage Metering ist für diese Installation abgeschaltet; ohne Zähler gibt es weder Projektion noch Rechnungen. Eingeschaltet wird es über QKERN_USAGE_METERING_ENABLED.")}</p>}
    {result.state === "unavailable" && <p className="muted">{t("Die Abrechnung ist gerade nicht erreichbar. Versuche es gleich noch einmal.")}</p>}
    {result.state === "error" && <p className="muted">{t("Die Projektion konnte nicht geladen werden.")}{result.message ? ` ${result.message}` : ""}</p>}
  </article>;

  return <div className="module-grid">
    <div className="product-preview-notice span-2"><ShieldCheck size={16}/><div><strong>{t("Abrechnung, nur lesend")}</strong><span>{t("Es gibt keine Zahlungsanbindung. Rechnungen entstehen im Rechnungslauf aus dem Nutzungsledger abgeschlossener Monate und werden nicht versandt.")}</span></div></div>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("TARIF")}</span><h3>{t("Mein Tarif")}</h3></div><Tags size={18}/></div>
      <p><strong>{t("An diesem Projekt hängt kein Tarif.")}</strong> {t("Im Backend gibt es keine Tarifzeile zu einem Projekt. Gemessen wird je Metrik, die Preise setzt ein Operator, und eine Rechnung entsteht im Rechnungslauf. Die Console kann darum nicht sagen, auf welchem Tarif du bist, und sie behauptet es auch nicht.")}</p>
      <p className="muted">{t("Was es gibt, ist der Katalog. Die Beträge unten sind dieselben wie auf der Preisseite und kommen aus derselben Quelle. Welche technischen Grenzen zu welchem Tarif gehören, ist noch nicht festgelegt, also steht hier keine.")}</p>
      <div className="detail-list">
        {PRICING_PLANS.map((plan) => <div key={plan.id}>
          <span>{pricing.plans[plan.id].name}{plan.mostPopular ? ` · ${pricing.words.badge}` : ""}<small>{pricing.plans[plan.id].audience}</small></span>
          <strong>{formatPlanPrice(plan, pricing.words)}</strong>
        </div>)}
      </div>
      <p><a className="plain-button" href="/pricing">{t("Preisseite öffnen")}</a></p>
      <p className="muted">{t("Einen Tarif wählen kann die Console nicht: Es gibt keinen Bestellweg und keine Zahlungsanbindung. Der Weg führt über die Preisseite und über ein Gespräch mit dem Betreiber.")}</p>
    </article>

    {notReady}

    {projection && <article className="console-card">
      <div className="card-head"><div><span>{t("PREISBLATT")} · {environment.toUpperCase()}</span><h3>{t("Preise der Organisation")}</h3></div>{reload}</div>
      {priced.length === 0 && <p className="muted">{t("Für diese Organisation ist noch kein Preis gesetzt. Preise setzt ein Operator, nicht die Console.")}</p>}
      {priced.length > 0 && <div className="detail-list">
        {priced.map((line) => <div key={line.metric}>
          <span title={line.metric}>{billingMetricLabel(line.metric)}<small>{perUnits(line.perUnits, line.unit)}</small></span>
          <strong>{line.unitPriceMicros !== null && projection.currency ? formatUnitPriceMicros(line.unitPriceMicros, projection.currency) : "–"}</strong>
        </div>)}
      </div>}
      <p className="muted">{t("Es gilt der Preis, der am Ende des laufenden Monats wirksam ist. Ein Gültig-ab-Datum liefert die REST-Fläche noch nicht.")}</p>
    </article>}

    {projection && <article className="console-card">
      <div className="card-head"><div><span>{t("LAUFENDER MONAT")}</span><h3>{`${t("Projektion")} ${projection.period}`}</h3></div><Receipt size={18}/></div>
      <>
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
        {projection.charges.length > 0 && <>
          <p className="muted">{t("Pauschalen dieses Monats. Sie hängen an keiner Metrik und tragen ihre eigene Bezeichnung; der Betrag steht fest und ist in der Summe enthalten.")}</p>
          <div className="detail-list">
            {projection.charges.map((charge) => <div key={charge.code}>
              <span title={charge.code}>{charge.label}<small>{t("ohne Menge")}</small></span>
              <strong>{projection.currency ? formatMoneyMicros(charge.amountMicros, projection.currency) : "–"}</strong>
            </div>)}
          </div>
        </>}
        {projection.unpricedMetrics.length > 0 && <p className="muted">{t("Ohne Preis und nicht in der Summe:")} {projection.unpricedMetrics.map(billingMetricLabel).join(", ")}</p>}
        <p className="muted">{t("Eine Projektion aus den laufenden Zählern, keine Rechnung. Jede Zeile wird einzeln auf zwei Nachkommastellen abgerundet angezeigt, die Summe als Ganzes; die Zeilen können deshalb zusammen weniger ergeben als die Summe.")}</p>
      </>
    </article>}

    {projection && outlook && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NÄCHSTE RECHNUNG")}</span><h3>{t("Was als Nächstes fakturiert wird")}</h3></div><CalendarClock size={18}/></div>
      <p><strong>{projection.currency ? formatMoneyMicros(projection.totalMicros, projection.currency) : t("Kein Betrag, weil noch kein Preis gesetzt ist.")}</strong> · {t("Stand jetzt, aus den laufenden Zählern dieser Periode.")}</p>
      <div className="detail-list">
        <div><span>{t("Periode")}<small>{t("aus der Antwort von usage/billing")}</small></span><strong>{outlook.period}</strong></div>
        <div><span>{t("Letzter Tag der Periode")}<small>{t("aus der Periode gerechnet, in UTC")}</small></span><strong>{formatDay(outlook.periodLastDay)}</strong></div>
        <div><span>{t("Fakturierbar ab")}<small>{t("der Rechnungslauf nimmt nur eine abgeschlossene Periode an")}</small></span><strong>{formatDay(outlook.closedFrom)}</strong></div>
      </div>
      <p className="muted">{t("Einen Termin gibt es nicht. Der Rechnungslauf läuft als eigener Prozess, den ein Betreiber startet, und im Backend steht kein Datum, das sagen würde wann. Eine Fälligkeit trägt erst die ausgestellte Rechnung, und zwar die Frist, die in ihrem eigenen Dokument steht.")}</p>
    </article>}

    <div className="span-2"><InvoicesCard projectId={projectId} environment={environment} onOpenUsage={() => navigate("monitoring")}/></div>
  </div>;
}
