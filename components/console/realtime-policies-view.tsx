"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import {
  REALTIME_ACTION_LABELS,
  REALTIME_ACTIONS,
  REALTIME_CHANNEL_KIND_TEXTS,
  REALTIME_CHANNEL_KINDS,
  REALTIME_PERMISSION_NO,
  REALTIME_PERMISSION_NOTES,
  REALTIME_PERMISSION_YES,
  REALTIME_PERMISSIONS,
  REALTIME_POLICIES_DELETE_NOTE,
  REALTIME_POLICIES_HONESTY,
  REALTIME_POLICIES_RLS_NOTE,
  REALTIME_POLICIES_SCOPE_NOTE,
  REALTIME_POLICIES_SOURCE_NOTE,
  REALTIME_ROLE_TEXTS,
  REALTIME_ROLES,
} from "@/lib/console/realtime-texts";

/**
 * Realtime → Rechte (2.48).
 *
 * Die Seite zeigt, was heute tatsächlich über den Zugang zu einem Kanal
 * entscheidet, und nichts darüber hinaus: die feste Präfixregel aus
 * `PrefixRealtimeAuthorization`, die Rolle aus dem Projekt-Key und dem
 * Access Token, und auf `changes:`-Kanälen zusätzlich die Row Level Security
 * der Projekttabelle.
 *
 * Was es nicht gibt, steht als Erstes da: keine Kanalrechte, die sich
 * anlegen liessen, keine Zeile in einer Tabelle, kein Editor. Eine Seite mit
 * einem erfundenen Rechtemodell wäre bequemer und falsch.
 *
 * Nur lesend. Die Seite ruft keine Route auf; es gibt keine, weil es nichts
 * abzufragen gibt — die Regel steht im Code und ändert sich nicht je Projekt.
 */
export function RealtimePoliciesView() {
  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("REALTIME")}</span><h3>{t("Rechte")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(REALTIME_POLICIES_HONESTY)}</p>
      <p className="muted">{t(REALTIME_POLICIES_SCOPE_NOTE)}</p>
      <p className="muted">{t(REALTIME_POLICIES_SOURCE_NOTE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ROLLEN")}</span><h3>{t("Woher die Rolle einer Verbindung kommt")}</h3></div><KeyRound size={18}/></div>
      {REALTIME_ROLES.map((role) => <div className="log-row" key={role}>
        <code>{REALTIME_ROLE_TEXTS[role].label}</code>
        <small style={{ gridColumn: "span 3" }}>{t(REALTIME_ROLE_TEXTS[role].explains)}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("KANÄLE")}</span><h3>{t("Was jede Rolle auf welchem Kanal darf")}</h3></div></div>
      <div className="log-row log-header">
        <span>{t("Kanal")}</span><span>{t("Rolle")}</span>
        {REALTIME_ACTIONS.map((action) => <span key={action}>{t(REALTIME_ACTION_LABELS[action])}</span>)}
      </div>
      {REALTIME_CHANNEL_KINDS.map((kind) => <div key={kind}>
        <div className="log-row"><code>{REALTIME_CHANNEL_KIND_TEXTS[kind].pattern}</code>
          <small style={{ gridColumn: "span 4" }}>{t(REALTIME_CHANNEL_KIND_TEXTS[kind].explains)}</small></div>
        {REALTIME_ROLES.map((role) => {
          const allowed = REALTIME_PERMISSIONS[kind][role];
          const note = REALTIME_PERMISSION_NOTES[kind]?.[role];
          return <div className="log-row" key={`${kind}-${role}`}>
            <span/>
            <code>{REALTIME_ROLE_TEXTS[role].label}</code>
            {REALTIME_ACTIONS.map((action) => <span key={action} className={allowed[action] ? "secure" : "muted"}>
              {allowed[action] ? t(REALTIME_PERMISSION_YES) : t(REALTIME_PERMISSION_NO)}
            </span>)}
            {note && <small style={{ gridColumn: "span 5" }}>{t(note)}</small>}
          </div>;
        })}
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("ZEILEN")}</span><h3>{t("Was bei Datenbankänderungen zusätzlich gilt")}</h3></div></div>
      <p className="muted">{t(REALTIME_POLICIES_RLS_NOTE)}</p>
      <p className="muted">{t(REALTIME_POLICIES_DELETE_NOTE)}</p>
      <p className="muted">{t("Die RLS-Regeln selbst stehen unter Datenbank → Policies. Sie gelten für die Tabelle, nicht für den Kanal, und der Kanal erfindet keine dazu.")}</p>
    </article>
  </div>;
}
