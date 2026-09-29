"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Storage-Policies in der Console (2.27): Lese- und Schreibregel je Bucket,
 * wie bei Supabase unter Storage → Policies, gelesen und geändert über
 * `/storage/buckets` und `PATCH /storage/buckets/{id}`. Die fünf Regeln sind
 * die des Dienstes; feinere Regeln je Pfad gibt es nicht.
 */
type Environment = "development" | "staging" | "production";
type ReadPolicy = "private" | "authenticated" | "owner" | "public" | "service";
type WritePolicy = "private" | "authenticated" | "owner" | "service";
type Bucket = { id: string; name: string; readPolicy: ReadPolicy; writePolicy: WritePolicy; allowedMimeTypes: string[]; maxObjectBytes: number; quotaBytes: number; retentionDays: number | null };

export function StoragePoliciesView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const endpoint = `/api/v1/projects/${projectId}/environments/${environment}/storage/buckets`;
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { readPolicy: ReadPolicy; writePolicy: WritePolicy }>>({});
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setBuckets([]); setState("unavailable"); setMessage(payload.error ?? t("Project Storage ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Storage nicht verfügbar"));
      const list = payload.data as Bucket[];
      setBuckets(list); setDrafts(Object.fromEntries(list.map((bucket) => [bucket.id, { readPolicy: bucket.readPolicy, writePolicy: bucket.writePolicy }]))); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Storage nicht verfügbar")); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function save(bucket: Bucket) {
    const draft = drafts[bucket.id]; if (!draft) return;
    setSaving(bucket.id); setMessage("");
    const response = await fetch(`${endpoint}/${bucket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      readPolicy: draft.readPolicy, writePolicy: draft.writePolicy, allowedMimeTypes: bucket.allowedMimeTypes,
      maxObjectBytes: bucket.maxObjectBytes, quotaBytes: bucket.quotaBytes, retentionDays: bucket.retentionDays,
    }) });
    setSaving(null);
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setMessage(payload.error ?? t("Die Änderung wurde abgelehnt.")); return; }
    await load();
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Policies werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><ShieldCheck size={26}/><h3>{state === "unavailable" ? t("Storage nicht aktiv") : t("Storage nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const readLabel: Record<ReadPolicy, string> = { private: t("niemand über die App"), authenticated: t("jeder angemeldete Nutzer"), owner: t("nur der Eigentümer des Objekts"), public: t("jeder, auch ohne Anmeldung"), service: t("nur der Server mit Service Key") };
  const writeLabel: Record<WritePolicy, string> = { private: t("niemand über die App"), authenticated: t("jeder angemeldete Nutzer"), owner: t("nur der Eigentümer des Objekts"), service: t("nur der Server mit Service Key") };
  const changed = (bucket: Bucket) => drafts[bucket.id] && (drafts[bucket.id].readPolicy !== bucket.readPolicy || drafts[bucket.id].writePolicy !== bucket.writePolicy);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("BUCKETS")}</span><strong>{buckets.length}</strong><small>{t("in dieser Umgebung")}</small></div>
      <div><span>{t("ÖFFENTLICH LESBAR")}</span><strong>{buckets.filter((bucket) => bucket.readPolicy === "public").length}</strong><small>{t("ohne Anmeldung")}</small></div>
      <div><span>{t("GESCHLOSSEN")}</span><strong>{buckets.filter((bucket) => bucket.readPolicy === "private" && bucket.writePolicy === "private").length}</strong><small>{t("nur über die Console")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>STORAGE · {environment.toUpperCase()}</span><h3>{t("Lese- und Schreibregeln je Bucket")}</h3></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>
      {message && <p className="muted">{message}</p>}
      {buckets.length === 0 && <p className="muted">{t("Noch keine Buckets. Lege einen unter Storage → Buckets an; jeder neue Bucket ist geschlossen, bis du hier eine Regel setzt.")}</p>}
      {buckets.map((bucket) => <div className="bucket-row" key={bucket.id}><span className="bucket-icon"><ShieldCheck size={16}/></span>
        <div><strong>{bucket.name}</strong>
          <small>
            <label>{t("Lesen")} <select value={drafts[bucket.id]?.readPolicy ?? bucket.readPolicy} onChange={(event) => setDrafts({ ...drafts, [bucket.id]: { ...drafts[bucket.id], readPolicy: event.target.value as ReadPolicy } })}>{(Object.keys(readLabel) as ReadPolicy[]).map((policy) => <option key={policy} value={policy}>{policy} · {readLabel[policy]}</option>)}</select></label>
            {" "}
            <label>{t("Schreiben")} <select value={drafts[bucket.id]?.writePolicy ?? bucket.writePolicy} onChange={(event) => setDrafts({ ...drafts, [bucket.id]: { ...drafts[bucket.id], writePolicy: event.target.value as WritePolicy } })}>{(Object.keys(writeLabel) as WritePolicy[]).map((policy) => <option key={policy} value={policy}>{policy} · {writeLabel[policy]}</option>)}</select></label>
          </small>
        </div>
        <span className={bucket.readPolicy === "public" ? "risk medium" : "secure"}>{bucket.readPolicy} / {bucket.writePolicy}</span>
        <button className="plain-button" disabled={!changed(bucket) || saving === bucket.id} onClick={() => void save(bucket)}><StableLabel current={saving === bucket.id ? t("Speichert…") : t("Speichern")} variants={tAll("Speichert…", "Speichern")}/></button>
      </div>)}
      <p className="muted">{t("Eine Regel gilt für den ganzen Bucket. Regeln je Pfad gibt es nicht; die Console selbst liest und schreibt immer mit Admin-Rechten.")}</p>
    </article>
  </div>;
}
