"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { t } from "@/components/console/console-i18n";

/**
 * Publikationen in der Console (2.20): welche Tabellen Änderungen nach
 * aussen melden, gelesen über `/schema/publications`. Nur lesend; der
 * Realtime-Change-Feed liest seine Publikation aus derselben Quelle.
 */
type Environment = "development" | "staging" | "production";
type Publication = { name: string; owner: string; publishInsert: boolean; publishUpdate: boolean; publishDelete: boolean; publishTruncate: boolean; allTables: boolean; tables: string[] };

export function PublicationsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/publications`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Publikationen nicht verfügbar"));
      setPublications(payload.data.publications as Publication[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Publikationen nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Publikationen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Radio size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Publikationen nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const operations = (publication: Publication) => [publication.publishInsert && "INSERT", publication.publishUpdate && "UPDATE", publication.publishDelete && "DELETE", publication.publishTruncate && "TRUNCATE"].filter(Boolean).join(", ");

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("PUBLIKATIONEN")}</span><strong>{publications.length}</strong><small>{t("in dieser Datenbank")}</small></div>
      <div><span>{t("ALLE TABELLEN")}</span><strong>{publications.filter((publication) => publication.allTables).length}</strong><small>{t("melden jede Tabelle")}</small></div>
      <div><span>{t("TABELLEN")}</span><strong>{new Set(publications.flatMap((publication) => publication.tables)).size}</strong><small>{t("einzeln gemeldet")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Publikationen")}</h3></div><div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {publications.length === 0 && <p className="muted">{t("Keine Publikationen. Eine Publikation entsteht wie jede Schemaänderung über ein Change Set: CREATE PUBLICATION im SQL Editor, Vorschau, Freigabe.")}</p>}
      {truncated && <p className="muted">{t("Die Liste ist bei 100 Publikationen abgeschnitten.")}</p>}
      {publications.map((publication) => <div className="bucket-row" key={publication.name}><span className="bucket-icon"><Radio size={16}/></span>
        <div><strong>{publication.name}</strong><small>{operations(publication) || t("nichts")} · {publication.allTables ? t("alle Tabellen") : publication.tables.length > 0 ? publication.tables.join(", ") : t("keine Tabelle")} · {t("Eigentümer")} {publication.owner}</small></div>
        <span className={publication.allTables ? "risk medium" : "secure"}>{publication.allTables ? t("alle Tabellen") : `${publication.tables.length} ${t("Tabellen")}`}</span>
      </div>)}
    </article>
  </div>;
}
