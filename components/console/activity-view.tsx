"use client";

import { useState } from "react";
import { Bot, ListFilter, Search } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatHourMinute } from "@/components/console/console-format";
import type { AuditEvent } from "@/lib/types";

/**
 * Aktivitaet und Logs, aus `console-app.tsx` ausgezogen. Die Ereignisse
 * stehen in den Requisiten; diese Ansicht holt nichts.
 *
 * **Die Suche sucht jetzt (2.158).** Das Feld stand seit dem Auszug da und
 * hatte keinen Zustand und keinen Empfaenger: Man tippte, und nichts geschah.
 * Sie filtert die Ereignisse, die schon in den Requisiten stehen, und fragt
 * keinen Server. Was der Snapshot nicht enthaelt, findet sie also nicht; das
 * ist dieselbe Menge, die die Liste zeigt.
 */
const AUDIT_STATUS: Record<AuditEvent["status"], string> = {
  success: "erfolgreich",
  blocked: "blockiert",
  pending: "offen",
};

export function auditStatusLabel(status: string): string {
  return AUDIT_STATUS[status as AuditEvent["status"]] ?? status;
}

export function auditStatusTexts(): string[] {
  return Object.values(AUDIT_STATUS);
}

export function matchesAuditQuery(event: AuditEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [event.actor, event.action, event.resource, event.status, auditStatusLabel(event.status)]
    .some((field) => field.toLowerCase().includes(needle));
}

export function ActivityView({ audit, aiOnly }: { audit: AuditEvent[]; aiOnly: boolean }) {
  const [query, setQuery] = useState("");
  const scoped = audit.filter((event) => !aiOnly || event.actor === "Codex");
  const shown = scoped.filter((event) => matchesAuditQuery(event, query));
  return <article className="console-card activity-log">
    <div className="log-toolbar">
      <label className="toolbar-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Ereignisse durchsuchen…")} aria-label={t("Ereignisse durchsuchen…")}/></label>
      <button className="secondary-button is-placeholder" disabled title={t("Filter sind noch nicht verbunden")}><ListFilter size={14}/> {t("Filter")}</button>
    </div>
    <div className="log-row log-header"><span>{t("Zeit")}</span><span>{t("Akteur")}</span><span>{t("Aktion")}</span><span>{t("Ressource")}</span><span>{t("Status")}</span></div>
    {shown.map((event) => <div className="log-row" key={event.id}>
      <time>{formatHourMinute(event.createdAt)}</time>
      <span><Bot size={13}/>{event.actor}</span>
      <code>{event.action}</code>
      <span>{event.resource}</span>
      <span className={`log-status ${event.status}`}>{t(auditStatusLabel(event.status))}</span>
    </div>)}
    {query && shown.length === 0 && scoped.length > 0 && <p className="muted">{t("Keine Ereignisse passen zu dieser Suche.")}</p>}
  </article>;
}
