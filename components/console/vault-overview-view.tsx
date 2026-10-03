"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  VAULT_OPERATOR_STEPS,
  VAULT_OVERVIEW_SCOPE,
  VAULT_REFERENCE_STATUS,
  VAULT_REFERENCE_USERS,
  type VaultReferenceStatusId,
  type VaultReferenceUserId,
} from "@/lib/console/vault-overview-texts";

/**
 * Integrationen → Vault (2.58), nur lesend.
 *
 * Der Platzhalter versprach „Geheimnisse verwalten". Diese Ansicht verwaltet
 * nichts. Sie zeigt jede Secret-Referenz, auf die QKERN in dieser Umgebung
 * zeigt, wer sie benutzt und ob der Vault sie aufloest — und sagt daneben, was
 * im Vault selbst zu tun ist. Es gibt hier kein Eingabefeld, keinen
 * Schreibaufruf und keinen Weg zu einem Wert.
 */
type Environment = "development" | "staging" | "production";
type ReferenceUser = { kind: VaultReferenceUserId; id: string; name: string };
type ReferenceRow = { ref: string; status: VaultReferenceStatusId; users: ReferenceUser[] };
type Counts = { total: number; present: number; missing: number; forbidden: number };
type ViewState = "loading" | "ready" | "unavailable" | "error";

const STATUS_CLASS: Record<VaultReferenceStatusId, string> = {
  present: "secure", missing: "risk high", forbidden: "risk medium",
};
const EMPTY: Counts = { total: 0, present: 0, missing: 0, forbidden: 0 };

/** GET mit JSON-Antwort; ein Body, der kein Objekt ist, wird zu `{}`. */
async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    return { status: response.status, payload: body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {} };
  } catch (cause) {
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

function statusLabel(status: VaultReferenceStatusId): string {
  return t(VAULT_REFERENCE_STATUS[status]?.label ?? "unbekannt");
}

export function VaultOverviewView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: ViewState }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/compute/secrets`;
  const [state, setState] = useState<ViewState>(initialState ?? "loading");
  const [rows, setRows] = useState<ReferenceRow[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [checkedAt, setCheckedAt] = useState("");
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
    const result = await readJson(url, controller.signal);
    if (controller.signal.aborted) return;
    const data = result.payload.data as { references?: unknown; counts?: unknown; checkedAt?: unknown } | undefined;
    if (result.status === 200 && data && Array.isArray(data.references)) {
      setRows(data.references as ReferenceRow[]);
      setCounts(data.counts && typeof data.counts === "object" ? data.counts as Counts : EMPTY);
      setCheckedAt(typeof data.checkedAt === "string" ? data.checkedAt : "");
      setState("ready");
      return;
    }
    setRows([]); setCounts(EMPTY); setCheckedAt("");
    setMessage(typeof result.payload.error === "string" && result.payload.error ? (serverErrorText(result.payload.error) ?? "") : t("Stand der Secret-Referenzen nicht verfügbar"));
    setState(result.status === 503 ? "unavailable" : "error");
  }, [url]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const checking = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={checking}>
    <RefreshCw size={14}/> <StableLabel current={checking ? t("Prüft…") : t("Neu prüfen")} variants={tAll("Prüft…", "Neu prüfen")}/>
  </button>;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("REFERENZEN")}</span><strong>{counts.total}</strong><small>{t("in dieser Umgebung")}</small></div>
      {(["present", "missing", "forbidden"] as const).map((id) => <div key={id}>
        <span>{statusLabel(id).toUpperCase()}</span>
        <strong>{counts[id]}</strong>
        <small className={STATUS_CLASS[id]}>{t(VAULT_REFERENCE_STATUS[id].meaning)}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VAULT")} · {environment.toUpperCase()}</span><h3>{t("Secret-Referenzen dieser Umgebung")}</h3></div><div>{refresh}</div></div>

      {state === "loading" && rows.length === 0 && <p className="muted">{t("Vault wird gefragt…")}</p>}
      {state === "unavailable" && <p><strong>{t("Vault nicht verbunden")}</strong> · {message}</p>}
      {state === "error" && <p><strong>{t("Stand der Secret-Referenzen nicht verfügbar")}</strong> · {message}</p>}

      {state === "ready" && <>
        {rows.length === 0 && <p className="muted">{t("In dieser Umgebung zeigt nichts auf ein Geheimnis. Sobald eine Function, ein Webhook oder ein Datenbank-Webhook eine Referenz trägt, steht sie hier.")}</p>}

        {rows.length > 0 && <>
          <div className="log-row log-header"><span>{t("Referenz")}</span><span>{t("Benutzt von")}</span><span>{t("Status")}</span></div>
          {rows.map((row) => <div className="log-row" key={row.ref}>
            <code>{row.ref}</code>
            <span className="muted">{row.users.map((user) => `${t(VAULT_REFERENCE_USERS[user.kind]?.label ?? "unbekannt")} · ${user.name}`).join(", ")}</span>
            <span className={STATUS_CLASS[row.status] ?? "muted"}>{statusLabel(row.status)}</span>
          </div>)}
          {checkedAt && <p className="muted">{t("Geprüft")}: {formatMoment(checkedAt, "dateTimeSeconds")}</p>}
        </>}
      </>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was diese Seite zeigt")}</h3></div><KeyRound size={18}/></div>
      {VAULT_OVERVIEW_SCOPE.map((sentence) => <p className="muted" key={sentence}>{t(sentence)}</p>)}
      <div className="log-row log-header"><span>{t("Quelle")}</span><span>{t("Was sie bedeutet")}</span></div>
      {(["function", "webhook", "database-webhook"] as const).map((id) => <div className="log-row" key={id}>
        <span>{t(VAULT_REFERENCE_USERS[id].label)}</span>
        <span className="muted">{t(VAULT_REFERENCE_USERS[id].meaning)}</span>
      </div>)}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("IM VAULT, NICHT HIER")}</span><h3>{t("Was ein Betreiber selbst tun muss")}</h3></div><Lock size={18}/></div>
      {VAULT_OPERATOR_STEPS.map((step) => <div className="bucket-row" key={step.title}>
        <span className="bucket-icon"><ShieldCheck size={16}/></span>
        <div><strong>{t(step.title)}</strong><p className="muted">{t(step.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
