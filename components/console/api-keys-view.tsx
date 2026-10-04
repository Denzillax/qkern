"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Plus, RefreshCw, X } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment } from "@/components/console/console-display";
import { maskSecret } from "@/components/console/console-format";
import { CopyValue } from "@/components/console/copy-value";
import { DangerousAction } from "@/components/console/dangerous-action";
import { FormPanel } from "@/components/console/form-panel";
import { InlineEmptyState } from "@/components/console/console-parts";
import { StableLabel } from "@/components/stable-label";

/**
 * API-Keys in der Console (2.21): Public und Service Keys des Projekts, wie
 * bei Supabase unter Project Settings, gelesen und verwaltet über
 * `/api-keys`. Dieselben Aktionen wie unter API: anlegen und widerrufen.
 * Das Geheimnis wird nie gespeichert und nur einmal gezeigt.
 *
 * **Was die Route hergibt, und was nicht (2.137).** `GET` liefert je Key nur
 * `prefix`, die ersten 22 Zeichen. Das Geheimnis liegt als SHA-256-Hash im
 * Speicher und ist nicht zurückzuholen, auch nicht für diese Ansicht. `POST`
 * legt an und gibt das Geheimnis genau einmal zurück, `DELETE` widerruft.
 * Eine Rotation gibt es nicht: keine Route dafür, und darum steht hier auch
 * kein Knopf dafür. Was ein Betreiber stattdessen tut, sagt der Satz unter
 * der Liste.
 */
type Environment = "development" | "staging" | "production";
type ApiKey = { id: string; name: string; kind: "public" | "service"; prefix: string; expiresAt: string; revokedAt: string | null; createdAt: string };

export function ApiKeysView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "error" }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/api-keys`;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  // Welcher Key gerade angelegt wird (2.166); vorher ein `window.prompt`.
  const [creating, setCreating] = useState<"public" | "service" | null>(null);
  // Das frische Geheimnis steht maskiert da; Anzeigen ist eine bewusste Handlung.
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(base, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("API-Keys nicht verfügbar"));
      setKeys(payload.data as ApiKey[]); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("API-Keys nicht verfügbar")); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function create(kind: "public" | "service", name: string): Promise<string | null> {
    const expiresAt = new Date(Date.now() + (kind === "public" ? 90 : 30) * 24 * 60 * 60 * 1000).toISOString();
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), kind, expiresAt }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return serverErrorText(payload.error) ?? t("Key konnte nicht erstellt werden");
    setCreating(null); setSecret(payload.data.secret); setRevealed(false); await load();
    return null;
  }
  async function revoke(keyId: string) {
    const response = await fetch(`${base}/${keyId}`, { method: "DELETE" });
    if (response.ok) await load(); else setMessage(t("Key konnte nicht widerrufen werden."));
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("API-Keys werden geladen…")}</h3></div>;
  if (state === "error") return <div className="console-card live-module-state"><KeyRound size={26}/><h3>{t("API-Keys nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const live = keys.filter((key) => !key.revokedAt);
  const format = (value: string) => formatMoment(value, "date");
  const copyLabels = { copy: t("Kopieren"), copied: t("Kopiert"), failed: t("Zwischenablage nicht erreichbar") };

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("PUBLIC KEYS")}</span><strong>{live.filter((key) => key.kind === "public").length}</strong><small>{t("für Browser und Apps")}</small></div>
      <div><span>{t("SERVICE KEYS")}</span><strong>{live.filter((key) => key.kind === "service").length}</strong><small>{t("nur für Server")}</small></div>
      <div><span>{t("WIDERRUFEN")}</span><strong>{keys.length - live.length}</strong><small>{t("gelten nicht mehr")}</small></div>
    </article>
    <article className="console-card span-2 api-key-manager">
      <div className="card-head"><div><span>{t("API-KEYS DES PROJEKTS")}</span><h3>{t("Zugriff für")} {environment}</h3></div><div><button className="secondary-button" onClick={() => setCreating("public")}><Plus size={13}/> {t("Public Key")}</button><button className="button small" onClick={() => setCreating("service")}><Plus size={13}/> {t("Service Key")}</button></div></div>
      {creating && <FormPanel key={creating} title={creating === "public" ? t("Public Key") : t("Service Key")} submitLabel={t("Anlegen")} onCancel={() => setCreating(null)} onSubmit={(values) => create(creating, values.name)} fields={[{ name: "name", label: creating === "public" ? t("Name für den Public Key") : t("Name für den Service Key"), initial: creating === "public" ? t("Public Key für den Browser") : t("Service Key für den Server"), required: true }]}/>}
      {message && <p className="muted">{message}</p>}
      {secret && <div className="one-time-secret">
        <div><strong>{t("Jetzt kopieren, erscheint nur einmal")}</strong><code>{revealed ? secret : maskSecret(secret)}</code></div>
        <button className="secondary-button" onClick={() => setRevealed(!revealed)}>
          {revealed ? <EyeOff size={14}/> : <Eye size={14}/>}
          <StableLabel current={revealed ? t("Verbergen") : t("Anzeigen")} variants={tAll("Verbergen", "Anzeigen")}/>
        </button>
        <CopyValue value={secret} labels={copyLabels}/>
        <button onClick={() => { setSecret(""); setRevealed(false); }} aria-label={t("Schliessen")}><X size={14}/></button>
      </div>}
      {/* Zwei Arten, zwei Sätze. Wer den Unterschied nicht kennt, legt den falschen an. */}
      <div className="detail-list">
        <div><span>{t("Public Key")}</span><small>{t("Darf in den Browser, in eine App und in ein öffentliches Repository. Er kommt nur so weit, wie RLS und die Projektrolle ihn lassen.")}</small></div>
        <div><span>{t("Service Key")}</span><small>{t("Gehört auf einen Server und in keine Auslieferung an einen Browser. Er geht an RLS vorbei und darf alles, was das Projekt kann.")}</small></div>
      </div>
      <div className="api-key-list">
        {keys.map((key) => <div key={key.id}>
          <span className={`key-kind ${key.kind}`}>{key.kind}</span>
          <div><strong>{key.name}</strong><code>{key.kind === "service" ? maskSecret(key.prefix) : `${key.prefix}…`}</code></div>
          <span>{key.revokedAt ? t("widerrufen") : `${t("läuft ab")} ${format(key.expiresAt)}`}</span>
          {!key.revokedAt && <DangerousAction
            label={t("Widerrufen")}
            title={`${t("Key widerrufen")}: ${key.name}`}
            consequence={t("Der Widerruf wirkt sofort und lässt sich nicht zurücknehmen. Jede Anwendung, die mit diesem Key arbeitet, bekommt ab dann 401. Das Geheimnis ist nicht gespeichert, also kann niemand denselben Key wiederherstellen.")}
            confirmName={key.name}
            onConfirm={() => void revoke(key.id)}
          />}
        </div>)}
        {keys.length === 0 && <InlineEmptyState
          text={t("Noch kein Key in dieser Umgebung. Ein Key ist der Ausweis, mit dem deine Anwendung die Daten-API, Storage und Auth dieses Projekts erreicht; ohne Key kommt keine Anfrage durch. Das Geheimnis wird nie gespeichert und nur einmal gezeigt.")}
          action={<button className="button small" onClick={() => setCreating("public")}><Plus size={13}/> {t("Ersten Public Key anlegen")}</button>}
        />}
      </div>
      <p className="muted">{t("Eine Rotation gibt es hier nicht, weil keine Route sie kann. Wer einen Key wechseln will, legt den neuen an, stellt die Anwendung um und widerruft danach den alten.")}</p>
    </article>
  </div>;
}
