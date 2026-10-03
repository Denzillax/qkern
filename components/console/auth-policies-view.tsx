"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Lock, RefreshCw, Radio, ShieldCheck, Table2 } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_ACCESS_ALLOWANCE_TEXTS,
  AUTH_ACCESS_COMMAND_TEXTS,
  AUTH_ACCESS_CONDITION_TEXTS,
  AUTH_ACCESS_FOREIGN_ROLE_NOTE,
  AUTH_ACCESS_LIST_SOURCE_NOTE,
  AUTH_ACCESS_MAPPING,
  AUTH_ACCESS_READ_ONLY_NOTE,
  AUTH_ACCESS_RESTRICTIVE_NOTE,
  AUTH_ACCESS_RLS_OFF_NOTE,
  AUTH_ACCESS_UNCERTAIN_NOTE,
  AUTH_ACCESS_VERDICTS,
  AUTH_ACCESS_VERDICT_TEXTS,
  AUTH_ACCESS_VIEWS_NOTE,
  type AuthAccessAllowance,
  type AuthAccessCommand,
  type AuthAccessCondition,
  type AuthAccessVerdict,
} from "@/lib/console/auth-policies-texts";

/**
 * Auth → Policies (2.62), nur lesend.
 *
 * Der Platzhalter sagte, hier stehe dieselbe Lage wie unter Datenbank →
 * Policies. Genau das tut diese Seite nicht. Sie beantwortet die Frage, die man
 * von der Anmeldung aus stellt: Was darf ein angemeldeter Nutzer dieses
 * Projekts lesen und schreiben, und warum?
 *
 * Darum steht die Abbildung oben und nicht im Kleingedruckten — welche
 * Datenbankrolle eine Anfrage wird, welche Claims gesetzt werden, und dass
 * dieselben Claims die Realtime-Tür entscheiden. Darunter steht je Tabelle ein
 * Urteil, je Befehl eine Antwort und bei jeder Bedingung, die von der Anfrage
 * abhängt, der Satz, dass diese Seite sie nicht ausrechnet.
 *
 * Kein Eingabefeld, kein Speicherknopf, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type CommandReport = {
  command: AuthAccessCommand;
  allowed: AuthAccessAllowance;
  condition: AuthAccessCondition;
  policies: string[];
  restrictedBy: string[];
};

type PolicyReport = {
  name: string;
  command: string;
  permissive: boolean;
  roles: string[];
  applies: boolean;
  usingExpression: string | null;
  checkExpression: string | null;
  condition: AuthAccessCondition;
};

type TableReport = {
  table: string;
  rowSecurityEnabled: boolean;
  verdict: AuthAccessVerdict;
  uncertain: boolean;
  commands: CommandReport[];
  policies: PolicyReport[];
  foreignRolePolicies: number;
};

type Access = {
  source: string;
  schema: string;
  role: string;
  claimRole: string;
  tables: TableReport[];
  counts: Partial<Record<AuthAccessVerdict, number>>;
  views: number;
  truncated: boolean;
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
type ViewState = "loading" | "ready" | "disabled" | "unavailable" | "error";

export function AuthPoliciesView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: ViewState }) {
  const url = `/api/v1/projects/${projectId}/environments/${environment}/auth/access?schema=public`;
  const [state, setState] = useState<ViewState>(initialState ?? "loading");
  const [access, setAccess] = useState<Access | null>(null);
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
    let status = 0;
    let payload: Record<string, unknown> = {};
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      status = response.status;
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      if (body !== null && typeof body === "object" && !Array.isArray(body)) payload = body as Record<string, unknown>;
    } catch (cause) {
      if (controller.signal.aborted) return;
      payload = { error: cause instanceof Error ? cause.message : "" };
    }
    if (controller.signal.aborted) return;
    const data = payload.data as Access | undefined;
    if (status === 200 && data && Array.isArray(data.tables) && typeof data.role === "string") {
      setAccess(data);
      setState("ready");
      return;
    }
    setAccess(null);
    setMessage(typeof payload.error === "string" ? (serverErrorText(payload.error) ?? "") : "");
    const code = typeof payload.code === "string" ? payload.code : "";
    // Abgeschaltet, nicht bereit und nicht erreichbar sind drei verschiedene
    // Auskuenfte. Ein 500 waere eine vierte und heisst hier schlicht Fehler.
    if (code === "DATA_PLANE_DISABLED") setState("disabled");
    else if (status === 503 || status === 409) setState("unavailable");
    else setState("error");
  }, [url]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("AUTH")} · {environment.toUpperCase()}</span><h3>{t("Was ein angemeldeter Nutzer darf")}</h3></div><div>{refresh}</div></div>
      <p className="muted">{t(AUTH_ACCESS_READ_ONLY_NOTE)}</p>
      <p className="muted">{t(AUTH_ACCESS_LIST_SOURCE_NOTE)}</p>

      {loading && !access && <p className="muted">{t("Die Datenbank wird gefragt…")}</p>}
      {state === "disabled" && <p><strong>{t("Data Plane abgeschaltet")}</strong> · {t("Diese Installation liest keine Projektdatenbank. Solange das so bleibt, gibt es hier nichts zu zeigen.")}</p>}
      {state === "unavailable" && <p><strong>{t("Datenbank nicht bereit")}</strong> · {message || t("Die Projektdatenbank ist noch nicht bereit.")}</p>}
      {state === "error" && <p><strong>{t("Rechte nicht verfügbar")}</strong> · {message}</p>}

      {access && <>
        <div className="log-row log-header"><span>{t("Angabe")}</span><span>{t("Wert")}</span></div>
        <div className="log-row"><span>{t("Schema")}</span><code>{access.schema}</code></div>
        <div className="log-row"><span>{t("Angemeldete Anfrage läuft als Datenbankrolle")}</span><code>{access.role}</code></div>
        <div className="log-row"><span>{t("Claim role")}</span><code>{access.claimRole}</code></div>
        {access.truncated && <p className="muted">{t("Eine der beiden Katalogauskünfte ist abgeschnitten. Das Urteil unten ist darum unvollständig.")}</p>}
        {access.views > 0 && <p className="muted">{t(AUTH_ACCESS_VIEWS_NOTE)}</p>}
      </>}
    </article>

    {access && <article className="console-card span-2">
      {AUTH_ACCESS_VERDICTS.map((verdict) => <div key={verdict}>
        <span>{t(AUTH_ACCESS_VERDICT_TEXTS[verdict].label).toUpperCase()}</span>
        <strong>{access.counts[verdict] ?? 0}</strong>
        <small>{t("Tabellen")}</small>
      </div>)}
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DIE ABBILDUNG")}</span><h3>{t("Wie aus einer Anmeldung eine Datenbankanfrage wird")}</h3></div><KeyRound size={18}/></div>
      {AUTH_ACCESS_MAPPING.map((entry, index) => <div className="bucket-row" key={entry.title}>
        {/* Der letzte Schritt ist die Realtime-Tuer; er traegt darum ein anderes Zeichen. */}
        <span className="bucket-icon">{index === AUTH_ACCESS_MAPPING.length - 1 ? <Radio size={16}/> : <ShieldCheck size={16}/>}</span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
      <p className="muted">{t(AUTH_ACCESS_RLS_OFF_NOTE)}</p>
      <p className="muted">{t(AUTH_ACCESS_UNCERTAIN_NOTE)}</p>
      <p className="muted">{t(AUTH_ACCESS_FOREIGN_ROLE_NOTE)}</p>
      <p className="muted">{t(AUTH_ACCESS_RESTRICTIVE_NOTE)}</p>
    </article>

    {access && <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Tabellen des Schemas public")}</h3></div><Table2 size={18}/></div>
      {access.tables.length === 0 && <p className="muted">{t("In diesem Schema gibt es keine Tabelle, über die etwas zu sagen wäre.")}</p>}
      {access.tables.map((table) => {
        const verdict = AUTH_ACCESS_VERDICT_TEXTS[table.verdict];
        return <div className="log-row" key={table.table}>
          <div>
            <strong>{table.table}</strong> {!table.rowSecurityEnabled && <code>{t("row security aus")}</code>}
            <p>{t(verdict.explains)}</p>
            {table.uncertain && <p className="muted">{t(AUTH_ACCESS_CONDITION_TEXTS.request.explains)}</p>}
            {table.commands.map((command) => {
              const allowance = AUTH_ACCESS_ALLOWANCE_TEXTS[command.allowed];
              return <p className="muted" key={command.command}>
                <strong>{t(AUTH_ACCESS_COMMAND_TEXTS[command.command].label)}</strong>
                {": "}<span className={allowance.tone}>{t(allowance.label)}</span>
                {command.allowed !== "no" && <> · {t(AUTH_ACCESS_CONDITION_TEXTS[command.condition].label)}</>}
                {command.policies.length > 0 && <> · {command.policies.join(", ")}</>}
                {command.restrictedBy.length > 0 && <> · {t("eingeengt von")} {command.restrictedBy.join(", ")}</>}
              </p>;
            })}
            {table.policies.map((policy) => <p className="muted" key={policy.name}>
              <code>{policy.name}</code> · {policy.command.toUpperCase()} · {policy.permissive ? t("permissiv") : t("restriktiv")} · {policy.roles.join(", ")}
              {!policy.applies && <> · <span className="muted">{t("gilt hier nicht")}</span></>}
              {policy.usingExpression !== null && <> · USING <code>{policy.usingExpression}</code></>}
              {policy.checkExpression !== null && <> · WITH CHECK <code>{policy.checkExpression}</code></>}
            </p>)}
            {table.policies.length === 0 && <p className="muted">{t("Für diese Tabelle gibt es keine Policy.")}{" "}{t("Ohne Policy zeigt RLS dieser Rolle keine Zeile; eine Regel entsteht über ein Change Set im SQL Editor und nicht aus dieser Ansicht.")}</p>}
            {table.foreignRolePolicies > 0 && <p className="muted">{table.foreignRolePolicies} {t("Policies nennen nur andere Rollen.")}</p>}
          </div>
          <span className={verdict.tone}>{t(verdict.label)}</span>
        </div>;
      })}
      <p className="muted">{t("Was hier steht, kommt aus dem Katalog. Diese Seite liest keine Zeile einer Tabelle und zählt darum auch nicht, wie viele Zeilen eine Bedingung erfasst.")}</p>
    </article>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS HIER NICHT GEHT")}</span><h3>{t("Ändern lässt sich das nicht hier")}</h3></div><Lock size={18}/></div>
      <p className="muted">{t("Eine Policy anlegen, ändern oder löschen und Row Level Security einschalten sind Schemaänderungen. Sie gehen über ein Change Set mit Freigabe, wie jede andere Änderung am Schema, und nicht über einen Knopf auf dieser Seite.")}</p>
      <p className="muted">{t("Wer eine einzelne Regel im Wortlaut sucht, findet sie unter Datenbank → Policies. Diese Seite fasst zusammen, was aus allen Regeln zusammen folgt.")}</p>
    </article>
  </div>;
}
