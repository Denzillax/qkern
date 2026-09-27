"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, UserCog } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { formatDay } from "@/components/console/console-display";

/**
 * Rollen in der Console (2.20): die Datenbankrollen ohne die vordefinierten
 * pg_-Rollen, gelesen über `/schema/roles`. Nur lesend; QKERN trennt seine
 * Rollen in der Migration.
 */
type Environment = "development" | "staging" | "production";
type Role = { name: string; superuser: boolean; createDatabase: boolean; createRole: boolean; inherit: boolean; login: boolean; replication: boolean; bypassRowSecurity: boolean; connectionLimit: number | null; validUntil: string | null };

export function RolesView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema/roles`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 409) { setState("unavailable"); setMessage(payload.error ?? t("Die Projektdatenbank ist noch nicht bereit.")); return; }
      if (!response.ok) throw new Error(payload.error ?? t("Rollen nicht verfügbar"));
      setRoles(payload.data.roles as Role[]); setTruncated(Boolean(payload.data.truncated)); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Rollen nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Rollen werden geladen…")}</h3></div>;
  if (state === "unavailable" || state === "error") return <div className="console-card live-module-state"><UserCog size={26}/><h3>{state === "unavailable" ? t("Datenbank nicht bereit") : t("Rollen nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const shown = roles.filter((role) => role.name.toLowerCase().includes(query.toLowerCase()));
  const traits = (role: Role) => [
    role.login ? t("Anmeldung") : t("Gruppenrolle"),
    role.createDatabase ? "CREATEDB" : null, role.createRole ? "CREATEROLE" : null, role.replication ? "REPLICATION" : null,
    role.bypassRowSecurity ? "BYPASSRLS" : null, !role.inherit ? "NOINHERIT" : null,
    role.connectionLimit !== null ? `${t("max.")} ${role.connectionLimit} ${t("Verbindungen")}` : null,
    role.validUntil ? `${t("gültig bis")} ${formatDay(role.validUntil)}` : null,
  ].filter(Boolean).join(" · ");

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("ROLLEN")}</span><strong>{roles.length}</strong><small>{t("ohne pg_-Rollen")}</small></div>
      <div><span>{t("MIT ANMELDUNG")}</span><strong>{roles.filter((role) => role.login).length}</strong><small>{t("können sich verbinden")}</small></div>
      <div><span>{t("SUPERUSER")}</span><strong>{roles.filter((role) => role.superuser).length}</strong><small>{t("alle Rechte")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t("Rollen")}</h3></div><div><div className="toolbar-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Nach Name filtern…")}/></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div></div>
      {truncated && <p className="muted">{t("Die Liste ist bei 200 Rollen abgeschnitten.")}</p>}
      {shown.map((role) => <div className="bucket-row" key={role.name}><span className="bucket-icon"><UserCog size={16}/></span>
        <div><strong>{role.name}</strong><small>{traits(role)}</small></div>
        <span className={role.superuser ? "risk high" : role.bypassRowSecurity ? "risk medium" : "secure"}>{role.superuser ? t("Superuser") : role.bypassRowSecurity ? t("umgeht RLS") : t("eingeschränkt")}</span>
      </div>)}
      {roles.length > 0 && shown.length === 0 && <p className="muted">{t("Keine Rolle passt zum Filter.")}</p>}
    </article>
  </div>;
}
