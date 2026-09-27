"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, Clock, HardDrive, MapPin, Puzzle, RefreshCw, Server } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  BINDING_STATE_TEXTS,
  ENVIRONMENTS_SOURCE_NOTE,
  EXTENSIONS_SOURCE_NOTE,
  MISSING_INFRASTRUCTURE,
  PROJECT_STATUS_TEXTS,
  RECOVERY_STATE_TEXTS,
  REGION_SOURCE_NOTE,
  RUNTIME_SOURCE_NOTE,
  SCOPE_NOTE,
  SIZE_SOURCE_NOTE,
  bindingState,
  projectStatus,
  recoveryState,
} from "@/lib/console/infrastructure-texts";

/**
 * Einstellungen → Infrastruktur (2.67), nur lesend.
 *
 * Der Platzhalter versprach „Region, Postgres-Version, Lese-Replikate". Zwei
 * davon gibt es wirklich, und sie stehen hier mit ihrer Quelle. Lese-Replikate
 * gibt es nicht; das ist eine Zeile mit Grund und keine leere Kachel.
 *
 * Die Seite beantwortet „worauf läuft das hier": Region und Zustand aus der
 * Projektzeile, die Umgebungen mit ihrer Datenbankreferenz, Version, Kodierung
 * und Sortierung aus der Projektdatenbank selbst, ihre Grösse und die
 * installierten Erweiterungen. Wie die Datenbank eingestellt ist, steht unter
 * Datenbank → Einstellungen und wird hier nicht wiederholt.
 *
 * Kein Eingabefeld, kein Speicherknopf, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type Runtime = {
  source: string;
  serverVersion: string;
  serverVersionNum: number;
  encoding: string;
  collate: string;
  ctype: string;
  sizeBytes: number;
  inRecovery: boolean;
  startedAt: string;
};

type Binding = {
  environment: Environment;
  databaseInstanceRef: string;
  bound: boolean;
  createdAt: string | null;
};

type Extension = { name: string; installedVersion: string | null; schema: string | null };

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
type ViewState = "loading" | "ready" | "disabled" | "unavailable" | "error";

/** Bytes lesbar, ohne eine Genauigkeit vorzutäuschen, die die Messung nicht hat. */
function bytes(value: number): string {
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} KiB`;
  if (value < 1024 * 1024 * 1024) return `${formatNumber(Math.round(value / (1024 * 1024)))} MiB`;
  return `${formatNumber(Math.round(value / (1024 * 1024 * 1024)))} GiB`;
}

async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    return { status: response.status, payload };
  } catch (cause) {
    if (signal.aborted) return { status: 0, payload: {} };
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

export function InfrastructureView(props: {
  projectId: string;
  environment: Environment;
  region: string;
  status: string;
}) {
  const { projectId, environment, region } = props;
  const [state, setState] = useState<ViewState>("loading");
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [extensions, setExtensions] = useState<Extension[] | null>(null);
  const [message, setMessage] = useState("");
  // Jede Ladung bekommt einen eigenen AbortController; eine abgebrochene
  // Ladung setzt keinen Zustand mehr.
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => (previous === "ready" ? "ready" : "loading"));
    setMessage("");
    const base = `/api/v1/projects/${projectId}/environments/${environment}`;
    const [runtimeAnswer, extensionAnswer, bindingAnswer] = await Promise.all([
      readJson(`${base}/database/runtime`, controller.signal),
      readJson(`${base}/schema/extensions`, controller.signal),
      readJson(`/api/v1/projects/${projectId}/environments`, controller.signal),
    ]);
    if (controller.signal.aborted) return;

    // Die Umgebungen kommen aus der Kontrollebene und haengen nicht an der
    // Data Plane. Sie bleiben darum stehen, auch wenn die Datenbank schweigt.
    const bindingData = bindingAnswer.payload.data as { environments?: Binding[] } | undefined;
    setBindings(bindingAnswer.status === 200 && Array.isArray(bindingData?.environments) ? bindingData!.environments! : null);

    const extensionData = extensionAnswer.payload.data as { extensions?: Extension[] } | undefined;
    setExtensions(extensionAnswer.status === 200 && Array.isArray(extensionData?.extensions)
      ? extensionData!.extensions!.filter((entry) => entry.installedVersion !== null)
      : null);

    const data = runtimeAnswer.payload.data as Runtime | undefined;
    if (runtimeAnswer.status === 200 && data && typeof data.serverVersion === "string" && typeof data.sizeBytes === "number") {
      setRuntime(data);
      setState("ready");
      return;
    }
    setRuntime(null);
    setMessage(typeof runtimeAnswer.payload.error === "string" ? runtimeAnswer.payload.error : "");
    const code = typeof runtimeAnswer.payload.code === "string" ? runtimeAnswer.payload.code : "";
    // Abgeschaltet, nicht bereit und nicht erreichbar sind drei verschiedene
    // Auskuenfte. Ein 500 waere eine vierte und heisst hier schlicht Fehler.
    if (code === "DATA_PLANE_DISABLED") setState("disabled");
    else if (runtimeAnswer.status === 503 || runtimeAnswer.status === 409) setState("unavailable");
    else setState("error");
  }, [projectId, environment]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const status = PROJECT_STATUS_TEXTS[projectStatus(props.status)];
  const recovery = runtime ? RECOVERY_STATE_TEXTS[recoveryState(runtime.inRecovery)] : null;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("PROJEKT")} · {environment.toUpperCase()}</span><h3>{t("Worauf diese Umgebung läuft")}</h3></div><div>{refresh}</div></div>
      <p className="muted">{t(SCOPE_NOTE)}</p>
      <div className="bucket-row">
        <span className="bucket-icon"><MapPin size={16}/></span>
        <div><strong>{region}</strong><p className="muted">{t(REGION_SOURCE_NOTE)}</p></div>
      </div>
      <div className="bucket-row">
        <span className="bucket-icon"><Server size={16}/></span>
        <div><strong className={status.tone}>{t(status.label)}</strong><p className="muted">{t(status.explains)}</p></div>
      </div>

      {loading && !runtime && <p className="muted">{t("Die Datenbank wird gefragt…")}</p>}
      {state === "disabled" && <p><strong>{t("Data Plane abgeschaltet")}</strong> · {t("Diese Installation liest keine Projektdatenbank. Region und Umgebungen stehen trotzdem da, denn sie kommen aus der Kontrollebene.")}</p>}
      {state === "unavailable" && <p><strong>{t("Datenbank nicht bereit")}</strong> · {message || t("Die Projektdatenbank ist noch nicht bereit.")}</p>}
      {state === "error" && <p><strong>{t("Laufzeit nicht verfügbar")}</strong> · {message}</p>}
    </article>

    {runtime && recovery && <article className="console-card">
      <div className="card-head"><div><span>{t("POSTGRES")}</span><h3>{t("Server und Datenbank")}</h3></div><Server size={18}/></div>
      <div className="log-row log-header"><span>{t("Angabe")}</span><span>{t("Wert")}</span></div>
      <div className="log-row"><span>{t("Version")}</span><code>{runtime.serverVersion}</code></div>
      <div className="log-row"><span>server_version_num</span><span>{formatNumber(runtime.serverVersionNum)}</span></div>
      <div className="log-row"><span>{t("Kodierung")}</span><code>{runtime.encoding}</code></div>
      <div className="log-row"><span>{t("Sortierung")}</span><code>{runtime.collate}</code></div>
      <div className="log-row"><span>{t("Zeichenklassen")}</span><code>{runtime.ctype}</code></div>
      <div className="bucket-row">
        <span className="bucket-icon"><Clock size={16}/></span>
        <div><strong className={recovery.tone}>{t(recovery.label)}</strong><p className="muted">{t(recovery.explains)}</p></div>
      </div>
      <div className="log-row"><span>{t("Server läuft seit")}</span><span>{formatMoment(runtime.startedAt)}</span></div>
      <p className="muted">{t(RUNTIME_SOURCE_NOTE)}</p>
    </article>}

    {runtime && <article className="console-card">
      <div className="card-head"><div><span>{t("GRÖSSE")}</span><h3>{t("Diese Datenbank")}</h3></div><HardDrive size={18}/></div>
      <div className="bucket-row">
        <span className="bucket-icon"><HardDrive size={16}/></span>
        <div><strong>{bytes(runtime.sizeBytes)}</strong><p className="muted">{t("gemessen im Moment des Aufrufs")}</p></div>
      </div>
      <div className="log-row"><span>{t("Bytes")}</span><span>{formatNumber(runtime.sizeBytes)}</span></div>
      <p className="muted">{t(SIZE_SOURCE_NOTE)}</p>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("UMGEBUNGEN")}</span><h3>{t("Was dieses Projekt hat")}</h3></div><Boxes size={18}/></div>
      {bindings === null && <p className="muted">{t("Die Umgebungen dieses Projekts sind nicht abrufbar.")}</p>}
      {bindings !== null && bindings.length === 0 && <p className="muted">{t("Die Kontrollebene führt für dieses Projekt keine Umgebung.")}</p>}
      {(bindings ?? []).map((entry) => {
        const binding = BINDING_STATE_TEXTS[bindingState(entry.bound)];
        return <div className="bucket-row" key={entry.environment}>
          <span className="bucket-icon"><Boxes size={16}/></span>
          <div>
            <strong>{entry.environment.toUpperCase()}{entry.environment === environment ? ` · ${t("gerade geöffnet")}` : ""}</strong>
            <small><code>{entry.databaseInstanceRef}</code>{entry.createdAt ? ` · ${t("angelegt")} ${formatMoment(entry.createdAt)}` : ""}</small>
            <p className="muted">{t(binding.explains)}</p>
          </div>
          <span className={binding.tone}>{t(binding.label)}</span>
        </div>;
      })}
      <p className="muted">{t(ENVIRONMENTS_SOURCE_NOTE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ERWEITERUNGEN")}</span><h3>{t("Installiert in dieser Datenbank")}</h3></div><Puzzle size={18}/></div>
      {extensions === null && <p className="muted">{t("Die Erweiterungen dieser Datenbank sind nicht abrufbar.")}</p>}
      {extensions !== null && extensions.length === 0 && <p className="muted">{t("In dieser Datenbank ist keine Erweiterung installiert.")}</p>}
      {(extensions ?? []).map((entry) => <div className="bucket-row" key={entry.name}>
        <span className="bucket-icon"><Puzzle size={16}/></span>
        <div><strong>{entry.name}</strong><small>{entry.schema ? `${t("Schema")} ${entry.schema}` : ""}</small></div>
        <code>{entry.installedVersion}</code>
      </div>)}
      <p className="muted">{t(EXTENSIONS_SOURCE_NOTE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NICHT VORHANDEN")}</span><h3>{t("Was QKERN über diese Infrastruktur nicht weiss")}</h3></div></div>
      {MISSING_INFRASTRUCTURE.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><Server size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
