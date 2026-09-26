"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, RefreshCw, ScrollText } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Audit-Log von Project Auth in der Console (2.35), wie bei Supabase unter
 * Authentication, Audit Logs. Ein Auszug aus der Hash-Kette der Plattform:
 * nur `project_auth.*` dieses Projekts und dieser Umgebung, neueste zuerst,
 * seitenweise ueber den Cursor der Route. E-Mails und Token stehen nie im
 * Audit, also zeigt die Ansicht Nutzer nur als gekuerzte ID.
 */
type Environment = "development" | "staging" | "production";
type AuditEvent = {
  id: string;
  createdAt: string;
  actorType: string;
  actorRef: string;
  action: string;
  resourceRef: string;
  status: string;
  metadata: Record<string, string | number | boolean>;
};

const PAGE_SIZE = 50;
const CHIP = { display: "inline-block", fontSize: 11, margin: "0 4px 2px 0", padding: "1px 6px", border: "1px solid var(--qkern-border)", borderRadius: 999 } as const;

function actionLabel(action: string): string {
  switch (action) {
    case "project_auth.signup.succeeded": return t("Registrierung");
    case "project_auth.login.succeeded": return t("Anmeldung");
    case "project_auth.login.failed": return t("Fehlgeschlagene Anmeldung");
    case "project_auth.logout": return t("Abmeldung");
    case "project_auth.mfa.enrolled": return t("Zweiter Faktor eingerichtet");
    case "project_auth.mfa.verified": return t("Zweiter Faktor bestätigt");
    case "project_auth.user.updated": return t("Nutzer geändert");
    case "project_auth.session.revoked": return t("Sitzung beendet");
    case "project_auth.sessions.revoked_all": return t("Alle Sitzungen beendet");
    default: return action;
  }
}

function shortRef(ref: string): string {
  const id = ref.includes(":") ? ref.slice(ref.lastIndexOf(":") + 1) : ref;
  return id.length > 8 ? id.slice(0, 8) : id;
}

function actorLabel(event: AuditEvent): string {
  if (event.actorRef === "anonymous") return t("Unbekannt");
  if (event.actorType === "admin") return `${t("Admin")} · ${shortRef(event.actorRef)}`;
  if (event.actorType === "system") return t("System");
  return `${t("App-Nutzer")} · ${shortRef(event.actorRef)}`;
}

export function AuthAuditView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/audit`;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");
  const [more, setMore] = useState(false);
  // Nur die juengste Anfrage darf den Zustand setzen: ein "Neu laden"
  // waehrend "Mehr laden" laeuft, soll nicht alte Seiten anhaengen.
  const request = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++request.current;
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`${base}?limit=${PAGE_SIZE}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (ticket !== request.current) return;
      if (response.status === 503) { setState("unavailable"); setMessage(t("Project Auth ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Audit-Log nicht verfügbar"));
      setEvents(payload.data.events as AuditEvent[]);
      setCursor(payload.data.nextCursor as string | null);
      setState("ready");
    } catch (cause) {
      if (ticket !== request.current) return;
      setState("error"); setMessage(cause instanceof Error ? cause.message : t("Audit-Log nicht verfügbar"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!cursor) return;
    const ticket = request.current;
    setMore(true);
    try {
      const response = await fetch(`${base}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (ticket !== request.current) return;
      if (!response.ok) { setMessage(payload.error ?? t("Audit-Log nicht verfügbar")); return; }
      setMessage("");
      setEvents((current) => [...current, ...(payload.data.events as AuditEvent[])]);
      setCursor(payload.data.nextCursor as string | null);
    } catch { if (ticket === request.current) setMessage(t("Audit-Log nicht verfügbar")); }
    finally { setMore(false); }
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Audit-Log wird geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Fingerprint size={26}/><h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Project Auth nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const format = (value: string) => new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  const columns = { gridTemplateColumns: "150px 1.3fr 1fr 90px 110px 1.4fr" };
  const failed = events.filter((event) => event.status === "failed").length;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("EREIGNISSE")}</span><strong>{events.length}</strong><small>{cursor ? t("geladen, es gibt mehr") : t("alle geladen")}</small></div>
      <div><span>{t("FEHLVERSUCHE")}</span><strong>{failed}</strong><small>{t("unter den geladenen")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Audit-Log")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button>
        </div>
      </div>
      <p className="muted">{t("Auszug aus der Audit-Kette der Plattform. E-Mails, Passwörter und Token werden nie gespeichert.")}</p>
      {message && <p className="muted">{message}</p>}
      {events.length === 0 && <div className="live-module-state compact"><ScrollText size={24}/><p>{t("Noch keine Auth-Ereignisse. Registrierungen, Anmeldungen, Fehlversuche und Widerrufe erscheinen hier.")}</p></div>}
      {events.length > 0 && <div className="log-row log-header" style={columns}><span>{t("Zeit")}</span><span>{t("Aktion")}</span><span>{t("Akteur")}</span><span>{t("Ressource")}</span><span>{t("Status")}</span><span>{t("Details")}</span></div>}
      {events.map((event) => <div className="log-row" key={event.id} style={columns}>
        <time>{format(event.createdAt)}</time>
        <span title={event.action}>{actionLabel(event.action)}</span>
        <span title={event.actorRef}>{actorLabel(event)}</span>
        <code title={event.resourceRef}>{shortRef(event.resourceRef)}</code>
        <span className={event.status === "failed" ? undefined : "secure"} style={event.status === "failed" ? { color: "var(--qkern-danger)" } : undefined}>{event.status === "failed" ? t("fehlgeschlagen") : t("erfolgreich")}</span>
        <span>{Object.entries(event.metadata).map(([key, value]) => <code key={key} style={CHIP}>{key}={String(value)}</code>)}</span>
      </div>)}
      {cursor && <div className="card-head"><div/><div>
        <button className="secondary-button" onClick={() => void loadMore()} disabled={more}><StableLabel current={more ? t("Wird geladen…") : t("Mehr laden")} variants={tAll("Wird geladen…", "Mehr laden")}/></button>
      </div></div>}
    </article>
  </div>;
}
