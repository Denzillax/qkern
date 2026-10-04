"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, Plus, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { DangerousAction } from "@/components/console/dangerous-action";
import { FormPanel } from "@/components/console/form-panel";
import { cronBody, cronFields } from "@/components/console/compute-form-fields";
import { InlineEmptyState } from "@/components/console/console-parts";
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
type CronJob = { id: string; name: string; expression: string; queue: string; enabled: boolean; timeZone?: string; lastDispatchedAt: string | null };

export function CronView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${base}/cron`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setJobs([]); setState("unavailable"); setMessage(serverErrorText(payload.error) ?? t("Compute ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Cron-Definitionen nicht verfügbar"));
      setJobs(payload.data as CronJob[]); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Cron-Definitionen nicht verfügbar")); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function mutate(path: string, init: RequestInit) {
    const response = await fetch(`${base}${path}`, init);
    if (response.ok) { await load(); return; }
    const payload = await response.json().catch(() => ({}));
    setMessage(serverErrorText(payload.error) ?? t("Die Änderung wurde abgelehnt."));
  }
  // Ein Formular statt vier `window.prompt` nacheinander (2.166).
  async function create(values: Record<string, string>): Promise<string | null> {
    const response = await fetch(`${base}/cron`, { method: "POST", headers: { "Content-Type": "application/json" }, body: cronBody(values) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return serverErrorText(payload.error) ?? t("Die Änderung wurde abgelehnt.");
    }
    setCreating(false);
    await load();
    return null;
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
      <div className="card-head"><div><span>CRON · {environment.toUpperCase()}</span><h3>{t("Geplante Einreihung")}</h3></div><div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button><button className="button small" onClick={() => setCreating(true)}><Plus size={14}/> {t("Neuer Cron-Job")}</button></div></div>
      {creating && <FormPanel title={t("Neuer Cron-Job")} submitLabel={t("Anlegen")} fields={cronFields()} onCancel={() => setCreating(false)} onSubmit={create}/>}
      {message && <p className="muted">{message}</p>}
      {jobs.length === 0 && <InlineEmptyState text={t("Noch kein Cron-Job in dieser Umgebung. Ein Job reiht zu festen Terminen eine Nachricht ein, damit etwas ohne Zutun läuft. Jeder Termin landet mit festem Dedupe-Schlüssel in einer bestehenden Projekt-Queue, damit zwei Scheduler genau eine Nachricht erzeugen.")} action={<button className="button small" onClick={() => setCreating(true)}><Plus size={14}/> {t("Ersten Cron-Job anlegen")}</button>}/>}
      {jobs.map((job) => <div className="bucket-row" key={job.id}><span className="bucket-icon"><Clock3 size={16}/></span>
        <div><strong>{job.name}</strong><small>{job.expression} {job.timeZone ?? "UTC"} → {job.queue} · {job.lastDispatchedAt ? `${t("zuletzt")} ${formatMoment(job.lastDispatchedAt)}` : t("noch nie eingereiht")}</small></div>
        <span className={job.enabled ? "secure" : "muted"}>{job.enabled ? t("aktiv") : t("pausiert")}</span>
        <button className="plain-button" onClick={() => void mutate(`/cron/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !job.enabled }) })}><StableLabel current={job.enabled ? t("Pausieren") : t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
        <DangerousAction label={t("Löschen")} title={`${t("Cron-Job löschen")}: ${job.name}`} consequence={t("Der Job verschwindet samt Ausdruck und Queue. Ab dann wird zu diesen Terminen nichts mehr eingereiht, und das fällt erst auf, wenn der Termin verstreicht.")} confirmName={job.name} onConfirm={() => void mutate(`/cron/${job.id}`, { method: "DELETE" })}/>
      </div>)}
      <p className="muted">{t("Ausdruck, Zeitzone und Queue lassen sich nicht ändern; eine Änderung ist Löschen und neu Anlegen.")}</p>
    </article>
  </div>;
}
