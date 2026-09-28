"use client";

import { Database, Table2 } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import type { ViewId } from "@/components/console/navigation";
import type { Project } from "@/lib/types";

/**
 * Datenbank (die Gruppenseite), aus `console-app.tsx` ausgezogen.
 *
 * Reiner Text und ein Verweis auf den Table Editor: Die Provisionierung ist
 * nicht verbunden, also gibt es nichts zu holen und keinen Ladezustand.
 */
export function DatabaseView({ project, navigate }: { project: Project; navigate: (view: ViewId) => void }) {
  return <div className="module-grid"><article className="console-card span-2 placeholder-state"><Database size={26}/><div><span className="console-kicker">{t("Datenbank")} · {project.name}</span><h2>{t("Provisionierung noch nicht verbunden")}</h2><p>{t("Verbindungsdaten, Pool-Auslastung und Latenzen kommen mit der Provisionierung. Tabellen und Zeilen deiner Datenbank siehst du jetzt schon im Table Editor, live und mit RLS.")}</p></div><button className="button small" onClick={() => navigate("table")}><Table2 size={14}/> {t("Zum Table Editor")}</button></article></div>;
}
