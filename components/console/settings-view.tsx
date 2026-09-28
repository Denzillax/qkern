"use client";

import { ShieldCheck } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Projekteinstellungen, aus `console-app.tsx` ausgezogen. Name und IDs
 * stehen in den Requisiten; diese Ansicht holt nichts.
 */
export function SettingsView({ project, organizationId }: { project: { name: string; id: string }; organizationId: string }){return <div className="settings-layout"><aside className="console-card settings-nav"><button className="active" type="button">{t("Allgemein")}</button>{[t("Umgebungen"),t("API-Keys"),t("KI-Verbindungen"),t("Team"),t("Gefahrenzone")].map(tab=><button key={tab} type="button" disabled className="is-placeholder" title={`${tab} ist noch nicht verbunden`}>{tab}</button>)}</aside><article className="console-card settings-form"><span className="console-kicker">{t("Projekteinstellungen")}</span><h2>{t("Allgemein")}</h2><label>{t("Projektname")}<input value={project.name} readOnly/></label><label>{t("Projekt-ID")}<input value={project.id} readOnly/></label><label>{t("Organisations-ID")}<input value={organizationId} readOnly/></label><div className="form-note"><ShieldCheck size={16}/><p><strong>{t("Nur lesend")}</strong><br/>{t("Umbenennen, Regionen und Gefahrenzone sind noch nicht verbunden; diese Ansicht zeigt den echten Namen, die echte ID des Projekts und die ID der Organisation.")}</p></div><button className="button is-placeholder" disabled title={t("Speichern ist noch nicht verbunden")}>{t("Änderungen speichern")}</button></article></div>}
