"use client";

import {
  Bell, Blocks, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, Command,
  LogOut, Menu, Plus, Search, Settings, ShieldCheck, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";
import { displayWorkspaceName } from "@/lib/console/workspace-name";
import { NAV, NAV_ENTRIES, groupOf, isPlaceholder, type ViewId } from "@/components/console/navigation";
import { setConsoleLocale, t, tAll } from "@/components/console/console-i18n";
import { CheckIcon, ErrorState } from "@/components/console/console-parts";
import { setConsoleDisplaySettings } from "@/components/console/console-display";
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
import { BackupsView } from "@/components/console/backups-view";
import { PitrView } from "@/components/console/pitr-view";
import { RestoreToNewProjectView } from "@/components/console/restore-to-new-project-view";
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
import { IntegrationsGraphqlView } from "@/components/console/integrations-graphql-view";
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
import { FunctionContainerLogView } from "@/components/console/function-container-log-view";
import { ApiGatewayLogView } from "@/components/console/api-gateway-log-view";
import { PoolerLogView } from "@/components/console/pooler-log-view";
import { RealtimeLogView } from "@/components/console/realtime-log-view";
import { JwtKeysView } from "@/components/console/jwt-keys-view";
import { StoragePoliciesView } from "@/components/console/storage-policies-view";
import { StorageSettingsView } from "@/components/console/storage-settings-view";
import { S3AccessView } from "@/components/console/s3-access-view";
import { DataApiSettingsView } from "@/components/console/data-api-settings-view";
import { InfrastructureView } from "@/components/console/infrastructure-view";
import { ProvisioningOrderView } from "@/components/console/provisioning-order-view";
import { IntegrationsServicesView } from "@/components/console/integrations-services-view";
import { AddonsView } from "@/components/console/addons-view";
import { BranchFlowView } from "@/components/console/branch-flow-view";
import { DatabaseHealthView } from "@/components/console/database-health-view";
import { OverviewView } from "@/components/console/overview-view";
import { DatabaseView } from "@/components/console/database-view";
import { TableView } from "@/components/console/table-view";
import { SqlView } from "@/components/console/sql-view";
import { AuthView } from "@/components/console/auth-view";
import { StorageView } from "@/components/console/storage-view";
import { ComputeView } from "@/components/console/compute-view";
import { LiveApiView } from "@/components/console/live-api-view";
import { ActivityView } from "@/components/console/activity-view";
import { ApprovalView } from "@/components/console/approval-view";
import { UsageView } from "@/components/console/usage-view";
import { SettingsView } from "@/components/console/settings-view";
import { PlaceholderView } from "@/components/console/placeholder-view";
import type { Locale } from "@/lib/i18n/locales";
import { LOCALE_COOKIE } from "@/lib/i18n/locales";
import {
  CONSOLE_DISPLAY_DEFAULTS, CONSOLE_DISPLAY_INHERIT, resolvedConsoleLanguage,
  type ConsoleDisplaySettings,
} from "@/lib/console/display-settings";
import { LanguageSwitcher } from "@/components/language-switcher";
import { BillingSettingsView } from "@/components/console/billing-settings-view";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Environment, Project } from "@/lib/types";
import type { Snapshot } from "@/lib/console/console-snapshot";

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
    case "overview": return <ProductPreview service="Der Metrik-Dienst"><OverviewView snapshot={props.snapshot} project={props.project} navigate={props.navigate}/></ProductPreview>;
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
    case "backups": return <BackupsView projectId={props.project.id} environment={props.environment}/>;
    case "db-backups-pitr": return <PitrView projectId={props.project.id} environment={props.environment}/>;
    case "db-backups-restore": return <RestoreToNewProjectView projectId={props.project.id} environment={props.environment}/>;
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
    case "int-graphql": return <IntegrationsGraphqlView projectId={props.project.id} environment={props.environment}/>;
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
    // Die letzten drei Platzhalter der Einstellungen (2.88). Jede Seite sagt
    // zuerst, was es nicht gibt und warum, und zeigt dann eine echte Lesung:
    // den Provisionierungsauftrag, die sieben fremden Dienste, den ganzen
    // Katalog der abrechenbaren Metriken.
    case "set-compute": return <ProvisioningOrderView projectId={props.project.id} environment={props.environment}/>;
    case "set-integrations": return <IntegrationsServicesView projectId={props.project.id} environment={props.environment}/>;
    case "set-addons": return <AddonsView projectId={props.project.id} environment={props.environment}/>;
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
    // Drei Platzhalter, die Logs versprachen, die es nicht gibt (2.84). Jede
    // Seite sagt zuerst, was fehlt und warum, und zeigt dann eine echte
    // Lesung: die Einsatzhistorie, den Zaehler der Anfragen, die Verbindungen
    // aus pg_stat_activity.
    case "compute-logs": return <FunctionContainerLogView projectId={props.project.id} environment={props.environment}/>;
    case "logs-api": return <ApiGatewayLogView projectId={props.project.id} environment={props.environment}/>;
    case "logs-pooler": return <PoolerLogView projectId={props.project.id} environment={props.environment}/>;
    case "logs-realtime": return <RealtimeLogView projectId={props.project.id} environment={props.environment}/>;
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

function viewTitle(view: ViewId): string {
  const group = groupOf(view);
  const child = group.children?.find((entry) => entry.id === view);
  return child && child.label !== group.label ? `${t(group.label)} · ${t(child.label)}` : t(group.label);
}

function ProductPreview({ service, children }: { service: string; children: React.ReactNode }) {
  return <><div className="product-preview-notice"><Blocks size={16}/><div><strong>{t("Vorschau")}</strong><span>{service} ist noch nicht verbunden. Diese Ansicht zeigt, was der Projektdatensatz hergibt.</span></div></div>{children}</>;
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

function AIBridge({ projectId, environment, reload, navigate }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void }) {
  const [prompt,setPrompt]=useState("Lies das Schema und bereite einen Index auf orders.created_at vor. Wende ihn nicht an."); const [creating,setCreating]=useState(false); const [done,setDone]=useState(false);
  async function create(){setCreating(true); const response=await fetch("/api/v1/changesets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,environment,title:t("Index auf orders nach Erstellzeit"),statement:"CREATE INDEX orders_created_at_idx ON orders (created_at DESC)"})}); setCreating(false); if(response.ok){setDone(true);await reload();}}
  return <div className="ai-console-grid"><article className="console-card connection-card placeholder-state"><Bot size={26}/><div><span className="console-kicker">{t("Agenten")}</span><h3>{t("Noch keine Verbindung")}</h3><p>{t("Der OAuth-Weg, über den sich Claude Code oder Codex an dieses Projekt binden, ist noch nicht verbunden. Bis dahin zeigt diese Karte keine erfundenen Agenten.")}</p></div><button className="button small is-placeholder" disabled title={t("Agentenverbindungen sind noch nicht verbunden")}><Plus size={14}/> {t("Verbinden")}</button></article><article className="console-card workspace-card"><div className="card-head"><div><span>{t("AGENTEN-ARBEITSBEREICH")}</span><h3>{t("Eine Änderung vorbereiten")}</h3></div><span className={`environment-select ${environment}`}>{environment}</span></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} aria-label={t("Aufgabe für den Agenten")}/><div className="workspace-scope"><ShieldCheck size={14}/><span>{t("Der Agent liest das Schema und erstellt Vorschauen. Freigabe und Einreihung folgen der Regel des Projekts: manuell, abgesichert oder autonom. Geheimnisse bleiben verborgen.")}</span></div><button className="button" onClick={create} disabled={creating}><StableLabel current={creating?t("Wird vorbereitet…"):t("Vorschau erstellen")} variants={tAll("Wird vorbereitet…", "Vorschau erstellen")}/><ArrowIcon/></button>{done&&<div className="inline-success"><CheckIcon/>{t("Change Set erstellt.")} <button onClick={()=>navigate("approvals")}>{t("Freigabezentrale öffnen")}</button></div>}</article><article className="console-card span-2 mcp-config"><div className="card-head"><div><span>{t("CODEX-KONFIGURATION")}</span><h3>{t("Streamable HTTP, an das Projekt gebunden")}</h3></div><span className="muted">{t("Beispiel")}</span></div><pre>{`[mcp_servers.qkern]\nurl = "https://mcp.example.qkern.ch/mcp"\nauth = "oauth"\nrequired = true\nenabled_tools = ["qkern_project_get", "qkern_schema_list", "qkern_query_readonly", "qkern_migration_preview"]\ndefault_tools_approval_mode = "writes"`}</pre><p>{t("OAuth muss die MCP-Session an Akteur, Organisation, Projekt, Umgebung und Werkzeug-Scopes binden. Die URL oben ist ein Beispiel.")}</p></article></div>;
}

function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: ViewId) => void }){const [query,setQuery]=useState("");const matches=NAV_ENTRIES.filter(item=>`${item.group} ${item.label} ${t(item.group)} ${t(item.label)}`.toLowerCase().includes(query.toLowerCase())).slice(0,12);return <div className="command-overlay" onMouseDown={onClose}><div className="command-palette" onMouseDown={e=>e.stopPropagation()}><div className="command-input"><Search size={18}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("Console durchsuchen…")}/><button onClick={onClose}>ESC</button></div><div className="command-results"><span>{t("NAVIGATION")}</span>{matches.map(item=>{const Icon=groupOf(item.id).icon;return <button key={`${item.group}-${item.id}`} onClick={()=>{onNavigate(item.id);onClose();}}><Icon size={16}/>{item.group===item.label?t(item.label):`${t(item.group)} · ${t(item.label)}`}<Command size={13}/></button>})}</div></div></div>}
function LoadingState(){return <div className="loading-grid">{Array.from({length:8}).map((_,i)=><i key={i}/>)}</div>}
function ArrowIcon(){return <span aria-hidden>→</span>}
