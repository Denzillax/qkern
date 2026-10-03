"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { OptionMenu } from "@/components/console/option-menu";
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

/**
 * Die vier Felder, die diese Seite nicht bearbeitet, aber mitschicken muss.
 * Rein und exportiert, damit der Vertrag sie pruefen kann, ohne zu rendern.
 */
export function sameUntouchedFields(before: Bucket, after: Bucket): boolean {
  return before.maxObjectBytes === after.maxObjectBytes
    && before.quotaBytes === after.quotaBytes
    && before.retentionDays === after.retentionDays
    && before.allowedMimeTypes.length === after.allowedMimeTypes.length
    && before.allowedMimeTypes.every((entry, index) => entry === after.allowedMimeTypes[index]);
}

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
      if (response.status === 503) { setBuckets([]); setState("unavailable"); setMessage(serverErrorText(payload.error) ?? t("Project Storage ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Storage nicht verfügbar"));
      const list = payload.data as Bucket[];
      setBuckets(list); setDrafts(Object.fromEntries(list.map((bucket) => [bucket.id, { readPolicy: bucket.readPolicy, writePolicy: bucket.writePolicy }]))); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Storage nicht verfügbar")); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  /**
   * Vor dem Schreiben noch einmal lesen (2.148).
   *
   * **Warum.** `PATCH` auf einen Bucket ist ein Vollersatz: Das Schema der
   * Route verlangt jedes Feld, auch die vier, die diese Seite gar nicht
   * bearbeitet. Geschickt wurden sie bisher so, wie sie beim Laden der Seite
   * aussahen. Wer also die Grössengrenze in den Storage-Einstellungen aendert,
   * waehrend hier eine Seite offen steht, verliert seine Aenderung in dem
   * Moment, in dem hier jemand auf Speichern drueckt. Niemand merkt es, denn
   * beide Schritte sind erfolgreich.
   *
   * **Was jetzt passiert.** Der Bucket wird unmittelbar vor dem Schreiben
   * erneut gelesen. Sind die vier unberuehrten Felder noch dieselben, geht das
   * Schreiben mit den frischen Werten durch. Sind sie es nicht, wird nichts
   * geschrieben; die Seite laedt neu und sagt, dass jemand anderes den Bucket
   * geaendert hat. Aus einem stillen Verlust wird damit ein sichtbarer
   * Konflikt.
   *
   * **Was das nicht ist.** Keine echte Nebenlaeufigkeitskontrolle. Zwischen dem
   * zweiten Lesen und dem Schreiben bleibt ein Fenster von Millisekunden. Dafuer
   * braeuchte die Route eine Version oder `If-Match`, und das ist eine
   * Aenderung an der Schnittstelle und nicht an dieser Seite.
   */
  async function save(bucket: Bucket) {
    const draft = drafts[bucket.id]; if (!draft) return;
    setSaving(bucket.id); setMessage("");

    const fresh = await fetch(endpoint, { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json()).data as Bucket[] : null)
      .catch(() => null);
    const current = fresh?.find((entry) => entry.id === bucket.id);
    if (fresh && !current) {
      setSaving(null); setMessage(t("Diesen Bucket gibt es nicht mehr.")); await load(); return;
    }
    if (current && !sameUntouchedFields(bucket, current)) {
      setSaving(null);
      setMessage(t("Jemand anderes hat diesen Bucket inzwischen geändert. Es wurde nichts geschrieben; die Liste ist neu geladen, und deine Wahl kannst du noch einmal setzen."));
      await load();
      return;
    }

    const base = current ?? bucket;
    const response = await fetch(`${endpoint}/${bucket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      readPolicy: draft.readPolicy, writePolicy: draft.writePolicy, allowedMimeTypes: base.allowedMimeTypes,
      maxObjectBytes: base.maxObjectBytes, quotaBytes: base.quotaBytes, retentionDays: base.retentionDays,
    }) });
    setSaving(null);
    if (!response.ok) { const payload = await response.json().catch(() => ({})); setMessage(serverErrorText(payload.error) ?? t("Die Änderung wurde abgelehnt.")); return; }
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
        {/* 2.133: Zwei Auswahlmenues statt zweier `select` des Betriebssystems.
            Der Name der Regel ist ein Bezeichner und bleibt, wie der Dienst ihn
            schreibt; was die Regel erlaubt, stand bisher hinter einem Mittelpunkt
            im selben Eintrag und steht jetzt als Erklaerzeile darunter. Das `small`
            ist einem `div` gewichen: Ein Menue ist ein `div` mit einem Knopf darin,
            und das darf in einem `small` nicht stehen. */}
        <div><strong>{bucket.name}</strong>
          <div className="policy-fields">
            <label>{t("Lesen")}
              {/* Der Knopf traegt die Bedeutung, die Zusatzzeile den Wert, den die
                  API kennt (2.163). Vorher stand "public" auf dem Knopf, und was
                  das heisst, sah man erst in der aufgeklappten Liste. */}
              <OptionMenu value={drafts[bucket.id]?.readPolicy ?? bucket.readPolicy} align="left"
                ariaLabel={`${t("Leseregel")} ${bucket.name}`} listLabel={t("Leseregel wählen")}
                onChange={(next) => setDrafts({ ...drafts, [bucket.id]: { ...drafts[bucket.id], readPolicy: next } })}
                options={(Object.keys(readLabel) as ReadPolicy[]).map((policy) => ({ id: policy, label: readLabel[policy], hint: policy }))}/>
            </label>
            <label>{t("Schreiben")}
              <OptionMenu value={drafts[bucket.id]?.writePolicy ?? bucket.writePolicy} align="left"
                ariaLabel={`${t("Schreibregel")} ${bucket.name}`} listLabel={t("Schreibregel wählen")}
                onChange={(next) => setDrafts({ ...drafts, [bucket.id]: { ...drafts[bucket.id], writePolicy: next } })}
                options={(Object.keys(writeLabel) as WritePolicy[]).map((policy) => ({ id: policy, label: writeLabel[policy], hint: policy }))}/>
            </label>
          </div>
        </div>
        <span className={bucket.readPolicy === "public" ? "risk medium" : "secure"}>{bucket.readPolicy} / {bucket.writePolicy}</span>
        <button className="plain-button" disabled={!changed(bucket) || saving === bucket.id} onClick={() => void save(bucket)}><StableLabel current={saving === bucket.id ? t("Speichert…") : t("Speichern")} variants={tAll("Speichert…", "Speichern")}/></button>
      </div>)}
      <p className="muted">{t("Eine Regel gilt für den ganzen Bucket. Regeln je Pfad gibt es nicht; die Console selbst liest und schreibt immer mit Admin-Rechten.")}</p>
    </article>
  </div>;
}
