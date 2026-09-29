"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, Plus, RefreshCw, Trash2 } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";

/**
 * Cron in der Console (2.21): die geplanten Einreihungen des Projekts, wie
 * bei Supabase unter Integrations, gelesen und verwaltet über
 * `/compute/cron`. Dieselben Aktionen wie unter Functions & Jobs: anlegen,
 * pausieren, löschen. Ausdruck und Queue lassen sich nicht ändern; eine
 * Änderung ist Löschen und neu Anlegen, so liegt es als Spaltenrecht in der
 * Datenbank.
 */
type Environment = "development" | "staging" | "production";
type CronJob = { id: string; name: string; expression: string; queue: string; enabled: boolean; lastDispatchedAt: string | null };

export function CronView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${base}/cron`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setJobs([]); setState("unavailable"); setMessage(payload.error ?? t("Compute ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Cron-Definitionen nicht verfügbar"));
      setJobs(payload.data as CronJob[]); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Cron-Definitionen nicht verfügbar")); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function mutate(path: string, init: RequestInit) {
    const response = await fetch(`${base}${path}`, init);
    if (response.ok) { await load(); return; }
    const payload = await response.json().catch(() => ({}));
    setMessage(payload.error ?? t("Die Änderung wurde abgelehnt."));
  }
  async function create() {
    const name = window.prompt(t("Name des Cron-Jobs (Kleinbuchstaben, Ziffern, Bindestrich)"), "nightly-report"); if (!name) return;
    const expression = window.prompt(t("Ausdruck in UTC: */N * * * * oder M H * * *"), "*/15 * * * *"); if (!expression) return;
    const queue = window.prompt(t("Bestehende Projekt-Queue"), "email_jobs"); if (!queue) return;
    await mutate("/cron", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), expression: expression.trim(), queue: queue.trim() }) });
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Cron-Jobs werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Clock3 size={26}/><h3>{state === "unavailable" ? t("Compute nicht aktiv") : t("Cron-Definitionen nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("CRON-JOBS")}</span><strong>{jobs.length}</strong><small>{t("in dieser Umgebung")}</small></div>
      <div><span>{t("AKTIV")}</span><strong>{jobs.filter((job) => job.enabled).length}</strong><small>{t("reihen nach Plan ein")}</small></div>
      <div><span>{t("PAUSIERT")}</span><strong>{jobs.filter((job) => !job.enabled).length}</strong><small>{t("warten")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>CRON · {environment.toUpperCase()}</span><h3>{t("Geplante Einreihung")}</h3></div><div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button><button className="button small" onClick={() => void create()}><Plus size={14}/> {t("Neuer Cron-Job")}</button></div></div>
      {message && <p className="muted">{message}</p>}
      {jobs.length === 0 && <p className="muted">{t("Noch keine Cron-Jobs. Jeder Termin landet mit festem Dedupe-Schlüssel in einer bestehenden Projekt-Queue, damit zwei Scheduler genau eine Nachricht erzeugen.")}</p>}
      {jobs.map((job) => <div className="bucket-row" key={job.id}><span className="bucket-icon"><Clock3 size={16}/></span>
        <div><strong>{job.name}</strong><small>{job.expression} UTC → {job.queue} · {job.lastDispatchedAt ? `${t("zuletzt")} ${formatMoment(job.lastDispatchedAt)}` : t("noch nie eingereiht")}</small></div>
        <span className={job.enabled ? "secure" : "muted"}>{job.enabled ? t("aktiv") : t("pausiert")}</span>
        <button className="plain-button" onClick={() => void mutate(`/cron/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !job.enabled }) })}><StableLabel current={job.enabled ? t("Pausieren") : t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
        <button className="icon-button" onClick={() => { if (window.confirm(`${t("Cron-Job löschen?")} ${job.name}`)) void mutate(`/cron/${job.id}`, { method: "DELETE" }); }} aria-label={`${job.name} ${t("löschen")}`}><Trash2 size={14}/></button>
      </div>)}
      <p className="muted">{t("Ausdruck und Queue lassen sich nicht ändern; eine Änderung ist Löschen und neu Anlegen.")}</p>
    </article>
  </div>;
}
