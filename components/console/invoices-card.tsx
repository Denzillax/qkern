"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleGauge, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatDay } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { inclusivePeriodEnd, loadConsoleInvoices, type ConsoleInvoiceResult } from "@/components/console/invoices";
import { formatMoneyMicros } from "@/lib/console/money";

/**
 * Die ausgestellten Rechnungen, lesend, aus dem eingefrorenen Dokument des
 * Rechnungslaufs. Der Ladeweg steckt in `loadConsoleInvoices`, damit er ohne
 * Browser-Testumgebung pruefbar ist; hier wird er nur eingehaengt.
 *
 * Die Karte steht unter Nutzung & Limits und unter Einstellungen →
 * Abrechnung. Dort bekommt sie `onOpenUsage` und zeigt den Weg zurueck zur
 * Nutzung. Der Betrag ist auf Rappen abgerundet, wie im Rechnungslauf; der exakte Wert aus dem
 * Dokument steht im Tooltip.
 *
 * Eine Rechnung kann seit 0080 mehr als sechs Positionen tragen, und eine
 * Position traegt eine Bezeichnung. Die Pauschalen werden darum benannt: Ihre
 * Bezeichnung steht so, wie sie in der Rechnung steht, und nicht uebersetzt --
 * sie ist der Text des Dokuments, keine Beschriftung der Oberflaeche.
 */
/** Die Bezeichnungen der Pauschalen einer Rechnung, in ihrer Reihenfolge. */
function flatLabels(invoice: { lines: Array<{ kind: "metered" | "flat"; label: string }> }): string[] {
  return invoice.lines.filter((line) => line.kind === "flat").map((line) => line.label);
}

export function InvoicesCard({ projectId, environment, onOpenUsage }: {
  projectId: string;
  environment: string;
  onOpenUsage?: () => void;
}) {
  const [result, setResult] = useState<ConsoleInvoiceResult | null>(null);
  const current = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setResult(null);
    const next = await loadConsoleInvoices(projectId, environment,
      (input, init) => fetch(input, { ...init, signal: controller.signal }));
    if (!controller.signal.aborted) setResult(next);
  }, [projectId, environment]);
  useEffect(() => {
    void load();
    return () => { current.current?.abort(); };
  }, [load]);

  return <article className="console-card chart-card">
    <div className="card-head"><div><span>{t("RECHNUNGEN")}</span><h3>{t("Ausgestellte Rechnungen")}</h3></div><button className="secondary-button" disabled={result === null} onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={result === null ? t("Lädt…") : t("Aktualisieren")} variants={tAll("Lädt…", "Aktualisieren")}/></button></div>
    {result === null && <p className="muted">{t("Rechnungen werden geladen…")}</p>}
    {result?.state === "disabled" && <p className="muted">{t("Usage Metering ist deaktiviert; ohne Zähler gibt es keinen Rechnungslauf.")}</p>}
    {result?.state === "unavailable" && <p className="muted">{t("Die Rechnungen sind gerade nicht erreichbar. Versuche es gleich noch einmal.")}</p>}
    {result?.state === "error" && <p className="muted">{t("Die Rechnungen konnten nicht geladen werden.")}</p>}
    {result?.state === "ready" && result.invoices.length === 0 && <p className="muted">{t("Noch keine Rechnung. Der Rechnungslauf fakturiert abgeschlossene Monate.")}</p>}
    {result?.state === "ready" && result.invoices.length > 0 && <div className="detail-list">
      {result.invoices.map((invoice) => <div key={invoice.invoiceNumber}>
        <span>{t("Rechnung Nr.")} {invoice.invoiceNumber}<small>{formatDay(invoice.periodStart)} {t("bis")} {formatDay(inclusivePeriodEnd(invoice.periodEnd))} · {t("ausgestellt")} {formatDay(invoice.issuedAt)} · {t("fällig")} {formatDay(invoice.dueAt)} · {invoice.lines.length} {t("Posten")}{invoice.unpricedMetrics.length > 0 ? ` · ${invoice.unpricedMetrics.length} ${t("Metriken ohne Preis")}` : ""}{flatLabels(invoice).length > 0 ? ` · ${t("Pauschalen:")} ${flatLabels(invoice).join(", ")}` : ""}</small></span>
        <strong title={`${invoice.total} ${invoice.currency}`}>{formatMoneyMicros(invoice.totalMicros, invoice.currency)}</strong>
      </div>)}
    </div>}
    {onOpenUsage && <p><button className="plain-button" type="button" onClick={onOpenUsage}><CircleGauge size={14}/> {t("Nutzung & Limits öffnen")}</button></p>}
  </article>;
}
