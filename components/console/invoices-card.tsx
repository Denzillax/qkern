"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleGauge, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
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
 */
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
        <span>{t("Rechnung Nr.")} {invoice.invoiceNumber}<small>{invoice.periodStart} {t("bis")} {inclusivePeriodEnd(invoice.periodEnd)} · {t("ausgestellt")} {invoice.issuedAt.slice(0, 10)} · {t("fällig")} {invoice.dueAt.slice(0, 10)} · {invoice.lines.length} {t("Posten")}{invoice.unpricedMetrics.length > 0 ? ` · ${invoice.unpricedMetrics.length} ${t("Metriken ohne Preis")}` : ""}</small></span>
        <strong title={`${invoice.total} ${invoice.currency}`}>{formatMoneyMicros(invoice.totalMicros, invoice.currency)}</strong>
      </div>)}
    </div>}
    {onOpenUsage && <p><button className="plain-button" type="button" onClick={onOpenUsage}><CircleGauge size={14}/> {t("Nutzung & Limits öffnen")}</button></p>}
  </article>;
}
