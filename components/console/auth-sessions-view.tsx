"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, LogOut, RefreshCw, Users } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment } from "@/components/console/console-display";
import { OptionMenu } from "@/components/console/option-menu";
import { StableLabel } from "@/components/stable-label";

/**
 * Sitzungen in der Console (2.34), wie bei Supabase unter Authentication,
 * Sessions. Erst einen App-Nutzer waehlen (erste Seite der Nutzerliste),
 * dann seine aktiven Sitzungen sehen und beenden. Beenden widerruft die
 * ganze Refresh-Familie einer Anmeldung; "Alle Sitzungen beenden" meldet den
 * Nutzer ueberall ab, ohne ihn zu deaktivieren. Die Route liefert kein
 * Token-Material, also zeigt die Ansicht auch keines.
 */
type Environment = "development" | "staging" | "production";
type AppUser = { id: string; email: string; status: "active" | "disabled" };
type Session = { id: string; familyId: string; assurance: "aal1" | "aal2"; createdAt: string; expiresAt: string; replacedBySessionId: string | null };

export function AuthSessionsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const base = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users`;
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selected, setSelected] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  // Jede Ladeanfrage bekommt eine Nummer; nur die juengste darf den Zustand
  // setzen. Sonst koennte eine langsame Antwort fuer Nutzer A nach dem
  // Wechsel zu Nutzer B dessen Liste ueberschreiben.
  const request = useRef(0);

  const loadSessions = useCallback(async (userId: string) => {
    const ticket = ++request.current;
    const current = () => ticket === request.current;
    setSessions([]);
    if (!userId) return;
    try {
      const response = await fetch(`${base}/${userId}/sessions`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!current()) return;
      if (!response.ok) { setMessage(serverErrorText(payload.error) ?? t("Sitzungen nicht verfügbar")); return; }
      setMessage(""); setSessions(payload.data.sessions as Session[]);
    } catch { if (current()) setMessage(t("Sitzungen nicht verfügbar")); }
  }, [base]);

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`${base}?limit=100`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503) { setState("unavailable"); setMessage(t("Project Auth ist für diese Umgebung deaktiviert.")); return; }
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Nutzer nicht verfügbar"));
      const list = payload.data.users as AppUser[];
      setUsers(list);
      const first = list[0]?.id ?? "";
      setSelected(first);
      await loadSessions(first);
      setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Nutzer nicht verfügbar")); }
  }, [base, loadSessions]);
  useEffect(() => { void load(); }, [load]);

  async function revoke(session: Session) {
    if (!window.confirm(t("Diese Sitzung beenden? Die App muss sich danach neu anmelden."))) return;
    setBusy(session.id);
    try {
      const response = await fetch(`${base}/${selected}/sessions/${session.id}`, { method: "DELETE" });
      if (!response.ok) { setMessage(t("Die Sitzung konnte nicht beendet werden.")); return; }
      await loadSessions(selected);
    } catch { setMessage(t("Die Sitzung konnte nicht beendet werden.")); }
    finally { setBusy(""); }
  }

  async function revokeAll() {
    if (!window.confirm(t("Alle Sitzungen dieses Nutzers beenden? Er wird überall abgemeldet, bleibt aber aktiv."))) return;
    setBusy("all");
    try {
      const response = await fetch(`${base}/${selected}/sessions`, { method: "DELETE" });
      if (!response.ok) { setMessage(t("Die Sitzungen konnten nicht beendet werden.")); return; }
      await loadSessions(selected);
    } catch { setMessage(t("Die Sitzungen konnten nicht beendet werden.")); }
    finally { setBusy(""); }
  }

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Sitzungen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><Fingerprint size={26}/><h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Project Auth nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const format = (value: string) => formatMoment(value);
  const assurance = (value: Session["assurance"]) => value === "aal2" ? t("Passwort + zweiter Faktor") : t("Passwort");
  const current = users.find((user) => user.id === selected);
  const columns = { gridTemplateColumns: "1fr 1fr 1.4fr 90px 170px" };

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("AKTIVE SITZUNGEN")}</span><strong>{current ? sessions.length : "–"}</strong><small>{t("des gewählten Nutzers")}</small></div>
      <div><span>{t("ZWEITER FAKTOR")}</span><strong>{current ? sessions.filter((session) => session.assurance === "aal2").length : "–"}</strong><small>{t("Sitzungen mit TOTP")}</small></div>
      <div><span>{t("APP-NUTZER")}</span><strong>{users.length}</strong><small>{t("erste Seite der Nutzerliste")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Sitzungen")}</h3></div>
        <div>
          {/* 2.133: Statt eines `select` des Betriebssystems dasselbe Menue wie
              oben in der Kopfzeile. Das Symbol steht an der Stelle des
              Zustandspunkts, wie es bisher im Feld stand. Die Adresse ist ein
              Bezeichner und wird nicht uebersetzt; die Erklaerzeile tragen nur
              deaktivierte Nutzer, weil das Deaktivieren ihre Sitzungen beendet
              hat und die Liste darum leer bleiben wird. */}
          <OptionMenu value={selected} ariaLabel={t("App-Nutzer")} listLabel={t("App-Nutzer wählen")}
            icon={<Users size={14} aria-hidden="true"/>}
            onChange={(next) => { setSelected(next); void loadSessions(next); }}
            options={users.map((user) => ({
              id: user.id,
              label: user.email,
              hint: user.status === "disabled" ? t("Deaktiviert; das Sperren hat seine Sitzungen beendet.") : undefined,
            }))}/>
          <button className="secondary-button" onClick={() => void loadSessions(selected)} disabled={!selected}><RefreshCw size={14}/> {t("Neu laden")}</button>
          <button className="secondary-button" onClick={() => void revokeAll()} disabled={!selected || sessions.length === 0 || busy !== ""}><LogOut size={14}/> <StableLabel current={busy === "all" ? t("Wird beendet…") : t("Alle Sitzungen beenden")} variants={tAll("Wird beendet…", "Alle Sitzungen beenden")}/></button>
        </div>
      </div>
      {users.length === 0 && <p className="muted">{t("Noch keine Nutzer. Sie kommen über Signup, Magic Link oder OIDC herein.")}</p>}
      {message && <p className="muted">{message}</p>}
      {current && sessions.length === 0 && !message && <div className="live-module-state compact"><LogOut size={24}/><p>{t("Dieser Nutzer hat gerade keine aktive Sitzung. Eine Sitzung entsteht, wenn er sich in deiner Anwendung anmeldet, und verschwindet beim Abmelden oder mit dem Ablauf ihres Refresh-Tokens.")}</p></div>}
      {sessions.length > 0 && <div className="log-row log-header" style={columns}><span>{t("Erstellt")}</span><span>{t("Läuft ab")}</span><span>{t("Anmeldung")}</span><span>{t("Familie")}</span><span/></div>}
      {sessions.map((session) => <div className="log-row" key={session.id} style={columns}>
        <time>{format(session.createdAt)}</time>
        <time>{format(session.expiresAt)}</time>
        <span className={session.assurance === "aal2" ? "secure" : ""}>{assurance(session.assurance)}</span>
        <code title={session.familyId}>{session.familyId.slice(0, 8)}</code>
        <span><button className="plain-button" onClick={() => void revoke(session)} disabled={busy !== ""}><StableLabel current={busy === session.id ? t("Wird beendet…") : t("Sitzung beenden")} variants={tAll("Wird beendet…", "Sitzung beenden")}/></button></span>
      </div>)}
    </article>
  </div>;
}
