"use client";

import {
  Activity, ArchiveRestore, Bell, Blocks, BookOpen, Bot, Braces, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleGauge, Cloud, Code2, Command, Database, Fingerprint, HardDrive, Copy,
  ListFilter, LogOut, Menu, Pencil, Play, Plus, RefreshCw, Search, Settings, ShieldCheck, Table2,
  Terminal, Trash2, Users, Webhook, X, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";
import { displayWorkspaceName } from "@/lib/console/workspace-name";
import { NAV, NAV_ENTRIES, PLACEHOLDERS, groupOf, isPlaceholder, type ViewId } from "@/components/console/navigation";
import { setConsoleLocale, t, tAll } from "@/components/console/console-i18n";
import {
  formatDecimal, formatMoment, formatNumber, formatPercent, setConsoleDisplaySettings,
} from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { SidebarFlyout } from "@/components/console/sidebar-flyout";
import { QueuesView } from "@/components/console/queues-view";
import { MigrationsView } from "@/components/console/migrations-view";
import { InvocationsView } from "@/components/console/invocations-view";
import { ComputeSecretsView } from "@/components/console/compute-secrets-view";
import { SecurityAdvisorView } from "@/components/console/security-advisor-view";
import { PerformanceAdvisorView } from "@/components/console/performance-advisor-view";
import { HealthAdvisorView } from "@/components/console/health-advisor-view";
import { RealtimeInspectorView } from "@/components/console/realtime-inspector-view";
import { RealtimeSettingsView } from "@/components/console/realtime-settings-view";
import { RealtimePoliciesView } from "@/components/console/realtime-policies-view";
import { TriggersView } from "@/components/console/triggers-view";
import { FunctionsView } from "@/components/console/functions-view";
import { IndexesView } from "@/components/console/indexes-view";
import { CronLogView } from "@/components/console/cron-log-view";
import { UsageSeriesView } from "@/components/console/usage-series-view";
import { DatabaseReportView } from "@/components/console/database-report-view";
import { ConnectionsReportView } from "@/components/console/connections-report-view";
import { QueryPerformanceView } from "@/components/console/query-performance-view";
import { SchemaVisualizerView } from "@/components/console/schema-visualizer-view";
import { TableDesignerView } from "@/components/console/table-designer-view";
import { PoliciesView } from "@/components/console/policies-view";
import { EnumTypesView } from "@/components/console/enum-types-view";
import { ExtensionsView } from "@/components/console/extensions-view";
import { RolesView } from "@/components/console/roles-view";
import { PublicationsView } from "@/components/console/publications-view";
import { ReplicationView } from "@/components/console/replication-view";
import { ColumnPrivilegesView } from "@/components/console/column-privileges-view";
import { DatabaseSettingsView } from "@/components/console/database-settings-view";
import { CronView } from "@/components/console/cron-view";
import { PitrView } from "@/components/console/pitr-view";
import { DatabaseWebhooksView } from "@/components/console/database-webhooks-view";
import { VaultOverviewView } from "@/components/console/vault-overview-view";
import { WrappersView } from "@/components/console/wrappers-view";
import { ApiKeysView } from "@/components/console/api-keys-view";
import { AuthProvidersView } from "@/components/console/auth-providers-view";
import { AuthSessionsView } from "@/components/console/auth-sessions-view";
import { AuthAuditView } from "@/components/console/auth-audit-view";
import { AuthMfaView } from "@/components/console/auth-mfa-view";
import { AuthPasskeysView } from "@/components/console/auth-passkeys-view";
import { AuthReturnTargetsView } from "@/components/console/auth-return-targets-view";
import { AuthRateLimitsView } from "@/components/console/auth-rate-limits-view";
import { AuthHooksView } from "@/components/console/auth-hooks-view";
import { AuthThirdPartyView } from "@/components/console/auth-third-party-view";
import { AuthOAuthServerView } from "@/components/console/auth-oauth-server-view";
import { AuthProtectionView } from "@/components/console/auth-protection-view";
import { AuthPoliciesView } from "@/components/console/auth-policies-view";
import { DashboardWebhooksView } from "@/components/console/dashboard-webhooks-view";
import { LogDrainsView } from "@/components/console/log-drains-view";
import { DashboardSettingsView } from "@/components/console/dashboard-settings-view";
import { LogExplorerView } from "@/components/console/log-explorer-view";
import { QueryInsightsView } from "@/components/console/query-insights-view";
import { AuthSmtpView } from "@/components/console/auth-smtp-view";
import { AuthTemplatesView } from "@/components/console/auth-templates-view";
import { AuthSeriesView } from "@/components/console/auth-series-view";
import { AuthPerformanceView } from "@/components/console/auth-performance-view";
import { AuthLogView } from "@/components/console/auth-log-view";
import { StorageLogView } from "@/components/console/storage-log-view";
import { FunctionLogView } from "@/components/console/function-log-view";
import { DataApiLogView } from "@/components/console/data-api-log-view";
import { JwtKeysView } from "@/components/console/jwt-keys-view";
import { StoragePoliciesView } from "@/components/console/storage-policies-view";
import { StorageSettingsView } from "@/components/console/storage-settings-view";
import { S3AccessView } from "@/components/console/s3-access-view";
import { DataApiSettingsView } from "@/components/console/data-api-settings-view";
import { InfrastructureView } from "@/components/console/infrastructure-view";
import { BranchFlowView } from "@/components/console/branch-flow-view";
import { DatabaseHealthView } from "@/components/console/database-health-view";
import type { Locale } from "@/lib/i18n/locales";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";
import {
  CONSOLE_DISPLAY_DEFAULTS, CONSOLE_DISPLAY_INHERIT, resolvedConsoleLanguage,
  type ConsoleDisplaySettings,
} from "@/lib/console/display-settings";
import { LanguageSwitcher } from "@/components/language-switcher";
import { InvoicesCard } from "@/components/console/invoices-card";
import { BillingSettingsView } from "@/components/console/billing-settings-view";
import { loadConsoleAuthProviders, type ConsoleAuthProviderResult } from "@/components/console/auth-providers";
import { ThemeToggle } from "@/components/theme-toggle";
import type {
  Approval,
  AuditEvent,
  AutomationMode,
  ChangeSet,
  Environment,
  Project,
  ProjectAutomationPolicy,
  Risk,
} from "@/lib/types";
import { classifySqlRisk, isReadOnlySql } from "@/lib/security";
// Die Vorlagen des SQL-Editors (2.61): reines Modul, kein Schreibweg.
import {
  SQL_TEMPLATES, SQL_TEMPLATE_DEFAULT_SCHEMA, SqlTemplateError, sqlTemplateStatement,
} from "@/lib/console/sql-templates";

type Snapshot = { user: { id: string; email: string }; organization: { id: string; name: string; slug: string }; projects: Project[]; changeSets: ChangeSet[]; approvals: Approval[]; audit: AuditEvent[] };

type LiveTableColumn = {
  name: string; dataType: string; nullable: boolean; sensitive: boolean;
  primaryKeyPosition: number | null; insertable: boolean; updateable: boolean; selectable: boolean;
};
type LiveTable = {
  schema: string; name: string; rowSecurityEnabled: boolean; primaryKey: string[]; columns: LiveTableColumn[];
};
type LiveRows = {
  table: LiveTable; rows: Array<Record<string, unknown>>; rowCount: number;
  hasMore: boolean; nextCursor: string | null;
};
type ProjectApiKeyItem = {
  id: string; name: string; kind: "public" | "service"; prefix: string;
  expiresAt: string; revokedAt: string | null; createdAt: string;
};
type ProjectStorageBucketItem = {
  id: string; projectId: string; environment: Environment; name: string;
  readPolicy: "private" | "authenticated" | "owner" | "public" | "service";
  writePolicy: "private" | "authenticated" | "owner" | "service";
  allowedMimeTypes: string[]; maxObjectBytes: number; quotaBytes: number;
  usedBytes: number; reservedBytes: number; retentionDays: number | null;
  createdAt: string; updatedAt: string;
};
type UsageProjection = {
  projectId: string; environment: Environment; period: string;
  windowStart: string; windowEnd: string;
  metrics: Array<{
    metric: string; label: string; unit: "operations" | "rows" | "bytes";
    used: string; limit: string | null; remaining: string | null;
    mode: "unlimited" | "observe" | "enforce";
    status: "unlimited" | "ok" | "warning" | "exhausted" | "exceeded";
    revision: number | null;
  }>;
};



export function ConsoleApp({ locale }: { locale: Locale }) {
  // Die eigene Darstellung (2.55). Bis die Antwort da ist, gelten die
  // Vorgaben, und die bilden das Verhalten vor 2.55 ab: Sprache aus dem
  // Cookie, Format de-CH, Zone der Laufzeit, Start auf der Uebersicht. Es
  // gibt darum kein Aufblitzen einer falschen Darstellung.
  const [display, setDisplay] = useState<ConsoleDisplaySettings>(CONSOLE_DISPLAY_DEFAULTS);
  setConsoleDisplaySettings(display);
  setConsoleLocale(resolvedConsoleLanguage(display, locale));
  const router = useRouter();
  const [view, setView] = useState<ViewId>("overview");
  // Die Startseite gilt genau einmal: beim ersten Laden. Wer danach
  // navigiert, soll nicht beim naechsten Neuladen der Einstellungen
  // zurueckgeworfen werden.
  const startApplied = useRef(false);
  const [collapsed, setCollapsedState] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed") setCollapsedState(true); } catch {} }, []);
  const setCollapsed = useCallback((next: boolean) => { setCollapsedState(next); try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "collapsed" : "expanded"); } catch {} }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Auf dem Telefon ist die Sidebar eine Schublade in voller Breite; dort
  // bleibt das Untermenü inline, das Flyout gilt nur eingeklappt auf Desktop.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => { const query = window.matchMedia("(max-width: 760px)"); const update = () => setIsPhone(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  const [environment, setEnvironment] = useState<Environment>("development");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const pendingApprovals = snapshot?.approvals.filter((item) => item.status === "pending").length ?? 0;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/console", { cache: "no-store" });
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok) throw new Error(t("Console-Daten nicht verfügbar"));
      setSnapshot(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  // Die Einstellungen der Person, durch dieselbe Tuer wie die Session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/v1/auth/console-settings", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled && payload?.data) setDisplay(payload.data as ConsoleDisplaySettings);
      } catch { /* Ohne Antwort bleiben die Vorgaben, und die sind das alte Verhalten. */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Startseite: nur beim ersten Mal.
  useEffect(() => {
    if (startApplied.current) return;
    startApplied.current = true;
    if (display.startView !== CONSOLE_DISPLAY_DEFAULTS.startView) setView(display.startView);
  }, [display.startView]);

  // Aussehen. `system` fasst nichts an; der Umschalter oben rechts und die
  // Vorliebe des Betriebssystems entscheiden dann wie vor 2.55.
  useEffect(() => {
    if (display.theme === "system") return;
    try {
      document.documentElement.dataset.theme = display.theme;
      window.localStorage.setItem("qkern-theme", display.theme);
    } catch {}
  }, [display.theme]);

  // Sprache. Die Console rendert serverseitig aus dem Locale-Cookie (2.2);
  // eine festgelegte Sprache schreibt das Cookie und laesst neu rendern,
  // statt eine zweite Quelle fuer dieselbe Frage aufzumachen.
  useEffect(() => {
    if (display.language === CONSOLE_DISPLAY_INHERIT || display.language === locale) return;
    try { document.cookie = `${LOCALE_COOKIE}=${display.language}; path=/; max-age=31536000; samesite=lax`; } catch {}
    document.documentElement.lang = display.language;
    router.refresh();
  }, [display.language, locale, router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const project = snapshot?.projects[0];
  // Offene Gruppen als Menge; die aktive Gruppe öffnet sich beim Wechsel,
  // jede Gruppe lässt sich per Klick auf den Kopf schliessen und öffnen.
  // Seit 2.8 gemerkt (localStorage, im Effekt gelesen wie die Sidebar-Breite).
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  useEffect(() => { try { const raw = window.localStorage.getItem(GROUPS_STORAGE_KEY); if (raw) setOpenGroups(new Set(JSON.parse(raw) as string[])); } catch {} }, []);
  const toggleGroup = useCallback((id: string, force?: boolean) => setOpenGroups((current) => { const next = new Set(current); const open = force ?? !next.has(id); if (open) next.add(id); else next.delete(id); try { window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify([...next])); } catch {} return next; }), []);
  const activeGroup = groupOf(view);
  useEffect(() => { if (activeGroup.children) toggleGroup(activeGroup.id, true); }, [activeGroup, toggleGroup]);

  function changeView(next: ViewId) { setView(next); setMobileOpen(false); }
  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="console-root">
      <aside className={`console-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="console-brand"><Link href="/console" aria-label={t("Zur Console-Übersicht")}>{collapsed ? <QKERNSymbol variant="white" size="sm" /> : <QKERNLogo variant="white" size="sm" />}</Link><button className="sidebar-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t("Sidebar ausklappen") : t("Sidebar einklappen")} title={collapsed ? t("Sidebar ausklappen") : t("Sidebar einklappen")}>{collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button><button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label={t("Navigation schließen")} title={t("Navigation schließen")}><X size={18}/></button></div>
        <div className="project-switch"><span className="project-glyph">{(project?.name ?? "QK").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "QK"}</span><div><strong>{project?.name ?? t("Projekt wird geladen")}</strong><small>{displayWorkspaceName(snapshot?.organization.name)}</small></div><ChevronDown size={14}/></div>
        <nav className="console-nav" aria-label={t("Console-Navigation")}>
          {NAV.map((group) => {
            const Icon = group.icon;
            const isActive = activeGroup.id === group.id;
            const isOpen = group.children ? openGroups.has(group.id) : false;
            const badge = group.id === "approvals" ? pendingApprovals : 0;
            if (collapsed && !isPhone && group.children) return <div className="nav-group" key={group.id}><SidebarFlyout group={{ ...group, children: group.children }} view={view} badge={badge} onNavigate={changeView}/></div>;
            return <div className={`nav-group${isOpen ? " is-open" : ""}`} key={group.id}>
              <button className={`${isActive ? "active" : ""}${group.children ? " has-children" : ""}`} onClick={() => { if (!group.children) { changeView(group.id); return; } if (isActive) toggleGroup(group.id); else { toggleGroup(group.id, true); changeView(group.children[0].id); } }} title={t(group.label)} aria-expanded={group.children ? isOpen : undefined}>
                <Icon size={17}/><span>{t(group.label)}</span>{badge > 0 && <small>{badge}</small>}{group.children && <ChevronDown size={14} className="nav-caret" aria-hidden="true"/>}
              </button>
              {group.children && <div className="nav-children" role="group" aria-label={t(group.label)}>
                {group.children.map((child) => <button key={child.id} className={`${view === child.id ? "active" : ""} ${isPlaceholder(child.id) ? "is-placeholder-entry" : "is-real-entry"}`} onClick={() => changeView(child.id)} title={isPlaceholder(child.id) ? `${t(child.label)} · ${t("noch nicht verbunden")}` : t(child.label)}><i className="nav-dot" aria-hidden="true"/><span>{t(child.label)}</span></button>)}
              </div>}
            </div>;
          })}
        </nav>
        <div className="sidebar-bottom"><Link href="/docs"><Code2 size={16}/><span>{t("Dokumentation")}</span></Link><button disabled className="is-placeholder" title={t("Teamverwaltung ist noch nicht verbunden")}><Users size={16}/><span>{t("Team")}</span></button><AccountMenu email={snapshot?.user.email ?? null} workspace={snapshot?.organization.name ?? null} collapsed={collapsed} onLogout={logout}/></div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" aria-label={t("Navigation schließen")} onClick={() => setMobileOpen(false)} />}

      <div className="console-workspace">
        <header className="console-topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label={t("Navigation öffnen")}><Menu size={19}/></button>
          <div className="console-crumb"><span className="crumb-workspace" title={snapshot?.organization.name ?? undefined}><Blocks size={14} aria-hidden="true"/>{displayWorkspaceName(snapshot?.organization.name)}<small>{t("Workspace")}</small></span><b>/</b><strong>{project?.name ?? "Projekt"}</strong></div>
          <div className="console-tools">
            <EnvironmentMenu value={environment} onChange={setEnvironment}/>
            <LanguageSwitcher locale={locale} label={t("Sprache wählen")}/>
            <button className="command-button" onClick={() => setCommandOpen(true)}><Search size={15}/><span>{t("Suchen")}</span><kbd>⌘ K</kbd></button>
            {snapshot && !error && <span className="system-online"><i/> {t("Verbunden")}</span>}
            <ThemeToggle/><button className="icon-button is-placeholder" aria-label={t("Benachrichtigungen")} disabled title={t("Benachrichtigungen sind noch nicht verbunden")}><Bell size={16}/></button>
          </div>
        </header>

        <main className="console-page">
          <div className="console-titlebar"><div><span className="console-kicker">{project?.name ?? "Projekt"} · {environment.charAt(0).toUpperCase() + environment.slice(1)}</span><h1>{viewTitle(view)}</h1></div>{environment === "production" && <span className="production-guard"><ShieldCheck size={15}/> {t("Production-Schutz aktiv")}</span>}</div>
          {loading && <LoadingState/>}
          {error && <ErrorState message={error} retry={load}/>} 
          {!loading && !error && snapshot && project && (
            <ViewRouter view={view} snapshot={snapshot} project={project} environment={environment} reload={load} navigate={changeView} display={display} onDisplayChange={setDisplay}/>
          )}
        </main>
      </div>
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={changeView}/>} 
    </div>
  );
}

function ViewRouter(props: { view: ViewId; snapshot: Snapshot; project: Project; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void; display: ConsoleDisplaySettings; onDisplayChange: (settings: ConsoleDisplaySettings) => void }) {
  switch (props.view) {
    case "overview": return <ProductPreview service="Der Metrik-Dienst"><Overview snapshot={props.snapshot} project={props.project} navigate={props.navigate}/></ProductPreview>;
    case "database": return <DatabaseView project={props.project} navigate={props.navigate}/>;
    case "table": return <TableView projectId={props.project.id} environment={props.environment}/>;
    // Die Vorlagen (2.61) leben in der Editoransicht selbst: Einfuegen heisst,
    // das Editorfeld zu fuellen, und das geht nur dort, wo dieses Feld steht.
    // Der Menuepunkt oeffnet dieselbe Ansicht mit aufgeklappter Liste.
    case "sql": case "sql-templates":
      return <SqlView projectId={props.project.id} environment={props.environment} reload={props.reload} navigate={props.navigate} templatesOpen={props.view === "sql-templates"}/>;
    case "auth": return <AuthView projectId={props.project.id} environment={props.environment}/>;
    case "storage": return <StorageView projectId={props.project.id} environment={props.environment}/>;
    case "compute": return <ComputeView projectId={props.project.id} environment={props.environment}/>;
    case "api": return <LiveApiView projectId={props.project.id} environment={props.environment}/>;
    case "ai": return <ProductPreview service="Der Verbindungsdienst für Agenten"><AIBridge projectId={props.project.id} environment={props.environment} reload={props.reload} navigate={props.navigate}/></ProductPreview>;
    case "activity": case "logs": return <ActivityView audit={props.snapshot.audit} aiOnly={props.view === "activity"}/>;
    case "approvals": return <ApprovalView projectId={props.project.id} environment={props.environment} approvals={props.snapshot.approvals} changes={props.snapshot.changeSets} reload={props.reload}/>;
    case "monitoring": return <UsageView projectId={props.project.id} environment={props.environment}/>;
    case "backups": return <BackupsView/>;
    case "db-backups-pitr": return <PitrView projectId={props.project.id} environment={props.environment}/>;
    case "settings": return <SettingsView project={{ name: props.project.name, id: props.project.id }} organizationId={props.snapshot.organization.id}/>;
    case "int-queues": return <QueuesView projectId={props.project.id} environment={props.environment}/>;
    case "db-migrations": return <MigrationsView projectId={props.project.id} environment={props.environment} changeSets={props.snapshot.changeSets}/>;
    case "compute-invocations": return <InvocationsView projectId={props.project.id} environment={props.environment}/>;
    case "compute-secrets": return <ComputeSecretsView projectId={props.project.id} environment={props.environment}/>;
    case "realtime-inspector": return <RealtimeInspectorView projectId={props.project.id} environment={props.environment}/>;
    case "db-triggers": return <TriggersView projectId={props.project.id} environment={props.environment}/>;
    case "db-functions": return <FunctionsView projectId={props.project.id} environment={props.environment}/>;
    case "db-indexes": return <IndexesView projectId={props.project.id} environment={props.environment}/>;
    case "db-policies": return <PoliciesView projectId={props.project.id} environment={props.environment}/>;
    case "db-types": return <EnumTypesView projectId={props.project.id} environment={props.environment}/>;
    case "db-extensions": return <ExtensionsView projectId={props.project.id} environment={props.environment}/>;
    case "db-roles": return <RolesView projectId={props.project.id} environment={props.environment}/>;
    case "db-publications": return <PublicationsView projectId={props.project.id} environment={props.environment}/>;
    // Datenbank -> Replikation liest die Publikationen, die Abonnements und
    // die Slots mit ihrem Rueckstand; einrichten kann die Seite nichts (2.74).
    case "db-pipelines": return <ReplicationView projectId={props.project.id} environment={props.environment}/>;
    case "db-column-privileges": return <ColumnPrivilegesView projectId={props.project.id} environment={props.environment}/>;
    case "db-schemas": return <SchemaVisualizerView projectId={props.project.id} environment={props.environment}/>;
    case "db-settings": return <DatabaseSettingsView projectId={props.project.id} environment={props.environment}/>;
    case "db-tables": return <TableDesignerView projectId={props.project.id} environment={props.environment} navigate={props.navigate} reload={props.reload}/>;
    case "int-cron": return <CronView projectId={props.project.id} environment={props.environment}/>;
    case "set-api-keys": return <ApiKeysView projectId={props.project.id} environment={props.environment}/>;
    case "auth-providers": return <AuthProvidersView projectId={props.project.id} environment={props.environment}/>;
    case "auth-sessions": return <AuthSessionsView projectId={props.project.id} environment={props.environment}/>;
    case "auth-audit": return <AuthAuditView projectId={props.project.id} environment={props.environment}/>;
    case "auth-performance": return <AuthPerformanceView projectId={props.project.id} environment={props.environment}/>;
    case "auth-mfa": return <AuthMfaView projectId={props.project.id} environment={props.environment}/>;
    case "auth-passkeys": return <AuthPasskeysView projectId={props.project.id} environment={props.environment}/>;
    case "auth-url": return <AuthReturnTargetsView projectId={props.project.id} environment={props.environment}/>;
    case "auth-rate-limits": return <AuthRateLimitsView projectId={props.project.id} environment={props.environment}/>;
    case "auth-protection": return <AuthProtectionView projectId={props.project.id} environment={props.environment}/>;
    case "auth-hooks": return <AuthHooksView projectId={props.project.id} environment={props.environment}/>;
    case "auth-third-party": return <AuthThirdPartyView projectId={props.project.id} environment={props.environment}/>;
    case "auth-oauth-server": return <AuthOAuthServerView projectId={props.project.id} environment={props.environment}/>;
    case "auth-policies": return <AuthPoliciesView projectId={props.project.id} environment={props.environment}/>;
    case "set-log-drains": return <LogDrainsView projectId={props.project.id} environment={props.environment}/>;
    case "set-webhooks": return <DashboardWebhooksView projectId={props.project.id} environment={props.environment}/>;
    case "logs-explorer": return <LogExplorerView projectId={props.project.id} environment={props.environment}/>;
    case "obs-query-insights": return <QueryInsightsView projectId={props.project.id} environment={props.environment}/>;
    case "auth-smtp": return <AuthSmtpView projectId={props.project.id} environment={props.environment}/>;
    case "auth-templates": return <AuthTemplatesView projectId={props.project.id} environment={props.environment}/>;
    case "set-jwt": return <JwtKeysView projectId={props.project.id} environment={props.environment}/>;
    case "storage-policies": return <StoragePoliciesView projectId={props.project.id} environment={props.environment}/>;
    case "storage-settings": return <StorageSettingsView projectId={props.project.id} environment={props.environment}/>;
    case "storage-s3": return <S3AccessView projectId={props.project.id} environment={props.environment}/>;
    case "set-api": return <DataApiSettingsView projectId={props.project.id} environment={props.environment}/>;
    case "set-infrastructure": return <InfrastructureView projectId={props.project.id} environment={props.environment} region={props.project.region} status={props.project.status}/>;
    // Branches ersetzt zwei Platzhalter mit einer Seite: Die Umgebungen sind
    // fest, und der Pruefschritt ist gebaut, nur anders (2.81).
    case "branches": return <BranchFlowView projectId={props.project.id} environment={props.environment}/>;
    case "logs-postgres": return <DatabaseHealthView projectId={props.project.id} environment={props.environment}/>;
    case "set-billing": return <BillingSettingsView projectId={props.project.id} environment={props.environment} navigate={props.navigate}/>;
    case "advisors-security": return <SecurityAdvisorView projectId={props.project.id} environment={props.environment}/>;
    case "advisors-performance": return <PerformanceAdvisorView projectId={props.project.id} environment={props.environment}/>;
    case "advisors-health": return <HealthAdvisorView projectId={props.project.id} environment={props.environment}/>;
    case "logs-cron": return <CronLogView projectId={props.project.id} environment={props.environment}/>;
    // Logs -> Functions zeigt das Aufrufprotokoll aus 0045; Logs -> Data API
    // sagt, dass es fuer die Data API kein Anfrageprotokoll gibt (2.51).
    case "logs-functions": return <FunctionLogView projectId={props.project.id} environment={props.environment}/>;
    case "logs-postgrest": return <DataApiLogView projectId={props.project.id} environment={props.environment}/>;
    // Drei Seiten, eine Ansicht: Berichte -> API, Storage und Functions zeigen
    // dieselbe Zeitreihe ueber verschiedene Metriken (2.45).
    case "obs-api": return <UsageSeriesView key="obs-api" view="api" projectId={props.project.id} environment={props.environment}/>;
    case "obs-storage": return <UsageSeriesView key="obs-storage" view="storage" projectId={props.project.id} environment={props.environment}/>;
    case "obs-functions": return <UsageSeriesView key="obs-functions" view="functions" projectId={props.project.id} environment={props.environment}/>;
    // Zwei Seiten, eine Quelle: Berichte -> Datenbank zeigt die Betriebszahlen,
    // Berichte -> Verbindungen die Gruppen je Rolle und Zustand (2.46).
    case "obs-database": return <DatabaseReportView projectId={props.project.id} environment={props.environment}/>;
    case "obs-connections": return <ConnectionsReportView projectId={props.project.id} environment={props.environment}/>;
    // Berichte -> Abfrage-Leistung liest pg_stat_statements ueber dieselbe
    // Methode wie der Leistungsberater, und sie traegt keinen Abfragetext (2.67).
    case "obs-query-performance": return <QueryPerformanceView projectId={props.project.id} environment={props.environment}/>;
    // Realtime -> Einstellungen liest die wirksamen Grenzen; Realtime -> Rechte
    // zeigt die feste Praefixregel aus dem Code und braucht darum keine Route (2.48).
    case "realtime-settings": return <RealtimeSettingsView projectId={props.project.id} environment={props.environment}/>;
    case "realtime-policies": return <RealtimePoliciesView/>;
    // Eine Quelle, zwei Fragen: Berichte -> Auth zeigt das Auth-Audit als
    // Reihe, Logs -> Auth dieselben Eintraege als Protokoll (2.47).
    case "obs-auth": return <AuthSeriesView projectId={props.project.id} environment={props.environment}/>;
    case "logs-auth": return <AuthLogView projectId={props.project.id} environment={props.environment}/>;
    case "logs-storage": return <StorageLogView projectId={props.project.id} environment={props.environment}/>;
    case "obs-realtime": return <UsageSeriesView key="obs-realtime" view="realtime" projectId={props.project.id} environment={props.environment}/>;
    case "int-database-webhooks": return <DatabaseWebhooksView projectId={props.project.id} environment={props.environment}/>;
    // Integrationen -> Vault zeigt jede bekannte Secret-Referenz und ihren
    // Stand, aber keinen Wert und kein Eingabefeld (2.58).
    case "int-vault": return <VaultOverviewView projectId={props.project.id} environment={props.environment}/>;
    // Integrationen -> Wrappers liest die fremden Datenquellen dieser
    // Datenbank, ohne die Zugangsdaten dahinter (2.72).
    case "int-wrappers": return <WrappersView projectId={props.project.id} environment={props.environment}/>;
    // Einstellungen -> Dashboard (2.55): die Darstellung der Console selbst.
    case "set-dashboard": return <DashboardSettingsView settings={props.display} onSaved={props.onDisplayChange}/>;
    default: return <PlaceholderView view={props.view} navigate={props.navigate}/>;
  }
}

/**
 * Ein Menüpunkt, den Supabase Studio hat und QKERN noch nicht: sagt, wie er
 * dort heisst, was das Backend schon kann, und zeigt die Nachbarn der Gruppe.
 */
function viewTitle(view: ViewId): string {
  const group = groupOf(view);
  const child = group.children?.find((entry) => entry.id === view);
  return child && child.label !== group.label ? `${t(group.label)} · ${t(child.label)}` : t(group.label);
}

function PlaceholderView({ view, navigate }: { view: ViewId; navigate: (view: ViewId) => void }) {
  if (!isPlaceholder(view)) return null;
  const entry = PLACEHOLDERS[view];
  const group = groupOf(view);
  const backendLabel = { vorhanden: t("Backend vorhanden"), teilweise: t("Backend teilweise"), fehlt: t("Backend fehlt") }[entry.backend];
  return <div className="placeholder-view">
    <article className="console-card placeholder-state"><Blocks size={26}/><div><span className="console-kicker">{t(group.label)} · {t("Platzhalter")}</span><h2>{t(entry.label)}: {t("noch nicht verbunden")}</h2><p>{t(entry.note)}</p><div className="placeholder-meta"><span>Bei Supabase: {entry.supabase}</span><span className={`backend-${entry.backend}`}>{backendLabel}</span></div></div></article>
    {group.children && group.children.length > 1 && <article className="console-card"><div className="card-head"><div><span>{t(group.label).toUpperCase()}</span><h3>{t("Weitere Seiten dieser Gruppe")}</h3></div></div><div className="placeholder-siblings">{group.children.map((child) => <button key={child.id} type="button" className={child.id === view ? "active" : ""} onClick={() => navigate(child.id)}><i style={{ background: isPlaceholder(child.id) ? "var(--qkern-text-muted)" : "var(--qkern-success)" }}/>{t(child.label)}</button>)}</div></article>}
  </div>;
}

function ProductPreview({ service, children }: { service: string; children: React.ReactNode }) {
  return <><div className="product-preview-notice"><Blocks size={16}/><div><strong>{t("Vorschau")}</strong><span>{service} ist noch nicht verbunden. Diese Ansicht zeigt, was der Projektdatensatz hergibt.</span></div></div>{children}</>;
}

function Overview({ snapshot, project, navigate }: { snapshot: Snapshot; project: Project; navigate: (view: ViewId) => void }) {
  const metrics = [
    ["API-ANFRAGEN", formatNumber(project.apiRequests), Braces],
    [t("AKTIVE NUTZER"), formatNumber(project.activeUsers), Users],
    ["DATENBANK", `${project.databaseSizeMb} MB`, Database],
    ["STORAGE", `${formatDecimal(project.storageSizeMb / 1024, 2)} GB`, HardDrive],
  ] as const;
  return <>
    <div className="metric-grid">{metrics.map(([label, value, Icon]) => <article className="console-card metric-tile" key={label}><div><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{t("Aus dem Projektdatensatz")}</small></article>)}</div>
    <div className="dashboard-grid">
      <article className="console-card chart-card placeholder-state"><CircleGauge size={26}/><div><span className="console-kicker">{t("API-Verlauf")}</span><h3>{t("Noch nicht verbunden")}</h3><p>{t("Der Metrik-Dienst liefert noch keine Zeitreihe. Bis dahin zeigt diese Karte keinen erfundenen Verlauf.")}</p></div></article>
      <article className="console-card health-card placeholder-state"><Activity size={26}/><div><span className="console-kicker">{t("Dienststatus")}</span><h3>{t("Noch nicht verbunden")}</h3><p>{t("Latenzen je Dienst kommen mit dem Metrik-Dienst. Dass die Console antwortet, siehst du oben rechts.")}</p></div></article>
    </div>
    <div className="dashboard-grid lower">
      <article className="console-card"><div className="card-head"><div><span>{t("LETZTE AKTIVITÄT")}</span><h3>{t("Agentenaktionen")}</h3></div><button className="plain-button" onClick={() => navigate("activity")}>{t("Alle anzeigen")}</button></div>{snapshot.audit.slice(0,3).map((event) => <div className="event-row" key={event.id}><span className="event-icon"><Bot size={14}/></span><div><strong>{event.action}</strong><small>{event.actor} · {event.resource}</small></div><time>{formatTime(event.createdAt)}</time></div>)}</article>
      <article className="console-card"><div className="card-head"><div><span>{t("FREIGABEN")}</span><h3>{snapshot.approvals.filter((item) => item.status === "pending").length} offen</h3></div><button className="plain-button" onClick={() => navigate("approvals")}>{t("Prüfen")}</button></div>{snapshot.approvals.slice(0,2).map((approval) => <div className="approval-mini" key={approval.id}><span className={`risk ${approval.risk}`}>{approval.risk}</span><div><strong>{approval.action}</strong><small>{approval.requestedBy} · {approval.environment}</small></div><ChevronRight size={15}/></div>)}</article>
    </div>
  </>;
}

function DatabaseView({ project, navigate }: { project: Project; navigate: (view: ViewId) => void }) {
  return <div className="module-grid"><article className="console-card span-2 placeholder-state"><Database size={26}/><div><span className="console-kicker">Datenbank · {project.name}</span><h2>{t("Provisionierung noch nicht verbunden")}</h2><p>{t("Verbindungsdaten, Pool-Auslastung und Latenzen kommen mit der Provisionierung. Tabellen und Zeilen deiner Datenbank siehst du jetzt schon im Table Editor, live und mit RLS.")}</p></div><button className="button small" onClick={() => navigate("table")}><Table2 size={14}/> {t("Zum Table Editor")}</button></article></div>;
}

const SIDEBAR_STORAGE_KEY = "qkern.console.sidebar";
const GROUPS_STORAGE_KEY = "qkern.console.groups";
const ENVIRONMENTS: Array<{ id: Environment; label: string; hint: string }> = [
  { id: "development", label: "Development", hint: t("Frei bearbeiten") },
  { id: "staging", label: "Staging", hint: t("Vor dem Release prüfen") },
  { id: "production", label: "Production", hint: t("Schreibzugriffe brauchen Freigabe") },
];

function AccountMenu({ email, workspace, collapsed, onLogout }: { email: string | null; workspace: string | null; collapsed: boolean; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointer); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const initials = email ? email.slice(0, 2).toUpperCase() : "QK";
  const handle = email ? email.split("@")[0] : "Account";
  return <div className="account-menu" ref={root}>
    <button type="button" className="user-chip" aria-haspopup="menu" aria-expanded={open} aria-label={t("Kontomenü")} title={collapsed ? handle : undefined} onClick={() => setOpen(!open)}>
      <span>{initials}</span><div><strong>{handle}</strong><small>Owner</small></div><ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && <div className="account-sheet" role="menu">
      <div className="account-identity"><strong>{email ?? t("Nicht angemeldet")}</strong><small>{displayWorkspaceName(workspace)} · Owner</small></div>
      <button type="button" role="menuitem" disabled className="is-placeholder" title={t("Kontoeinstellungen sind noch nicht verbunden")}><Settings size={15}/><span>{t("Kontoeinstellungen")}</span><em>{t("Bald")}</em></button>
      <button type="button" role="menuitem" disabled className="is-placeholder" title={t("Workspace-Einstellungen sind noch nicht verbunden")}><Blocks size={15}/><span>{t("Workspace-Einstellungen")}</span><em>{t("Bald")}</em></button>
      <button type="button" role="menuitem" onClick={onLogout}><LogOut size={15}/><span>{t("Abmelden")}</span></button>
    </div>}
  </div>;
}

function EnvironmentMenu({ value, onChange }: { value: Environment; onChange: (next: Environment) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointer); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = ENVIRONMENTS.find((entry) => entry.id === value) ?? ENVIRONMENTS[0];
  return <div className={`environment-menu ${value}`} ref={root}>
    <button type="button" className={`environment-field ${value}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`Umgebung: ${current.label}`} onClick={() => setOpen(!open)}>
      <i aria-hidden="true"/><StableLabel current={current.label} variants={ENVIRONMENTS.map((entry) => entry.label)}/><ChevronDown size={14} aria-hidden="true" className={open ? "is-open" : ""}/>
    </button>
    {open && <ul className="environment-list" role="listbox" aria-label={t("Umgebung auswählen")}>
      {ENVIRONMENTS.map((entry) => <li key={entry.id} role="option" aria-selected={entry.id === value} className={entry.id}>
        <button type="button" onClick={() => { onChange(entry.id); setOpen(false); }}>
          <i aria-hidden="true"/><span><strong>{entry.label}</strong><small>{entry.hint}</small></span>{entry.id === value && <Check size={14} aria-hidden="true"/>}
        </button>
      </li>)}
    </ul>}
  </div>;
}


function TableView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [tables,setTables]=useState<string[]>([]);
  const [selected,setSelected]=useState("");
  const [data,setData]=useState<LiveRows|null>(null);
  const [query,setQuery]=useState("");
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const [insertOpen,setInsertOpen]=useState(false);
  const [insertDraft,setInsertDraft]=useState("{\n  \"id\": \"\"\n}");

  const loadRows=useCallback(async(table:string)=>{
    if(!table)return;
    setState("loading");setMessage("");
    try{
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${table}/rows?schema=public&limit=50`,{cache:"no-store"});
      const payload=await response.json();
      if(response.status===503||response.status===409){setData(null);setState("unavailable");setMessage(payload.error??t("Die Generated Data API ist für diese Umgebung nicht aktiviert."));return;}
      if(!response.ok)throw new Error(payload.error??t("Zeilen nicht verfügbar"));
      setData(payload.data as LiveRows);setState("ready");
    }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Zeilen nicht verfügbar"));}
  },[projectId,environment]);

  useEffect(()=>{let active=true;setState("loading");setData(null);void fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema?schema=public`,{cache:"no-store"}).then(async response=>({response,payload:await response.json()})).then(({response,payload})=>{if(!active)return;if(!response.ok){setTables([]);setSelected("");setState(response.status===503||response.status===409?"unavailable":"error");setMessage(payload.error??t("Schema nicht verfügbar"));return;}const names=(payload.data.tables as Array<{name:string;kind:string;rowSecurityEnabled:boolean}>).filter(table=>(table.kind==="table"||table.kind==="partitioned_table")&&table.rowSecurityEnabled).map(table=>table.name);setTables(names);const first=names[0]??"";setSelected(first);if(first)void loadRows(first);else{setState("unavailable");setMessage(t("Im Schema public gibt es keine Tabelle mit RLS."));}}).catch(()=>{if(active){setState("error");setMessage(t("Schema nicht verfügbar"));}});return()=>{active=false;};},[projectId,environment,loadRows]);

  async function insert(){try{const row=JSON.parse(insertDraft) as unknown;if(!row||typeof row!=="object"||Array.isArray(row))throw new Error();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",rows:[row]})});if(!response.ok)throw new Error((await response.json()).error??t("Einfügen fehlgeschlagen"));setInsertOpen(false);await loadRows(selected);}catch{setMessage(t("Einfügen erwartet ein JSON-Objekt mit erlaubten Spalten."));setState("error");}}
  async function remove(row:Record<string,unknown>){if(!data?.table.primaryKey.length||!window.confirm(t("Diese Zeile löschen?")))return;const match=Object.fromEntries(data.table.primaryKey.map(key=>[key,row[key]]));const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match})});if(response.ok)await loadRows(selected);else{setState("error");setMessage((await response.json()).error??t("Löschen fehlgeschlagen"));}}
  async function edit(row:Record<string,unknown>){if(!data?.table.primaryKey.length)return;const raw=window.prompt(t("Geänderte Werte als JSON (Primärschlüssel bleiben)"),"{}");if(!raw)return;try{const values=JSON.parse(raw) as unknown;if(!values||typeof values!=="object"||Array.isArray(values))throw new Error();const match=Object.fromEntries(data.table.primaryKey.map(key=>[key,row[key]]));const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match,values})});if(!response.ok)throw new Error((await response.json()).error??t("Ändern fehlgeschlagen"));await loadRows(selected);}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Ändern erwartet ein JSON-Objekt."));}}

  const columns=data?.table.columns.filter(column=>column.selectable&&!column.sensitive).map(column=>column.name)??[];
  const rows=(data?.rows??[]).filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return <div className="console-card table-editor live-table-editor"><div className="table-toolbar"><label className="table-select"><Table2 size={15}/><select value={selected} onChange={event=>{setSelected(event.target.value);void loadRows(event.target.value);}} aria-label={t("Tabelle")}>{tables.map(table=><option key={table} value={table}>public.{table}</option>)}</select><ChevronDown size={14}/></label><div className="toolbar-search"><Search size={14}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("Geladene Zeilen durchsuchen…")}/></div><button className="secondary-button" onClick={()=>void loadRows(selected)} disabled={!selected}><RefreshCw size={14}/> {t("Neu laden")}</button><button className="button small" onClick={()=>setInsertOpen(!insertOpen)} disabled={!selected||state!=="ready"}><Plus size={14}/> {t("Zeile einfügen")}</button></div>{insertOpen&&<div className="inline-row-editor"><textarea value={insertDraft} onChange={event=>setInsertDraft(event.target.value)} aria-label={t("Neue Zeile als JSON")}/><div><button className="ghost-button" onClick={()=>setInsertOpen(false)}>{t("Abbrechen")}</button><button className="button small" onClick={()=>void insert()}>{t("Mit RLS einfügen")}</button></div></div>}{state==="loading"&&<div className="live-module-state"><RefreshCw size={24}/><h3>{t("Schema und Zeilen werden geladen…")}</h3></div>}{(state==="unavailable"||state==="error")&&<div className="live-module-state"><Database size={26}/><h3>{state==="unavailable"?t("Generated Data API nicht bereit"):t("Zeilen konnten nicht geladen werden")}</h3><p>{message}</p></div>}{state==="ready"&&<div className="records-grid live-records"><table><thead><tr>{columns.map(column=><th key={column}>{column}</th>)}<th>{t("Aktionen")}</th></tr></thead><tbody>{rows.map((row,index)=><tr key={data?.table.primaryKey.map(key=>String(row[key])).join(":")||index}>{columns.map(column=><td key={column}><code>{formatCell(row[column])}</code></td>)}<td className="row-actions"><button onClick={()=>void edit(row)} aria-label={t("Zeile bearbeiten")}><Pencil size={13}/></button><button onClick={()=>void remove(row)} aria-label={t("Zeile löschen")}><Trash2 size={13}/></button></td></tr>)}{rows.length===0&&<tr><td colSpan={columns.length+1}>{t("Keine Zeilen, die RLS dir zeigt.")}</td></tr>}</tbody></table></div>}<div className="table-footer"><span>{rows.length} Zeilen geladen{data?.hasMore?t(" · weitere per Cursor"):""}</span><span className="secure"><ShieldCheck size={12}/> {t("Live-Schema · RLS gilt · sensible Spalten ausgeblendet")}</span></div></div>;
}

function SqlView({ projectId, environment, reload, navigate, templatesOpen }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void; templatesOpen: boolean }) {
  const [sql, setSql] = useState("SELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name\nLIMIT 20");
  const [result, setResult] = useState<"idle"|"rows"|"approval"|"error">("idle");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const risk = useMemo(() => classifySqlRisk(sql, environment), [sql, environment]);
  const readOnly = isReadOnlySql(sql.replace(/\n/g, " "));
  // Die Vorlagen (2.61): eine feste Liste aus `lib/console/sql-templates.ts`.
  // Diese Ansicht setzt keinen Namen selbst in SQL zusammen; sie gibt Schema
  // und Tabelle an das Modul und schreibt zurueck, was es erzeugt. Lehnt das
  // Modul ab, steht hier der Grund und im Editorfeld bleibt alles, wie es war.
  const [showTemplates, setShowTemplates] = useState(templatesOpen);
  const [templateSchema, setTemplateSchema] = useState(SQL_TEMPLATE_DEFAULT_SCHEMA);
  const [templateTable, setTemplateTable] = useState("");
  const [templateReason, setTemplateReason] = useState("");
  const [insertedTemplate, setInsertedTemplate] = useState("");
  function insertTemplate(id: string, needsTarget: boolean) {
    try {
      const statement = sqlTemplateStatement(id, needsTarget
        ? { schema: templateSchema, table: templateTable }
        : {});
      // Nur einfuegen. Kein fetch, kein run(): den Knopf drueckt der Mensch.
      setSql(statement);
      setResult("idle");
      setRows([]);
      setColumns([]);
      setTruncated(false);
      setMessage("");
      setTemplateReason("");
      setInsertedTemplate(id);
    } catch (cause) {
      setInsertedTemplate("");
      setTemplateReason(cause instanceof SqlTemplateError
        ? t(cause.reason)
        : t("Diese Vorlage ließ sich nicht einfügen."));
    }
  }
  // Bis Release 1.75 zeigte diese Ansicht vorbereitete Beispielzeilen und rief
  // die Query-Route nie — die Flaeche sah vorhanden aus, ohne es zu sein.
  // Jetzt laeuft ein Read-only-Statement wirklich: durch den Parser-Waechter,
  // in einer READ-ONLY-Transaktion, mit Zeilenlimit und Redaktion.
  async function run() {
    setRunning(true);
    setMessage("");
    try {
      if (readOnly) {
        const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/query`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statement: sql, limit: 50 }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setResult("error");
          setMessage(payload.code ? `${payload.error} (${payload.code})` : payload.error ?? t("Abfrage fehlgeschlagen"));
          return;
        }
        setColumns(payload.data.columns as string[]);
        setRows(payload.data.rows as Array<Record<string, unknown>>);
        setTruncated(Boolean(payload.data.truncated));
        setResult("rows");
        return;
      }
      const response = await fetch("/api/v1/changesets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, environment, title: t("SQL-Änderung aus der Console"), statement: sql }),
      });
      if (!response.ok) { setResult("error"); setMessage(t("Das Change Set konnte nicht erstellt werden.")); return; }
      setResult("approval");
      await reload();
    } finally {
      setRunning(false);
    }
  }
  return <div className="sql-layout"><article className="console-card sql-editor"><div className="editor-tabs"><span className="active">{t("Abfrage 1")} <X size={12}/></span><button><Plus size={13}/></button><div className={`risk ${risk}`}>Risiko {risk}</div></div><div className="editor-body"><div className="line-numbers">1<br/>2<br/>3<br/>4<br/>5</div><textarea value={sql} onChange={(event)=>setSql(event.target.value)} aria-label={t("SQL-Abfrage")} spellCheck={false}/></div><div className="editor-footer"><span>{t("Lesende SQL läuft gegen die Projektdatenbank, begrenzt und redigiert. Aus schreibender SQL wird ein Change Set zur Freigabe.")}</span><button className="button small" onClick={()=>void run()} disabled={running}><Play size={13}/> <StableLabel current={running ? t("Läuft…") : readOnly ? t("Abfrage ausführen") : t("Vorschau erstellen")} variants={tAll("Läuft…", "Abfrage ausführen", "Vorschau erstellen")}/></button></div></article><article className="console-card result-panel"><div className="card-head"><div><span>{t("ERGEBNIS")}</span><h3>{result === "rows" ? `${rows.length} Zeilen${truncated ? t(" · gekürzt") : ""}` : result === "approval" ? t("Change Set erstellt") : result === "error" ? t("Abfrage fehlgeschlagen") : "Bereit"}</h3></div></div>{result === "idle" && <EmptyState icon={Terminal} title={t("Abfrage ausführen")} text="SELECT läuft lesend gegen die Projektdatenbank."/>}{result === "rows" && rows.length === 0 && <EmptyState icon={Terminal} title={t("Keine Zeilen")} text="Die Abfrage lief und lieferte nichts zurück."/>}{result === "rows" && rows.length > 0 && <div className="query-result">{rows.slice(0, 50).map((row, index) => <code key={index}>{columns.map((column) => String(row[column] ?? "∅")).join(" · ")}</code>)}</div>}{result === "approval" && <div className="success-state"><ShieldCheck size={34}/><h3>{t("Vorschau bereit")}</h3><p>{t("Nichts wurde angewendet. Diff und Risiko stehen in der Freigabezentrale.")}</p><button className="button small" onClick={()=>navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}{result === "error" && <EmptyState icon={X} title={t("Nicht ausgeführt")} text={message || t("Prüfe das Statement und versuch es noch einmal.")}/>}</article><article className="console-card sql-template-card"><div className="card-head"><div><span>{t("VORLAGEN")}</span><h3>{t("Fertige Abfragen zum Einfügen")}</h3></div><button className="secondary-button" type="button" onClick={()=>setShowTemplates(!showTemplates)}><BookOpen size={14}/> <StableLabel current={showTemplates ? t("Liste verbergen") : t("Liste zeigen")} variants={tAll("Liste verbergen", "Liste zeigen")}/></button></div><p className="sql-template-note">{t("Eine Vorlage ist ein Anfang, keine Antwort. Sie landet im Editorfeld, und nichts läuft: QKERN führt von sich aus keine Abfrage aus, den Knopf drückst du.")}</p>{showTemplates && <><div className="sql-template-target"><label>{t("Schema")}<input value={templateSchema} onChange={(event)=>{setTemplateSchema(event.target.value);setTemplateReason("");}} spellCheck={false} aria-label={t("Schema für eine Vorlage mit Tabelle")}/></label><label>{t("Tabelle")}<input value={templateTable} onChange={(event)=>{setTemplateTable(event.target.value);setTemplateReason("");}} spellCheck={false} aria-label={t("Tabelle für eine Vorlage mit Tabelle")}/></label></div>{templateReason && <p className="sql-template-reason">{templateReason}</p>}<ul className="sql-template-list">{SQL_TEMPLATES.map((template) => <li key={template.id} className={insertedTemplate === template.id ? "inserted" : ""}><div><strong>{t(template.title)}</strong><span>{t(template.question)}</span>{template.requiresExtension !== null && <em>{t("Braucht eine Erweiterung:")} {template.requiresExtension}. {t("Fehlt sie, antwortet die Datenbank mit einem Fehler statt mit Zeilen. Die Vorlage darüber sagt dir, ob sie da ist.")}</em>}{template.parameters.length > 0 && <em>{t("Braucht Schema und Tabelle aus den Feldern oben.")}</em>}</div><button className="secondary-button" type="button" onClick={()=>insertTemplate(template.id, template.parameters.length > 0)}><StableLabel current={insertedTemplate === template.id ? t("Eingefügt") : t("Einfügen")} variants={tAll("Eingefügt", "Einfügen")}/></button></li>)}</ul></>}</article></div>;
}

type ProjectAuthUserItem={id:string;email:string;status:"active"|"disabled";emailVerifiedAt:string|null;createdAt:string;appMetadata:Record<string,unknown>};
function AuthView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [users,setUsers]=useState<ProjectAuthUserItem[]>([]);const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");const [message,setMessage]=useState("");const [jwks,setJwks]=useState(false);
  const load=useCallback(async()=>{setState("loading");setMessage("");try{const [usersResponse,jwksResponse]=await Promise.all([fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users?limit=100`,{cache:"no-store"}),fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/.well-known/jwks.json`,{cache:"no-store"})]);setJwks(jwksResponse.ok);if(usersResponse.status===503){setState("unavailable");setMessage(t("Project Auth ist für diese Umgebung deaktiviert."));return;}const payload=await usersResponse.json();if(!usersResponse.ok)throw new Error(payload.error??t("Nutzer nicht verfügbar"));setUsers(payload.data.users);setState("ready");}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Nutzer nicht verfügbar"));}},[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  async function toggle(user:ProjectAuthUserItem){const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users/${user.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:user.status==="active"?"disabled":"active"})});if(response.ok)await load();else setMessage(t("Der Status konnte nicht geändert werden."));}
  const active=users.filter(user=>user.status==="active").length;const verified=users.filter(user=>Boolean(user.emailVerifiedAt)).length;
  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Project Auth wird geladen…")}</h3></div>;
  if(state==="unavailable"||state==="error")return <div className="console-card live-module-state"><Fingerprint size={26}/><h3>{state==="unavailable"?t("Project Auth nicht aktiviert"):t("Project Auth nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;
  return <div className="module-grid"><article className="console-card auth-overview"><div><span>{t("APP-NUTZER")}</span><strong>{users.length}</strong><small>{t("Aus dieser Umgebung")}</small></div><div><span>{t("AKTIV")}</span><strong>{active}</strong><small>{users.length?`${formatPercent(active/users.length, 0)} der Nutzer`:t("Keine Nutzer")}</small></div><div><span>{t("E-MAIL BESTÄTIGT")}</span><strong>{verified}</strong><small>{jwks?t("JWKS online"):t("JWKS nicht erreichbar")}</small></div></article><article className="console-card span-2"><div className="card-head"><div><span>{t("PROJECT AUTH")}</span><h3>{t("Nutzer der Anwendung")}</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>{users.map(user=><div className="auth-user" key={user.id}><span className="avatar">{user.email.slice(0,2).toUpperCase()}</span><div><strong>{user.email}</strong><small>{user.emailVerifiedAt?`Bestätigt am ${formatMoment(user.emailVerifiedAt, "date")}`:t("Bestätigung ausstehend")}</small></div><span>{Object.keys(user.appMetadata).length?t("Metadaten"):t("E-Mail")}</span><span className={user.status==="active"?"secure":"muted"}>{user.status}</span><button className="plain-button" onClick={()=>void toggle(user)}><StableLabel current={user.status==="active"?t("Deaktivieren"):t("Aktivieren")} variants={tAll("Deaktivieren", "Aktivieren")}/></button></div>)}{users.length===0&&<div className="live-module-state compact"><Fingerprint size={24}/><p>{t("Noch keine Nutzer. Sie kommen über Signup, Magic Link oder OIDC herein.")}</p></div>}</article><article className="console-card"><div className="card-head"><div><span>{t("AUTH-VERTRAG")}</span><h3>{t("Verfügbare Verfahren")}</h3></div></div><div className="detail-list"><div><span>{t("E-Mail und Passwort")}</span><strong className="secure">{t("Bereit")}</strong></div><div><span>{t("Magic Link / Reset")}</span><strong className="secure">{t("Bereit")}</strong></div><div><span>{t("TOTP + Recovery")}</span><strong className="secure">{t("Bereit")}</strong></div><div><span>{t("OIDC + PKCE")}</span><strong><OidcProviderSummary projectId={projectId} environment={environment}/></strong></div><div><span>{t("Ed25519 JWKS")}</span><strong className={jwks?"secure":""}>{jwks?t("Online"):t("Nicht erreichbar")}</strong></div></div></article></div>;
}

/**
 * Die konfigurierten OIDC-Provider — geladen ueber die Admin-Route aus 1.83.
 * Der Ladeweg steckt in `loadConsoleAuthProviders`; hier wird er eingehaengt.
 */
function OidcProviderSummary({projectId,environment}:{projectId:string;environment:Environment}) {
  const [result,setResult]=useState<ConsoleAuthProviderResult|null>(null);
  useEffect(()=>{let cancelled=false;void loadConsoleAuthProviders(projectId,environment).then(loaded=>{if(!cancelled)setResult(loaded);});return ()=>{cancelled=true;};},[projectId,environment]);
  if(result===null)return <>…</>;
  if(result.state!=="ready")return <>{t("Nicht verfügbar")}</>;
  if(result.providers.length===0)return <>{t("Keine Provider konfiguriert")}</>;
  return <>{result.providers.map(provider=>provider.id).join(", ")}</>;
}

function StorageView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [buckets,setBuckets]=useState<ProjectStorageBucketItem[]>([]);
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const endpoint=`/api/v1/projects/${projectId}/environments/${environment}/storage/buckets`;
  const load=useCallback(async()=>{setState("loading");setMessage("");try{const response=await fetch(endpoint,{cache:"no-store"});const payload=await response.json();if(response.status===503){setBuckets([]);setState("unavailable");setMessage(payload.error??t("Project Storage ist für diese Umgebung deaktiviert."));return;}if(!response.ok)throw new Error(payload.error??t("Storage nicht verfügbar"));setBuckets(payload.data as ProjectStorageBucketItem[]);setState("ready");}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Storage nicht verfügbar"));}},[endpoint]);
  useEffect(()=>{void load();},[load]);
  async function create(){const raw=window.prompt(t("Bucket-Name (Kleinbuchstaben, Ziffern, Bindestriche)"),"project-assets");if(!raw)return;const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:raw.trim()})});const payload=await response.json();if(!response.ok){setMessage(payload.error??t("Bucket konnte nicht angelegt werden"));setState("error");return;}await load();}
  async function remove(bucket:ProjectStorageBucketItem){if(!window.confirm(`Leeren Bucket ${bucket.name} löschen?`))return;const response=await fetch(`${endpoint}/${bucket.id}`,{method:"DELETE"});if(response.ok)await load();else{const payload=await response.json();setMessage(payload.error??t("Nur leere Buckets lassen sich löschen"));setState("error");}}
  const used=buckets.reduce((sum,bucket)=>sum+bucket.usedBytes,0);
  const quota=buckets.reduce((sum,bucket)=>sum+bucket.quotaBytes,0);
  const percent=quota>0?Math.min(100,(used/quota)*100):0;
  return <div className="module-grid"><article className="console-card storage-total"><Cloud size={24}/><div><span>{t("BELEGT")}</span><strong>{formatBytes(used)}</strong><small>{quota?`von ${formatBytes(quota)}`:t("Keine Buckets")}</small></div><div className="progress"><i style={{width:`${percent}%`}}/></div></article><article className="console-card span-2"><div className="card-head"><div><span>BUCKETS · {environment.toUpperCase()}</span><h3>{t("Buckets des Projekts")}</h3></div><button className="button small" onClick={()=>void create()} disabled={state==="loading"||state==="unavailable"}><Plus size={14}/> {t("Neuer Bucket")}</button></div>{state==="loading"&&<p className="muted">{t("Storage wird geladen…")}</p>}{(state==="unavailable"||state==="error")&&<div className="live-module-state compact"><Cloud size={24}/><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={13}/> {t("Noch einmal")}</button></div>}{state==="ready"&&buckets.length===0&&<p className="muted">{t("Noch keine Buckets. Neue Buckets sind privat und nehmen nur die sichere MIME-Liste an.")}</p>}{state==="ready"&&buckets.map(bucket=><div className="bucket-row" key={bucket.id}><span className="bucket-icon"><HardDrive size={16}/></span><div><strong>{bucket.name}</strong><small>Lesen {bucket.readPolicy} · Schreiben {bucket.writePolicy} · {bucket.retentionDays?`${bucket.retentionDays} Tage Aufbewahrung`:t("keine Aufbewahrungsregel")}</small></div><span>{formatBytes(bucket.usedBytes)} / {formatBytes(bucket.quotaBytes)}</span><button className="icon-button" onClick={()=>void remove(bucket)} aria-label={`${bucket.name} löschen`}><Trash2 size={14}/></button></div>)}</article><article className="console-card"><div className="card-head"><div><span>{t("REGELN")}</span><h3>{t("Privat, solange du nichts änderst")}</h3></div><ShieldCheck className="secure" size={21}/></div><p className="muted">Uploads sind an Grösse, MIME-Typ und SHA-256-Prüfsumme gebunden. Objekte bleiben in Quarantäne, bis der Scanner sie freigibt; signierte Downloads laufen nach höchstens 15 Minuten ab.</p></article></div>;
}

type FunctionDefinitionItem={id:string;name:string;image:string;entrypoint:string;timeoutMs:number;memoryMiB:number;egressOrigins:string[];secretRefs:string[];enabled:boolean};
type CronDefinitionItem={id:string;name:string;expression:string;queue:string;enabled:boolean;lastDispatchedAt:string|null};
type WebhookDefinitionItem={id:string;name:string;url:string;eventTypes:string[];signingSecretRef:string;timeoutMs:number;maxAttempts:number;enabled:boolean};
type WebhookDeliveryItem={id:string;eventType:string;status:"pending"|"in_flight"|"delivered"|"dead_lettered";attemptCount:number;lastFailureCode:string|null;settledAt:string|null};

/**
 * Cron-Jobs und Webhooks verwalten.
 *
 * Bis Release 1.20 entstanden beide ausschliesslich ueber direkten
 * Datenbankzugriff: Der Betrieb lief, aber niemand konnte ihm ohne `psql`
 * sagen, was er tun soll.
 *
 * Nur das Aktivierungsflag ist aenderbar. Ausdruck, Queue, Ziel-URL und
 * Signaturreferenz sind unveraenderlich; eine Aenderung ist ein Loeschen und
 * ein neues Anlegen. Diese Entscheidung liegt als Spaltenrecht in der
 * Datenbank, nicht in dieser Ansicht.
 */
function ComputeView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [cron,setCron]=useState<CronDefinitionItem[]>([]);
  const [webhooks,setWebhooks]=useState<WebhookDefinitionItem[]>([]);
  const [functions,setFunctions]=useState<FunctionDefinitionItem[]>([]);
  const [deliveries,setDeliveries]=useState<WebhookDeliveryItem[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const base=`/api/v1/projects/${projectId}/environments/${environment}/compute`;

  const load=useCallback(async()=>{setState("loading");setMessage("");try{
    const [cronResponse,webhookResponse,functionResponse]=await Promise.all([
      fetch(`${base}/cron`,{cache:"no-store"}),fetch(`${base}/webhooks`,{cache:"no-store"}),
      fetch(`${base}/functions`,{cache:"no-store"})]);
    const cronPayload=await cronResponse.json();const webhookPayload=await webhookResponse.json();
    const functionPayload=await functionResponse.json();
    if(cronResponse.status===503||webhookResponse.status===503){setCron([]);setWebhooks([]);setFunctions([]);setState("unavailable");
      setMessage(cronPayload.error??webhookPayload.error??t("Compute ist für diese Umgebung deaktiviert."));return;}
    if(!cronResponse.ok)throw new Error(cronPayload.error??t("Cron-Definitionen nicht verfügbar"));
    if(!webhookResponse.ok)throw new Error(webhookPayload.error??t("Webhook-Definitionen nicht verfügbar"));
    if(!functionResponse.ok)throw new Error(functionPayload.error??t("Function-Definitionen nicht verfügbar"));
    setCron(cronPayload.data as CronDefinitionItem[]);setWebhooks(webhookPayload.data as WebhookDefinitionItem[]);
    setFunctions(functionPayload.data as FunctionDefinitionItem[]);setState("ready");
  }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:t("Compute nicht verfügbar"));}},[base]);
  useEffect(()=>{void load();},[load]);

  async function mutate(path:string,init:RequestInit){const response=await fetch(`${base}${path}`,init);
    if(response.ok){await load();return true;}
    const payload=await response.json().catch(()=>({}));setMessage(payload.error??t("Die Änderung wurde abgelehnt."));return false;}

  async function createCron(){const name=window.prompt(t("Name des Cron-Jobs (Kleinbuchstaben, Ziffern, Bindestrich)"),"nightly-report");if(!name)return;
    const expression=window.prompt(t("Ausdruck in UTC: */N * * * * oder M H * * *"),"*/15 * * * *");if(!expression)return;
    const queue=window.prompt(t("Bestehende Projekt-Queue"),"email_jobs");if(!queue)return;
    await mutate("/cron",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),expression:expression.trim(),queue:queue.trim()})});}

  async function createWebhook(){const name=window.prompt(t("Name des Webhooks (Kleinbuchstaben, Ziffern, Bindestrich)"),"order-events");if(!name)return;
    const url=window.prompt(t("Exaktes öffentliches HTTPS-Ziel, ohne Query und Fragment"),"https://receiver.example.com/hooks");if(!url)return;
    const events=window.prompt(t("Ereignistypen, kommagetrennt"),"order.created");if(!events)return;
    // Nur die Referenz. Das Geheimnis selbst liegt im Vault und darf diese
    // Flaeche nie beruehren.
    const signingSecretRef=window.prompt(t("Vault-Referenz des Signaturschlüssels, nie das Geheimnis selbst"),"vault:webhook/orders");if(!signingSecretRef)return;
    await mutate("/webhooks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),url:url.trim(),eventTypes:events.split(",").map(entry=>entry.trim()).filter(Boolean),signingSecretRef:signingSecretRef.trim()})});}

  async function createFunction(){const name=window.prompt(t("Name der Function (Kleinbuchstaben, Ziffern, Bindestrich)"),"resize-image");if(!name)return;
    // Digest statt Tag: Ein Tag koennte morgen einen anderen Inhalt bezeichnen.
    const image=window.prompt(t("Image per Digest, zum Beispiel registry.example.com/app/fn@sha256:…"),"");if(!image)return;
    const entrypoint=window.prompt(t("Entrypoint im Image"),"handler.mjs");if(!entrypoint)return;
    await mutate("/functions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),image:image.trim(),entrypoint:entrypoint.trim()})});}

  async function testInvoke(fn:FunctionDefinitionItem){
    setMessage(`${fn.name} läuft…`);
    const response=await fetch(`${base}/invoke/${fn.name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:"console"})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(payload.error??t("Die Function konnte nicht ausgeführt werden"));return;}
    setMessage(`${fn.name} antwortete mit Status ${payload.data?.statusCode ?? "?"}.`);}

  async function showDeliveries(webhook:WebhookDefinitionItem){
    if(selected===webhook.id){setSelected(null);setDeliveries([]);return;}
    const response=await fetch(`${base}/webhooks/${webhook.id}/deliveries?limit=20`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(payload.error??t("Zustellstatus nicht verfügbar"));return;}
    setSelected(webhook.id);setDeliveries(payload.data as WebhookDeliveryItem[]);}

  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Functions, Cron und Webhooks werden geladen…")}</h3></div>;
  if(state==="unavailable")return <div className="console-card live-module-state"><Webhook size={26}/><h3>{t("Compute nicht aktiviert")}</h3><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  return <div className="module-grid">
    <article className="console-card span-2"><div className="card-head"><div><span>FUNCTIONS · {environment.toUpperCase()}</span><h3>{t("Ausführung in der Sandbox")}</h3></div><button className="button small" onClick={()=>void createFunction()}><Plus size={14}/> {t("Neue Function")}</button></div>
      {functions.length===0&&<p className="muted">Noch keine Functions. Das Image muss per Digest festgelegt sein; die Sandbox startet es ohne Netz, nur lesend, ohne Root und mit harter Speichergrenze.</p>}
      {functions.map(fn=><div className="bucket-row" key={fn.id}><span className="bucket-icon"><Blocks size={16}/></span>
        <div><strong>{fn.name}</strong><small>{fn.entrypoint} · {fn.memoryMiB} MiB · {fn.timeoutMs} ms · {fn.egressOrigins.length?`${fn.egressOrigins.length} Ausgangsziele (noch nicht ausführbar)`:t("kein Ausgang")}{fn.secretRefs.length?` · ${fn.secretRefs.length} Secret-Referenzen`:""}</small></div>
        <span className={fn.enabled?"secure":"muted"}>{fn.enabled?t("aktiv"):t("pausiert")}</span>
        <button className="plain-button" onClick={()=>void testInvoke(fn)} disabled={!fn.enabled}>{t("Testlauf")}</button>
        <button className="plain-button" onClick={()=>void mutate(`/functions/${fn.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!fn.enabled})})}><StableLabel current={fn.enabled?t("Pausieren"):t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
        <button className="icon-button" onClick={()=>{if(window.confirm(`Function ${fn.name} löschen? Image und Grenzen lassen sich nicht ändern; eine Änderung ist Löschen und neu Anlegen.`))void mutate(`/functions/${fn.id}`,{method:"DELETE"});}} aria-label={`${fn.name} löschen`}><Trash2 size={14}/></button></div>)}
    </article>
    <article className="console-card span-2"><div className="card-head"><div><span>CRON · {environment.toUpperCase()}</span><h3>{t("Geplante Einreihung")}</h3></div><button className="button small" onClick={()=>void createCron()}><Plus size={14}/> {t("Neuer Cron-Job")}</button></div>
      {message&&<p className="muted">{message}</p>}
      {cron.length===0&&<p className="muted">{t("Noch keine Cron-Jobs. Jeder Termin landet mit festem Dedupe-Schlüssel in einer bestehenden Projekt-Queue, damit zwei Scheduler genau eine Nachricht erzeugen.")}</p>}
      {cron.map(job=><div className="bucket-row" key={job.id}><span className="bucket-icon"><Zap size={16}/></span>
        <div><strong>{job.name}</strong><small>{job.expression} UTC → {job.queue} · {job.lastDispatchedAt?`zuletzt ${formatMoment(job.lastDispatchedAt)}`:t("noch nie eingereiht")}</small></div>
        <span className={job.enabled?"secure":"muted"}>{job.enabled?t("aktiv"):t("pausiert")}</span>
        <button className="plain-button" onClick={()=>void mutate(`/cron/${job.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!job.enabled})})}><StableLabel current={job.enabled?t("Pausieren"):t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
        <button className="icon-button" onClick={()=>{if(window.confirm(`Cron-Job ${job.name} löschen? Ausdruck und Queue lassen sich nicht ändern; eine Änderung ist Löschen und neu Anlegen.`))void mutate(`/cron/${job.id}`,{method:"DELETE"});}} aria-label={`${job.name} löschen`}><Trash2 size={14}/></button></div>)}
    </article>
    <article className="console-card"><div className="card-head"><div><span>{t("ZUSTELLVERTRAG")}</span><h3>{t("Signiert und bestätigt")}</h3></div><ShieldCheck className="secure" size={21}/></div>
      <p className="muted">{t("Jede Zustellung ist mit HMAC-SHA256 über Zeitstempel und Body signiert. Der Empfänger muss 2xx antworten")} <em>{t("und")}</em> {t("den Header")} <code>{"x-qkern-delivery-id"}</code> {t("zurückgeben, sonst zählt der Versuch als fehlgeschlagen und der Server entscheidet über die Wiederholung. Payloads erscheinen hier nie.")}</p></article>
    <article className="console-card span-2"><div className="card-head"><div><span>WEBHOOKS · {environment.toUpperCase()}</span><h3>{t("Ziele für ausgehende Zustellungen")}</h3></div><button className="button small" onClick={()=>void createWebhook()}><Plus size={14}/> {t("Neuer Webhook")}</button></div>
      {webhooks.length===0&&<p className="muted">{t("Noch keine Webhooks. Ziele müssen exakte öffentliche HTTPS-URLs auf Port 443 sein, ohne Query und Fragment. Dieselbe Regel prüft der Zusteller, also wird ein hier angenommenes Ziel später nicht abgelehnt.")}</p>}
      {webhooks.map(hook=><div key={hook.id}>
        <div className="bucket-row"><span className="bucket-icon"><Webhook size={16}/></span>
          <div><strong>{hook.name}</strong><small>{hook.url} · {hook.eventTypes.join(", ")} · {hook.maxAttempts} Versuche · Schlüssel {hook.signingSecretRef}</small></div>
          <span className={hook.enabled?"secure":"muted"}>{hook.enabled?t("aktiv"):t("pausiert")}</span>
          <button className="plain-button" onClick={()=>void showDeliveries(hook)}><StableLabel current={selected===hook.id?t("Status ausblenden"):t("Zustellstatus")} variants={tAll("Status ausblenden", "Zustellstatus")}/></button>
          <button className="plain-button" onClick={()=>void mutate(`/webhooks/${hook.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!hook.enabled})})}><StableLabel current={hook.enabled?t("Pausieren"):t("Aktivieren")} variants={tAll("Pausieren", "Aktivieren")}/></button>
          <button className="icon-button" onClick={()=>{if(!hook.enabled&&window.confirm(`Webhook ${hook.name} löschen? Offene Zustellungen verschwinden mit ihm.`))void mutate(`/webhooks/${hook.id}`,{method:"DELETE"});else if(hook.enabled)setMessage(t("Pausiere den Webhook vor dem Löschen; mit ihm verschwinden auch die offenen Zustellungen."));}} aria-label={`${hook.name} löschen`}><Trash2 size={14}/></button></div>
        {selected===hook.id&&<div className="detail-list">{deliveries.length===0?<div><span>{t("Keine Zustellungen")}</span><strong className="muted">–</strong></div>:deliveries.map(delivery=><div key={delivery.id}><span>{delivery.eventType}<small>Versuch {delivery.attemptCount}{delivery.lastFailureCode?` · ${delivery.lastFailureCode}`:""}</small></span><strong className={delivery.status==="delivered"?"secure":delivery.status==="dead_lettered"?"risk high":""}>{delivery.status}</strong></div>)}</div>}
      </div>)}
    </article>
  </div>;
}


function LiveApiView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [language,setLanguage]=useState("typescript");
  const [paths,setPaths]=useState<string[]>([]);
  const [keys,setKeys]=useState<ProjectApiKeyItem[]>([]);
  const [secret,setSecret]=useState("");
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{setMessage("");const [openapiResponse,keysResponse]=await Promise.all([fetch(`/api/v1/projects/${projectId}/environments/${environment}/generated-openapi?schema=public`,{cache:"no-store"}),fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys`,{cache:"no-store"})]);if(openapiResponse.ok){const document=await openapiResponse.json();setPaths(Object.keys(document.paths??{}));}else{setPaths([]);setMessage(t("Die generierte OpenAPI gibt es erst, wenn die Projekt-API-Rolle eingerichtet ist."));}if(keysResponse.ok){setKeys((await keysResponse.json()).data as ProjectApiKeyItem[]);}},[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  async function createKey(kind:"public"|"service"){const name=window.prompt(`Name für den ${kind==="public"?"Public":"Service"} Key`,kind==="public"?t("Public Key für den Browser"):t("Service Key für den Server"));if(!name)return;const expiresAt=new Date(Date.now()+(kind==="public"?90:30)*24*60*60*1000).toISOString();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,kind,expiresAt})});if(!response.ok){setMessage((await response.json()).error??t("Key konnte nicht erstellt werden"));return;}const payload=await response.json();setSecret(payload.data.secret);await load();}
  async function revoke(keyId:string){if(!window.confirm(t("Diesen Key endgültig widerrufen?")))return;const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys/${keyId}`,{method:"DELETE"});if(response.ok)await load();else setMessage(t("Key konnte nicht widerrufen werden."));}
  const endpoint=paths[0]??`/v1/projects/${projectId}/environments/${environment}/tables/{table}/rows`;
  const typeScriptExample=`const response = await fetch(\n  \"/api${endpoint}?limit=20\",\n  { headers: {\n      Authorization: \"Bearer \" + QKERN_PUBLIC_KEY\n  } }\n);\nconst { data } = await response.json();`;
  const curlExample=`curl '/api${endpoint}?limit=20' -H \"Authorization: Bearer $QKERN_PUBLIC_KEY\"`;
  return <div className="api-console-grid"><article className="console-card endpoint-list"><div className="card-head"><div><span>{t("GENERIERTE REST-API")}</span><h3>{t("Endpunkte aus dem Live-Schema")}</h3></div><span className={paths.length?"secure":"muted"}>{paths.length?t("OpenAPI aktuell"):t("Nicht eingerichtet")}</span></div>{paths.map(path=><button key={path}><span className="method get">CRUD</span><code>{path}</code><ChevronRight size={14}/></button>)}{paths.length===0&&<div className="live-module-state compact"><Braces size={24}/><p>{message||t("Keine Tabelle mit RLS und Primärschlüssel freigegeben.")}</p></div>}</article><article className="console-card code-sample"><div className="code-head"><span>GET {endpoint}</span><select value={language} onChange={event=>setLanguage(event.target.value)}><option value="typescript">TypeScript</option><option value="curl">cURL</option></select></div><pre>{language==="typescript"?typeScriptExample:curlExample}</pre><div className="code-note"><ShieldCheck size={14}/> Filter sind parametrisiert; die Zeilen begrenzt die Projektrolle mit RLS.</div></article><article className="console-card span-2 api-key-manager"><div className="card-head"><div><span>{t("API-KEYS DES PROJEKTS")}</span><h3>Zugriff für {environment}</h3></div><div><button className="secondary-button" onClick={()=>void createKey("public")}><Plus size={13}/> {t("Public Key")}</button><button className="button small" onClick={()=>void createKey("service")}><Plus size={13}/> {t("Service Key")}</button></div></div>{secret&&<div className="one-time-secret"><div><strong>{t("Jetzt kopieren, erscheint nur einmal")}</strong><code>{secret}</code></div><button onClick={()=>void navigator.clipboard.writeText(secret)}><Copy size={14}/> {t("Kopieren")}</button><button onClick={()=>setSecret("")}><X size={14}/></button></div>}<div className="api-key-list">{keys.map(key=><div key={key.id}><span className={`key-kind ${key.kind}`}>{key.kind}</span><div><strong>{key.name}</strong><code>{key.prefix}…</code></div><span>{key.revokedAt?"widerrufen":`läuft ab ${formatMoment(key.expiresAt, "date")}`}</span>{!key.revokedAt&&<button onClick={()=>void revoke(key.id)} aria-label={t("Key widerrufen")}><Trash2 size={14}/></button>}</div>)}{keys.length===0&&<p className="muted">{t("Noch keine Keys. Das Geheimnis wird nie gespeichert und nur einmal gezeigt.")}</p>}</div></article></div>;
}

function AIBridge({ projectId, environment, reload, navigate }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void }) {
  const [prompt,setPrompt]=useState("Lies das Schema und bereite einen Index auf orders.created_at vor. Wende ihn nicht an."); const [creating,setCreating]=useState(false); const [done,setDone]=useState(false);
  async function create(){setCreating(true); const response=await fetch("/api/v1/changesets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,environment,title:t("Index auf orders nach Erstellzeit"),statement:"CREATE INDEX orders_created_at_idx ON orders (created_at DESC)"})}); setCreating(false); if(response.ok){setDone(true);await reload();}}
  return <div className="ai-console-grid"><article className="console-card connection-card placeholder-state"><Bot size={26}/><div><span className="console-kicker">{t("Agenten")}</span><h3>{t("Noch keine Verbindung")}</h3><p>{t("Der OAuth-Weg, über den sich Claude Code oder Codex an dieses Projekt binden, ist noch nicht verbunden. Bis dahin zeigt diese Karte keine erfundenen Agenten.")}</p></div><button className="button small is-placeholder" disabled title={t("Agentenverbindungen sind noch nicht verbunden")}><Plus size={14}/> {t("Verbinden")}</button></article><article className="console-card workspace-card"><div className="card-head"><div><span>{t("AGENTEN-ARBEITSBEREICH")}</span><h3>{t("Eine Änderung vorbereiten")}</h3></div><span className={`environment-select ${environment}`}>{environment}</span></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} aria-label={t("Aufgabe für den Agenten")}/><div className="workspace-scope"><ShieldCheck size={14}/><span>{t("Der Agent liest das Schema und erstellt Vorschauen. Freigabe und Einreihung folgen der Regel des Projekts: manuell, abgesichert oder autonom. Geheimnisse bleiben verborgen.")}</span></div><button className="button" onClick={create} disabled={creating}><StableLabel current={creating?t("Wird vorbereitet…"):t("Vorschau erstellen")} variants={tAll("Wird vorbereitet…", "Vorschau erstellen")}/><ArrowIcon/></button>{done&&<div className="inline-success"><CheckIcon/>{t("Change Set erstellt.")} <button onClick={()=>navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}</article><article className="console-card span-2 mcp-config"><div className="card-head"><div><span>{t("CODEX-KONFIGURATION")}</span><h3>{t("Streamable HTTP, an das Projekt gebunden")}</h3></div><span className="muted">{t("Beispiel")}</span></div><pre>{`[mcp_servers.qkern]\nurl = "https://mcp.example.qkern.ch/mcp"\nauth = "oauth"\nrequired = true\nenabled_tools = ["qkern_project_get", "qkern_schema_list", "qkern_query_readonly", "qkern_migration_preview"]\ndefault_tools_approval_mode = "writes"`}</pre><p>{t("OAuth muss die MCP-Session an Akteur, Organisation, Projekt, Umgebung und Werkzeug-Scopes binden. Die URL oben ist ein Beispiel.")}</p></article></div>;
}

function ActivityView({ audit, aiOnly }: { audit: AuditEvent[]; aiOnly: boolean }) { return <article className="console-card activity-log"><div className="log-toolbar"><div className="toolbar-search"><Search size={14}/><input placeholder={t("Ereignisse durchsuchen…")}/></div><button className="secondary-button is-placeholder" disabled title={t("Filter sind noch nicht verbunden")}><ListFilter size={14}/> {t("Filter")}</button></div><div className="log-row log-header"><span>{t("Zeit")}</span><span>{t("Akteur")}</span><span>{t("Aktion")}</span><span>{t("Ressource")}</span><span>{t("Status")}</span></div>{audit.filter(e=>!aiOnly||e.actor==="Codex").map(event=><div className="log-row" key={event.id}><time>{formatTime(event.createdAt)}</time><span><Bot size={13}/>{event.actor}</span><code>{event.action}</code><span>{event.resource}</span><span className={`log-status ${event.status}`}>{event.status}</span></div>)}</article>; }

function ApprovalView({ projectId, environment, approvals, changes, reload }: { projectId: string; environment: Environment; approvals: Approval[]; changes: ChangeSet[]; reload: () => Promise<void> }) {
  const [busy,setBusy]=useState("");
  async function decide(id:string,decision:"approved"|"rejected"){setBusy(id);await fetch(`/api/v1/approvals/${id}/decision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})});setBusy("");await reload();}
  const scopedApprovals = approvals.filter((approval) => approval.projectId === projectId && approval.environment === environment);
  return <div className="approval-list">
    <AutomationPolicyPanel projectId={projectId} environment={environment}/>
    {scopedApprovals.length===0&&<EmptyState icon={ShieldCheck} title={t("Keine offenen Freigaben")} text="Riskante Änderungen von Agenten und aus der Console landen hier."/>}
    {scopedApprovals.map(approval=>{const change=changes.find(item=>item.id===approval.changeSetId);return <article className="console-card approval-card" key={approval.id}><div className="approval-top"><span className={`risk ${approval.risk}`}>Risiko {approval.risk}</span><span>{approval.environment}</span><time>{formatTime(approval.createdAt)}</time></div><h2>{approval.action}</h2><p>Angefragt von {approval.requestedBy}. Nichts wurde angewendet.</p>{change&&<><div className="approval-detail-grid"><div><span>{t("BETROFFENE RESSOURCE")}</span><strong>{change.projectId}</strong></div><div><span>{t("CHANGE SET")}</span><strong>{change.id}</strong></div><div><span>{t("STATUS")}</span><strong>{approval.status}</strong></div></div><div className="approval-diff">{change.diff.map(line=><code key={line}>{line}</code>)}</div><div className="test-chips">{change.tests.map(test=><span key={test}><CheckIcon/>{test}</span>)}</div></>}{approval.status==="pending"?<div className="approval-actions"><button className="ghost-button" disabled={busy===approval.id} onClick={()=>decide(approval.id,"rejected")}>{t("Ablehnen")}</button><button className="button" disabled={busy===approval.id} onClick={()=>decide(approval.id,"approved")}>{t("Einmal freigeben")}</button></div>:<div className={`decision-banner ${approval.status}`}>Entscheidung: {approval.status}</div>}</article>})}
  </div>;
}

function AutomationPolicyPanel({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [policy,setPolicy]=useState<ProjectAutomationPolicy|null>(null);
  const [mode,setMode]=useState<AutomationMode>("manual");
  const [maxAutoRisk,setMaxAutoRisk]=useState<Risk>("low");
  const [autoQueue,setAutoQueue]=useState(false);
  const [emergencyStop,setEmergencyStop]=useState(false);
  const [state,setState]=useState<"loading"|"idle"|"saving"|"saved"|"error">("loading");

  useEffect(()=>{let active=true;setState("loading");void fetch(`/api/v1/projects/${projectId}/environments/${environment}/automation-policy`,{cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("policy unavailable");return (await response.json()).data as ProjectAutomationPolicy;}).then(next=>{if(!active)return;setPolicy(next);setMode(next.mode);setMaxAutoRisk(next.maxAutoRisk);setAutoQueue(next.autoQueue);setEmergencyStop(next.emergencyStop);setState("idle");}).catch(()=>{if(active)setState("error");});return()=>{active=false;};},[projectId,environment]);

  async function save(){setState("saving");const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/automation-policy`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,maxAutoRisk,autoQueue:environment==="production"?false:autoQueue,emergencyStop})});if(!response.ok){setState("error");return;}const next=(await response.json()).data as ProjectAutomationPolicy;setPolicy(next);setState("saved");}
  const description = mode === "manual" ? t("Jede riskante Änderung wartet auf eine menschliche Entscheidung.") : mode === "guarded" ? t("Nur klar begrenzte, nicht-produktive Änderungen bis zur Risikogrenze werden automatisch freigegeben.") : t("Agenten dürfen Änderungen bis zur Risikogrenze ohne Freigabe pro Änderung genehmigen.");
  return <article className={`console-card automation-policy ${emergencyStop?"stopped":""}`}>
    <div className="card-head"><div><span>AUTOMATIK · {environment.toUpperCase()}</span><h3>{t("Freigabemodus")}</h3></div><span className={`automation-status ${emergencyStop?"stopped":mode}`}>{emergencyStop?"NOT-AUS":({manual:"Manuell",guarded:"Abgesichert",autonomous:"Autonom"} as const)[mode]}</span></div>
    <p>{description} Jede automatische Entscheidung bleibt im Audit-Log nachvollziehbar.</p>
    <div className="automation-fields">
      <label>{t("Modus")}<select value={mode} onChange={event=>setMode(event.target.value as AutomationMode)}><option value="manual">{t("Manuell")}</option><option value="guarded">{t("Abgesichert")}</option><option value="autonomous">{t("Autonom")}</option></select></label>
      <label>{t("Maximales Auto-Risiko")}<select value={maxAutoRisk} onChange={event=>setMaxAutoRisk(event.target.value as Risk)} disabled={mode==="manual"}><option value="low">{t("Niedrig")}</option><option value="medium">{t("Mittel")}</option><option value="high">{t("Hoch")}</option><option value="critical">{t("Kritisch")}</option></select></label>
      <label className="automation-check"><input type="checkbox" checked={autoQueue&&environment!=="production"} disabled={mode==="manual"||environment==="production"} onChange={event=>setAutoQueue(event.target.checked)}/><span>{t("Nach Auto-Freigabe direkt einreihen")}<small>{environment==="production"?t("Production braucht zusätzlich eine maschinell signierte Release-Autorisierung."):t("Der Worker führt weiterhin alle Datenbank- und Ledger-Prüfungen aus.")}</small></span></label>
      <label className="automation-check danger"><input type="checkbox" checked={emergencyStop} onChange={event=>setEmergencyStop(event.target.checked)}/><span>{t("Not-Aus aktivieren")}<small>{t("Stoppt sofort jede automatische Freigabe und Queue-Einreihung.")}</small></span></label>
    </div>
    {(mode==="autonomous"&&(maxAutoRisk==="high"||maxAutoRisk==="critical"))&&<div className="automation-warning"><ShieldCheck size={15}/><span>{t("Das ist eine weitreichende stehende Autorisierung. Setze sie pro Projekt und Umgebung bewusst.")}</span></div>}
    <div className="automation-footer"><span>{policy?`Revision ${policy.revision}`:t("Regel wird geladen")}</span>{state==="error"&&<strong>{t("Die Regel konnte nicht geladen oder gespeichert werden.")}</strong>}{state==="saved"&&<strong className="secure">{t("Gespeichert")}</strong>}<button className="button small" onClick={save} disabled={state==="loading"||state==="saving"}><StableLabel current={state==="saving"?t("Speichern…"):t("Regel speichern")} variants={tAll("Speichern…", "Regel speichern")}/></button></div>
  </article>;
}

function UsageView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [projection,setProjection]=useState<UsageProjection|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"disabled"|"error">("loading");
  const load=useCallback(async()=>{
    setState("loading");
    try {
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/usage`,{cache:"no-store"});
      if(response.status===503){setProjection(null);setState("disabled");return;}
      if(!response.ok)throw new Error("Usage projection unavailable");
      setProjection(((await response.json()) as {data:UsageProjection}).data);
      setState("ready");
    } catch {setProjection(null);setState("error");}
  },[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  if(state==="loading")return <LoadingState/>;
  if(state==="disabled")return <EmptyState icon={CircleGauge} title={t("Usage Metering ist deaktiviert")} text="Aktiviere QKERN_USAGE_METERING_ENABLED und die dauerhafte Runtime-Persistenz, um echte Monatswerte zu sehen."/>;
  if(state==="error"||!projection)return <ErrorState message="Die Usage-Projektion konnte nicht geladen werden." retry={()=>void load()}/>;
  return <>
    <div className="product-preview-notice"><ShieldCheck size={16}/><div><strong>{t("Nutzung, nur lesend")}</strong><span>{projection.period} · an den Tenant gebunden · Preise und Limits ändert die Console nicht</span></div></div>
    <div className="metric-grid monitoring-grid">
      {projection.metrics.slice(0,4).map(item=><article className="console-card metric-tile" key={item.metric}><div><span>{item.label.toUpperCase()}</span><CircleGauge size={17}/></div><strong>{formatUsageAmount(item.used,item.unit)}</strong><small>{item.limit===null?t("Kein Limit"):`${formatUsageAmount(item.remaining??"0",item.unit)} verbleibend`}</small></article>)}
    </div>
    <article className="console-card chart-card">
      <div className="card-head"><div><span>{t("MONATSKONTO")}</span><h3>{t("Nutzung und Limits")}</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> {t("Aktualisieren")}</button></div>
      <div className="detail-list">
        {projection.metrics.map(item=><div key={item.metric}><span>{item.label}<small>{item.mode} · Revision {item.revision??"–"}</small></span><strong className={item.status==="exceeded"||item.status==="exhausted"?"risk high":item.status==="warning"?"risk medium":"secure"}>{formatUsageAmount(item.used,item.unit)}{item.limit===null?"":` / ${formatUsageAmount(item.limit,item.unit)}`} · {usageStatusLabel(item.status)}</strong></div>)}
      </div>
    </article>
    <InvoicesCard projectId={projectId} environment={environment}/>
  </>;
}

function BackupsView(){return <div className="module-grid"><article className="console-card span-2 placeholder-state"><ArchiveRestore size={26}/><div><span className="console-kicker">{t("Backups")}</span><h2>{t("Noch nicht verbunden")}</h2><p>{t("Backups, Point-in-time-Recovery und Restore-Drills brauchen ein WAL-Archiv ausserhalb des Wegwerf-Stacks. Bis dahin zeigt diese Ansicht keine erfundenen Wiederherstellungspunkte.")}</p></div><button className="button small is-placeholder" disabled title={t("Backups sind noch nicht verbunden")}>{t("Backup erstellen")}</button></article></div>}

function SettingsView({ project, organizationId }: { project: { name: string; id: string }; organizationId: string }){return <div className="settings-layout"><aside className="console-card settings-nav"><button className="active" type="button">{t("Allgemein")}</button>{["Umgebungen","API-Keys","KI-Verbindungen","Team","Gefahrenzone"].map(tab=><button key={tab} type="button" disabled className="is-placeholder" title={`${tab} ist noch nicht verbunden`}>{tab}</button>)}</aside><article className="console-card settings-form"><span className="console-kicker">{t("Projekteinstellungen")}</span><h2>{t("Allgemein")}</h2><label>{t("Projektname")}<input value={project.name} readOnly/></label><label>{t("Projekt-ID")}<input value={project.id} readOnly/></label><label>{t("Organisations-ID")}<input value={organizationId} readOnly/></label><div className="form-note"><ShieldCheck size={16}/><p><strong>{t("Nur lesend")}</strong><br/>Umbenennen, Regionen und Gefahrenzone sind noch nicht verbunden; diese Ansicht zeigt den echten Namen, die echte ID des Projekts und die ID der Organisation.</p></div><button className="button is-placeholder" disabled title={t("Speichern ist noch nicht verbunden")}>{t("Änderungen speichern")}</button></article></div>}

function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: ViewId) => void }){const [query,setQuery]=useState("");const matches=NAV_ENTRIES.filter(item=>`${item.group} ${item.label} ${t(item.group)} ${t(item.label)}`.toLowerCase().includes(query.toLowerCase())).slice(0,12);return <div className="command-overlay" onMouseDown={onClose}><div className="command-palette" onMouseDown={e=>e.stopPropagation()}><div className="command-input"><Search size={18}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("Console durchsuchen…")}/><button onClick={onClose}>ESC</button></div><div className="command-results"><span>{t("NAVIGATION")}</span>{matches.map(item=>{const Icon=groupOf(item.id).icon;return <button key={`${item.group}-${item.id}`} onClick={()=>{onNavigate(item.id);onClose();}}><Icon size={16}/>{item.group===item.label?t(item.label):`${t(item.group)} · ${t(item.label)}`}<Command size={13}/></button>})}</div></div></div>}
function LoadingState(){return <div className="loading-grid">{Array.from({length:8}).map((_,i)=><i key={i}/>)}</div>}
function ErrorState({message,retry}:{message:string;retry:()=>void}){return <div className="error-state"><X size={30}/><h3>{t("Console-Daten konnten nicht geladen werden")}</h3><p>{message}</p><button className="button small" onClick={retry}>{t("Noch einmal")}</button></div>}
function EmptyState({icon:Icon,title,text}:{icon:typeof Database;title:string;text:string}){return <div className="empty-state"><Icon size={28}/><h3>{title}</h3><p>{text}</p></div>}
function CheckIcon(){return <span className="check-icon">✓</span>}
function ArrowIcon(){return <span aria-hidden>→</span>}
function formatTime(value:string){return formatMoment(value,"hourMinute")}
function formatCell(value:unknown){if(value===null)return "null";if(typeof value==="object")return JSON.stringify(value);return String(value)}
function formatBytes(value:number){if(value<1024)return `${value} B`;const units=["KB","MB","GB","TB","PB"];let amount=value/1024;let index=0;while(amount>=1024&&index<units.length-1){amount/=1024;index+=1;}return `${amount>=10?formatDecimal(amount,1):formatDecimal(amount,2)} ${units[index]}`;}
function formatUsageAmount(value:string,unit:"operations"|"rows"|"bytes"){
  const amount=BigInt(value);
  if(unit!=="bytes")return formatNumber(amount);
  const units=[["PB",1125899906842624n],["TB",1099511627776n],["GB",1073741824n],["MB",1048576n],["KB",1024n]] as const;
  for(const [label,size] of units){if(amount>=size){const tenths=amount*10n/size;return `${formatDecimal(Number(tenths)/10,1)} ${label}`;}}
  return `${amount} B`;
}
function usageStatusLabel(status:UsageProjection["metrics"][number]["status"]){return ({unlimited:"unbegrenzt",ok:t("im Rahmen"),warning:"Warnschwelle",exhausted:t("ausgeschöpft"),exceeded:t("überschritten")} as const)[status];}
