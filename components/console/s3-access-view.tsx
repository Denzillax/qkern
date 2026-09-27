"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Plus, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  S3_ACCESS_LIMIT,
  S3_ACCESS_NO_BUCKETS,
  S3_ACCESS_ONE_TIME,
  S3_ACCESS_REVOKE_MEANING,
  S3_ACCESS_WHAT,
  S3_ACCESS_WHY_NO_PROVIDER_KEYS,
  S3_ACCESS_WHY_NO_SIGNATURE_CHECK,
  S3AccessError,
  validateS3AccessDraft,
} from "@/lib/console/s3-access-texts";

/**
 * Storage, S3-Zugang in der Console (2.78).
 *
 * Die Ansicht gibt Schlüsselpaare aus, zeigt das Geheimnis genau einmal und
 * widerruft. Was sie nicht kann, steht als erster Absatz auf der Seite und
 * nicht als Fussnote: Heute nimmt kein Endpunkt ein solches Paar an. Ein Paar,
 * das aussieht wie ein Zugang und keiner ist, wäre schlimmer als gar keines.
 */
type Environment = "development" | "staging" | "production";
type State = "loading" | "ready" | "unavailable" | "error";
type Bucket = { id: string; name: string };
type AccessKey = {
  id: string;
  name: string;
  accessKeyId: string;
  bucketIds: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};
type Issued = { accessKeyId: string; secret: string };

const EXPIRY_DAYS = [30, 90, 180, 365] as const;

export function S3AccessView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/storage`;
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState<number>(90);
  // Genau einmal gezeigt: Der Wert lebt in diesem Zustand und wird nie neu
  // geladen. Wer die Seite verlässt, sieht ihn nicht wieder.
  const [issued, setIssued] = useState<Issued | null>(null);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const [keyResponse, bucketResponse] = await Promise.all([
        fetch(`${base}/s3-keys`, { cache: "no-store" }),
        fetch(`${base}/buckets`, { cache: "no-store" }),
      ]);
      const keyPayload = await keyResponse.json().catch(() => ({}));
      const bucketPayload = await bucketResponse.json().catch(() => ({}));
      if (keyResponse.status === 503) {
        setKeys([]); setBuckets([]); setState("unavailable");
        setMessage(keyPayload.error ?? t("Storage ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!keyResponse.ok) throw new Error(keyPayload.error ?? t("S3-Zugang nicht verfügbar"));
      setKeys((keyPayload.data ?? []) as AccessKey[]);
      setBuckets(bucketResponse.ok ? ((bucketPayload.data ?? []) as Bucket[]) : []);
      setState("ready");
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : t("S3-Zugang nicht verfügbar"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const preview = useMemo(() => {
    try {
      return {
        draft: validateS3AccessDraft({
          name,
          bucketIds: selected,
          expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString(),
          now: new Date(),
        }),
        reason: "",
      };
    } catch (error) {
      return {
        draft: null,
        reason: error instanceof S3AccessError
          ? t(error.reason)
          : t("Aus dieser Eingabe lässt sich kein Schlüsselpaar bauen."),
      };
    }
  }, [name, selected, days]);

  async function submit() {
    const draft = preview.draft;
    if (!draft) return;
    setSubmitting(true); setSubmitMessage("");
    try {
      const response = await fetch(`${base}/s3-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, bucketIds: draft.bucketIds, expiresAt: draft.expiresAt }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSubmitMessage(payload.error ?? t("Das Schlüsselpaar wurde abgelehnt."));
        return;
      }
      setIssued({ accessKeyId: String(payload.data?.accessKeyId ?? ""), secret: String(payload.secret ?? "") });
      setName(""); setSelected([]);
      await load();
    } finally { setSubmitting(false); }
  }

  async function revoke(keyId: string) {
    if (!window.confirm(t("Dieses Schlüsselpaar widerrufen? Der Widerruf wirkt sofort."))) return;
    const response = await fetch(`${base}/s3-keys/${keyId}`, { method: "DELETE" });
    if (response.ok) await load();
    else setMessage(t("Das Schlüsselpaar konnte nicht widerrufen werden."));
  }

  function toggleBucket(bucketId: string) {
    setSelected((current) => current.includes(bucketId)
      ? current.filter((entry) => entry !== bucketId)
      : [...current, bucketId]);
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("S3-Zugang wird geladen…")}</h3></div>;
  }
  if (state === "error" || state === "unavailable") {
    return <div className="console-card live-module-state">
      <KeyRound size={26}/>
      <h3>{state === "unavailable" ? t("Storage ist für diese Umgebung deaktiviert.") : t("S3-Zugang nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const live = keys.filter((key) => !key.revokedAt);
  const bucketName = (bucketId: string) => buckets.find((bucket) => bucket.id === bucketId)?.name ?? t("entfernter Bucket");

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("S3-ZUGANG")}</span><h3>{t("Schlüsselpaare für")} {environment}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={t("Neu laden")} variants={tAll("Neu laden")}/></button></div>
      <p className="risk high"><ShieldAlert size={14}/> {t(S3_ACCESS_LIMIT)}</p>
      <p>{t(S3_ACCESS_WHAT)}</p>
      <p className="muted">{t(S3_ACCESS_WHY_NO_PROVIDER_KEYS)}</p>
      <p className="muted">{t(S3_ACCESS_WHY_NO_SIGNATURE_CHECK)}</p>
    </article>

    <article className="console-card auth-overview">
      <div><span>{t("GÜLTIGE PAARE")}</span><strong>{live.length}</strong><small>{t("erklärt, noch nicht angenommen")}</small></div>
      <div><span>{t("WIDERRUFEN")}</span><strong>{keys.length - live.length}</strong><small>{t("gelten nicht mehr")}</small></div>
      <div><span>{t("BUCKETS")}</span><strong>{buckets.length}</strong><small>{t("in dieser Umgebung")}</small></div>
    </article>

    <article className="console-card span-2 api-key-manager">
      <div className="card-head"><div><span>{t("NEUES PAAR")}</span><h3>{t("Anlegen und einmal zeigen")}</h3></div></div>
      {buckets.length === 0
        ? <p className="muted">{t(S3_ACCESS_NO_BUCKETS)}</p>
        : <div className="settings-form">
            <label>{t("Name")}
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
                placeholder={t("Wofür ist dieses Paar gedacht?")}/>
            </label>
            <fieldset>
              <legend>{t("Buckets")}</legend>
              {buckets.map((bucket) => <label key={bucket.id} className="bucket-row">
                <input type="checkbox" checked={selected.includes(bucket.id)} onChange={() => toggleBucket(bucket.id)}/>
                <span>{bucket.name}</span>
              </label>)}
            </fieldset>
            <label>{t("Ablauf")}
              <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                {EXPIRY_DAYS.map((entry) => <option key={entry} value={entry}>{entry} {t("Tage")}</option>)}
              </select>
            </label>
            {preview.reason && <p className="muted">{preview.reason}</p>}
            {submitMessage && <p className="muted">{submitMessage}</p>}
            <button className="button" onClick={() => void submit()} disabled={!preview.draft || submitting}>
              <Plus size={13}/> <StableLabel current={submitting ? t("Wird angelegt…") : t("Schlüsselpaar anlegen")}
                variants={tAll("Wird angelegt…", "Schlüsselpaar anlegen")}/>
            </button>
          </div>}
      {issued && <div className="one-time-secret">
        <div>
          <strong>{t(S3_ACCESS_ONE_TIME)}</strong>
          <code>{issued.accessKeyId}</code>
          <code>{issued.secret}</code>
        </div>
        <button onClick={() => void navigator.clipboard.writeText(issued.secret)}><Copy size={14}/> {t("Kopieren")}</button>
        <button onClick={() => setIssued(null)} aria-label={t("Schliessen")}><X size={14}/></button>
      </div>}
    </article>

    <article className="console-card span-2 api-key-manager">
      <div className="card-head"><div><span>{t("AUSGEGEBENE PAARE")}</span><h3>{t("Widerruf behält die Spur")}</h3></div></div>
      <p className="muted">{t(S3_ACCESS_REVOKE_MEANING)}</p>
      {message && <p className="muted">{message}</p>}
      <div className="api-key-list">
        {keys.map((key) => <div key={key.id}>
          <span className="key-kind secure"><KeyRound size={13}/></span>
          <div><strong>{key.name}</strong><code>{key.accessKeyId}</code>
            <small>{key.bucketIds.map(bucketName).join(", ")}</small></div>
          <span>{key.revokedAt
            ? `${t("widerrufen")} ${formatMoment(key.revokedAt, "date")}`
            : `${t("läuft ab")} ${formatMoment(key.expiresAt, "date")}`}</span>
          {!key.revokedAt && <button onClick={() => void revoke(key.id)} aria-label={t("Schlüsselpaar widerrufen")}>
            <Trash2 size={14}/></button>}
        </div>)}
        {keys.length === 0 && <p className="muted">{t("Noch kein Paar ausgegeben.")}</p>}
      </div>
    </article>
  </div>;
}
