"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Blocks, KeyRound, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Secrets der Functions in der Console (2.38), wie bei Supabase unter
 * Edge Functions → Secrets, aber nur lesend.
 *
 * Gezeigt wird je Function jede deklarierte Referenz und ob der Vault sie
 * aufloest: vorhanden, fehlt oder kein Zugriff. Die Route liefert nur diese
 * drei Woerter; einen Wert kennt die Console nicht und fragt ihn nie an.
 * Anlegen und Aendern geschieht im Vault.
 */
type Environment = "development" | "staging" | "production";
type FunctionItem = { id: string; name: string; secretRefs: string[] };
type SecretStatus = "present" | "missing" | "forbidden";
type SecretItem = { ref: string; status: SecretStatus };
type ListState = "loading" | "ready" | "unavailable" | "error";
type SecretState = { state: "idle" | "loading" | "ready" | "unavailable" | "error"; secrets: SecretItem[]; checkedAt: string; message: string };

type Payload = Record<string, unknown>;

/** GET mit JSON-Antwort; ein Body, der kein Objekt ist, wird zu `{}`. */
async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Payload }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Payload : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

function statusLabel(status: SecretStatus): string {
  switch (status) {
    case "present": return t("vorhanden");
    case "missing": return t("fehlt");
    case "forbidden": return t("kein Zugriff");
    default: return t("unbekannt");
  }
}
const STATUS_CLASS: Record<SecretStatus, string> = { present: "secure", missing: "risk high", forbidden: "risk medium" };

export function ComputeSecretsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/compute`;
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [selected, setSelected] = useState("");
  const [listState, setListState] = useState<ListState>("loading");
  const [listMessage, setListMessage] = useState("");
  const [secrets, setSecrets] = useState<SecretState>({ state: "idle", secrets: [], checkedAt: "", message: "" });

  // Jede Ladung bekommt einen eigenen AbortController; eine abgebrochene
  // Ladung setzt keinen Zustand mehr.
  const listRequest = useRef<AbortController | null>(null);
  const secretRequest = useRef<AbortController | null>(null);

  const loadSecrets = useCallback(async (item: FunctionItem | undefined) => {
    secretRequest.current?.abort();
    if (!item || item.secretRefs.length === 0) { setSecrets({ state: "idle", secrets: [], checkedAt: "", message: "" }); return; }
    const controller = new AbortController();
    secretRequest.current = controller;
    setSecrets((previous) => ({ ...previous, state: "loading", message: "" }));
    const result = await readJson(`${base}/functions/${item.id}/secrets`, controller.signal);
    if (controller.signal.aborted) return;
    const data = result.payload.data as { secrets?: unknown; checkedAt?: unknown } | undefined;
    if (result.status === 200 && data && Array.isArray(data.secrets)) {
      setSecrets({ state: "ready", secrets: data.secrets as SecretItem[], checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : "", message: "" });
      return;
    }
    const message = typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Status der Secrets nicht verfügbar");
    setSecrets({ state: result.status === 503 ? "unavailable" : "error", secrets: [], checkedAt: "", message });
  }, [base]);

  const load = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setListState("loading"); setListMessage("");
    const result = await readJson(`${base}/functions`, controller.signal);
    if (controller.signal.aborted) return;
    if (result.status !== 200 || !Array.isArray(result.payload.data)) {
      setListState(result.status === 503 ? "unavailable" : "error");
      setListMessage(typeof result.payload.error === "string" && result.payload.error ? result.payload.error : t("Function-Definitionen nicht verfügbar"));
      return;
    }
    const list = (result.payload.data as FunctionItem[]).map((item) => ({ id: item.id, name: item.name, secretRefs: Array.isArray(item.secretRefs) ? item.secretRefs : [] }));
    setFunctions(list);
    const first = list[0];
    setSelected(first?.id ?? "");
    setListState("ready");
    await loadSecrets(first);
  }, [base, loadSecrets]);

  useEffect(() => {
    void load();
    return () => { listRequest.current?.abort(); secretRequest.current?.abort(); };
  }, [load]);

  if (listState === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Functions werden geladen…")}</h3></div>;
  if (listState === "unavailable" || listState === "error") return <div className="console-card live-module-state"><Blocks size={26}/><h3>{listState === "unavailable" ? t("Compute nicht aktiviert") : t("Compute nicht verfügbar")}</h3><p>{listMessage}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const current = functions.find((item) => item.id === selected);
  const checking = secrets.state === "loading";

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FUNCTIONS")} · {environment.toUpperCase()}</span><h3>{t("Secrets der Function")}</h3></div><div>
        <label className="table-select"><Blocks size={15}/><select value={selected} onChange={(event) => { setSelected(event.target.value); void loadSecrets(functions.find((item) => item.id === event.target.value)); }} aria-label={t("Function")}>{functions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="secondary-button" onClick={() => void loadSecrets(current)} disabled={!current || checking || current.secretRefs.length === 0}><RefreshCw size={14}/> <StableLabel current={checking ? t("Prüft…") : t("Neu prüfen")} variants={tAll("Prüft…", "Neu prüfen")}/></button>
      </div></div>
      {functions.length === 0 && <p className="muted">{t("Noch keine Functions. Lege eine unter Functions & Jobs an; ihre Secret-Referenzen erscheinen dann hier.")}</p>}
      {current && current.secretRefs.length === 0 && <p className="muted">{t("Diese Function hat keine Secrets")}</p>}
      {current && current.secretRefs.length > 0 && <>
        {secrets.state === "loading" && secrets.secrets.length === 0 && <p className="muted">{t("Vault wird gefragt…")}</p>}
        {secrets.state === "unavailable" && <p><strong>{t("Vault nicht verbunden")}</strong> · {secrets.message}</p>}
        {secrets.state === "error" && <p><strong>{t("Status der Secrets nicht verfügbar")}</strong> · {secrets.message}</p>}
        {(secrets.state === "unavailable" || secrets.state === "error") && current.secretRefs.map((ref) => <div className="bucket-row" key={ref}><span className="bucket-icon"><KeyRound size={16}/></span><div><code>{ref}</code></div><span className="muted">{t("unbekannt")}</span></div>)}
        {secrets.secrets.length > 0 && (secrets.state === "ready" || secrets.state === "loading") && <>
          <div className="log-row log-header"><span>{t("Referenz")}</span><span>{t("Status")}</span></div>
          {secrets.secrets.map((item) => <div className="log-row" key={item.ref}><code>{item.ref}</code><span className={STATUS_CLASS[item.status] ?? "muted"}>{statusLabel(item.status)}</span></div>)}
          {secrets.checkedAt && <p className="muted">{t("Geprüft")}: {new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "medium" }).format(new Date(secrets.checkedAt))}</p>}
        </>}
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was diese Ansicht zeigt")}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t("Werte zeigt QKERN nie. Anlegen und Ändern von Secrets geschieht im Vault; die Konsole prüft nur, ob eine Referenz aufgelöst wird.")}</p>
      <p className="muted">{t("Eine Referenz hat die Form vault:pfad/zum/secret. Was nicht in diese Form passt, gilt als kein Zugriff und wird nicht angefragt.")}</p>
      <p className="muted">{t("Kein Zugriff heisst auch: Die Vault-Policy erlaubt das Lesen der Metadaten dieses Pfads nicht.")}</p>
    </article>
  </div>;
}
