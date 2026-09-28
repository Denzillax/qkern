"use client";

import { Activity, Bot, Braces, ChevronRight, CircleGauge, Database, HardDrive, Users } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatDecimal, formatMoment, formatNumber } from "@/components/console/console-display";
import type { ViewId } from "@/components/console/navigation";
import type { Snapshot } from "@/lib/console/console-snapshot";
import type { Project } from "@/lib/types";

/**
 * Die Uebersicht, aus `console-app.tsx` ausgezogen.
 *
 * Sie holt nichts. Kennzahlen, Aktivitaet und Freigaben stehen schon in den
 * Requisiten, die die Schale geladen hat, und darum gibt es hier keinen
 * Ladezustand.
 */
function formatTime(value: string) { return formatMoment(value, "hourMinute"); }

export function OverviewView({ snapshot, project, navigate }: { snapshot: Snapshot; project: Project; navigate: (view: ViewId) => void }) {
  const metrics = [
    ["API-ANFRAGEN", formatNumber(project.apiRequests), Braces],
    [t("AKTIVE NUTZER"), formatNumber(project.activeUsers), Users],
    [t("DATENBANK"), `${formatNumber(project.databaseSizeMb)} MB`, Database],
    ["STORAGE", `${formatDecimal(project.storageSizeMb / 1024, 2)} GB`, HardDrive],
  ] as const;
  return <>
    <div className="metric-grid">{metrics.map(([label, value, Icon]) => <article className="console-card metric-tile" key={label}><div><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{t("Aus dem Projektdatensatz")}</small></article>)}</div>
    <div className="dashboard-grid">
      <article className="console-card chart-card placeholder-state"><CircleGauge size={26}/><div><span className="console-kicker">{t("API-Verlauf")}</span><h3>{t("Noch nicht verbunden")}</h3><p>{t("Der Metrik-Dienst liefert noch keine Zeitreihe. Bis dahin zeigt diese Karte keinen erfundenen Verlauf.")}</p></div></article>
      <article className="console-card health-card placeholder-state"><Activity size={26}/><div><span className="console-kicker">{t("Dienststatus")}</span><h3>{t("Noch nicht verbunden")}</h3><p>{t("Latenzen je Dienst kommen mit dem Metrik-Dienst. Dass die Console antwortet, siehst du oben rechts.")}</p></div></article>
    </div>
    <div className="dashboard-grid lower">
      <article className="console-card"><div className="card-head"><div><span>{t("LETZTE AKTIVITÄT")}</span><h3>{t("Agentenaktionen")}</h3></div><button className="plain-button" onClick={() => navigate("activity")}>{t("Alle anzeigen")}</button></div>{snapshot.audit.slice(0,3).map((event) => <div className="event-row" key={event.id}><span className="event-icon"><Bot size={14}/></span><div><strong>{event.action}</strong><small>{event.actor} · {event.resource}</small></div><time>{formatTime(event.createdAt)}</time></div>)}</article>
      <article className="console-card"><div className="card-head"><div><span>{t("FREIGABEN")}</span><h3>{snapshot.approvals.filter((item) => item.status === "pending").length} offen</h3></div><button className="plain-button" onClick={() => navigate("approvals")}>{t("Prüfen")}</button></div>{snapshot.approvals.slice(0,2).map((approval) => <div className="approval-mini" key={approval.id}><span className={`risk ${approval.risk}`}>{approval.risk}</span><div><strong>{approval.action}</strong><small>{approval.requestedBy} · {approval.environment}</small></div><ChevronRight size={15}/></div>)}</article>
    </div>
  </>;
}
