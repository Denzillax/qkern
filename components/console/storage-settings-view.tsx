"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Storage-Einstellungen in der Console (2.27): Grössengrenze je Objekt,
 * Speicherplatz je Bucket, erlaubte MIME-Typen und Aufbewahrung, wie bei
 * Supabase unter Storage → Settings, geändert über `PATCH /storage/buckets/{id}`.
 * Der Dienst prüft die Werte selbst; hier steht nur das Formular.
 */
type Environment = "development" | "staging" | "production";
type Bucket = { id: string; name: string; readPolicy: string; writePolicy: string; allowedMimeTypes: string[]; maxObjectBytes: number; quotaBytes: number; usedBytes: number; retentionDays: number | null };
type Draft = { maxMiB: string; quotaMiB: string; mimeTypes: string; retentionDays: string };

const MIB = 1024 * 1024;
const draftOf = (bucket: Bucket): Draft => ({ maxMiB: String(Math.max(1, Math.round(bucket.maxObjectBytes / MIB))), quotaMiB: String(Math.max(1, Math.round(bucket.quotaBytes / MIB))), mimeTypes: bucket.allowedMimeTypes.join(", "), retentionDays: bucket.retentionDays === null ? "" : String(bucket.retentionDays) });

export function StorageSettingsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const endpoint = `/api/v1/projects/${projectId}/environments/${environment}/storage/buckets`;
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
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
      setBuckets(list); setDrafts(Object.fromEntries(list.map((bucket) => [bucket.id, draftOf(bucket)]))); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Storage nicht verfügbar")); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function save(bucket: Bucket) {
    const draft = drafts[bucket.id]; if (!draft) return;
    const maxMiB = Number(draft.maxMiB), quotaMiB = Number(draft.quotaMiB);
    const retention = draft.retentionDays.trim() === "" ? null : Number(draft.retentionDays);
    const mimeTypes = draft.mimeTypes.split(",").map((value) => value.trim()).filter(Boolean);
    if (!Number.isInteger(maxMiB) || maxMiB < 1 || !Number.isInteger(quotaMiB) || quotaMiB < maxMiB || (retention !== null && (!Number.isInteger(retention) || retention < 1)) || mimeTypes.length === 0) {
      setMessage(t("Bitte ganze Zahlen: Objektgrösse ab 1 MiB, Speicherplatz mindestens so gross wie die Objektgrösse, Aufbewahrung ab 1 Tag oder leer, mindestens ein MIME-Typ.")); return;
    }
    setSaving(bucket.id); setMessage("");
    const response = await fetch(`${endpoint}/${bucket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      readPolicy: bucket.readPolicy, writePolicy: bucket.writePolicy, allowedMimeTypes: mimeTypes,
      maxObjectBytes: maxMiB * MIB, quotaBytes: quotaMiB * MIB, retentionDays: retention,
    }) });
    setSaving(null);
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setMessage(payload.error ?? t("Die Änderung wurde abgelehnt.")); return; }
    await load();
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Einstellungen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><SlidersHorizontal size={26}/><h3>{state === "unavailable" ? t("Storage nicht aktiv") : t("Storage nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const field = (bucket: Bucket, key: keyof Draft, value: string) => setDrafts({ ...drafts, [bucket.id]: { ...(drafts[bucket.id] ?? draftOf(bucket)), [key]: value } });
  const changed = (bucket: Bucket) => JSON.stringify(drafts[bucket.id]) !== JSON.stringify(draftOf(bucket));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("BUCKETS")}</span><strong>{buckets.length}</strong><small>{t("in dieser Umgebung")}</small></div>
      <div><span>{t("MIT AUFBEWAHRUNG")}</span><strong>{buckets.filter((bucket) => bucket.retentionDays !== null).length}</strong><small>{t("löschen nach Frist")}</small></div>
      <div><span>{t("SPEICHERPLATZ")}</span><strong>{Math.round(buckets.reduce((sum, bucket) => sum + bucket.quotaBytes, 0) / MIB)} MiB</strong><small>{t("über alle Buckets")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>STORAGE · {environment.toUpperCase()}</span><h3>{t("Grenzen je Bucket")}</h3></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>
      {message && <p className="muted">{message}</p>}
      {buckets.length === 0 && <p className="muted">{t("Noch keine Buckets. Lege einen unter Storage → Buckets an.")}</p>}
      {buckets.map((bucket) => { const draft = drafts[bucket.id] ?? draftOf(bucket); return <div className="bucket-row" key={bucket.id}><span className="bucket-icon"><SlidersHorizontal size={16}/></span>
        <div><strong>{bucket.name}</strong>
          <small>
            <label>{t("Objekt max.")} <input inputMode="numeric" size={6} value={draft.maxMiB} onChange={(event) => field(bucket, "maxMiB", event.target.value)}/> MiB</label>{" "}
            <label>{t("Speicherplatz")} <input inputMode="numeric" size={7} value={draft.quotaMiB} onChange={(event) => field(bucket, "quotaMiB", event.target.value)}/> MiB</label>{" "}
            <label>{t("Aufbewahrung")} <input inputMode="numeric" size={4} value={draft.retentionDays} placeholder={t("unbegrenzt")} onChange={(event) => field(bucket, "retentionDays", event.target.value)}/> {t("Tage")}</label>
            <br/><label>{t("MIME-Typen")} <input size={40} value={draft.mimeTypes} onChange={(event) => field(bucket, "mimeTypes", event.target.value)}/></label>
          </small>
        </div>
        <span className="muted">{Math.round(bucket.usedBytes / MIB)} / {Math.round(bucket.quotaBytes / MIB)} MiB</span>
        <button className="plain-button" disabled={!changed(bucket) || saving === bucket.id} onClick={() => void save(bucket)}><StableLabel current={saving === bucket.id ? t("Speichert…") : t("Speichern")} variants={tAll("Speichert…", "Speichern")}/></button>
      </div>; })}
      <p className="muted">{t("Der Dienst prüft jede Grenze selbst: Speicherplatz nie kleiner als die Objektgrösse, Aufbewahrung höchstens 3650 Tage, höchstens 20 MIME-Typen.")}</p>
    </article>
  </div>;
}
