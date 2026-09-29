"use client";

import { Bot, ListFilter, Search } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatHourMinute } from "@/components/console/console-format";
import type { AuditEvent } from "@/lib/types";

/**
 * Aktivitaet und Logs, aus `console-app.tsx` ausgezogen. Die Ereignisse
 * stehen in den Requisiten; diese Ansicht holt nichts.
 */

export function ActivityView({ audit, aiOnly }: { audit: AuditEvent[]; aiOnly: boolean }) { return <article className="console-card activity-log"><div className="log-toolbar"><div className="toolbar-search"><Search size={14}/><input placeholder={t("Ereignisse durchsuchen…")}/></div><button className="secondary-button is-placeholder" disabled title={t("Filter sind noch nicht verbunden")}><ListFilter size={14}/> {t("Filter")}</button></div><div className="log-row log-header"><span>{t("Zeit")}</span><span>{t("Akteur")}</span><span>{t("Aktion")}</span><span>{t("Ressource")}</span><span>{t("Status")}</span></div>{audit.filter(e=>!aiOnly||e.actor==="Codex").map(event=><div className="log-row" key={event.id}><time>{formatHourMinute(event.createdAt)}</time><span><Bot size={13}/>{event.actor}</span><code>{event.action}</code><span>{event.resource}</span><span className={`log-status ${event.status}`}>{event.status}</span></div>)}</article>; }
