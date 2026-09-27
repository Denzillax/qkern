import {
  Activity, BarChart3, Bot, Braces, CircleGauge, Cloud, Database, FileClock,
  Fingerprint, GitBranch, LayoutDashboard, Plug, Radio, Settings, ShieldCheck, Stethoscope, Table2,
  Terminal, Webhook,
} from "lucide-react";

/**
 * Die Navigation der Console (2.0).
 *
 * Denzil wollte jeden Menüpunkt, den Supabase Studio hat, auch in QKERN
 * sehen — vorerst als Platzhalter, damit klar ist, was noch zu bauen ist.
 * Die Liste stammt aus dem Routen-Verzeichnis von Supabase Studio
 * (`apps/studio/pages/project/[ref]` im Repo supabase/supabase, Stand
 * 24. September 2026), nicht aus dem Gedächtnis.
 *
 * Jeder Platzhalter sagt drei Dinge: wie die Seite bei Supabase heisst, was
 * QKERN dazu im Backend schon hat, und was fehlt. Nichts davon ist
 * verbunden; die Ansicht zeigt keine erfundenen Daten.
 */

export const REAL_VIEWS = [
  "overview", "database", "table", "sql", "auth", "storage", "compute", "api", "ai", "activity",
  "approvals", "logs", "monitoring", "backups", "settings", "int-queues",
  "db-migrations", "compute-invocations", "compute-secrets", "realtime-inspector", "db-triggers", "db-functions", "db-indexes", "db-policies", "db-types", "db-extensions", "db-roles", "db-publications", "db-column-privileges", "db-schemas", "int-cron", "set-api-keys", "auth-providers", "auth-sessions", "auth-audit", "set-jwt", "storage-policies", "storage-settings", "set-api", "set-billing", "advisors-security", "advisors-performance", "advisors-health", "logs-cron", "obs-api", "obs-storage", "obs-functions", "obs-database", "obs-connections", "realtime-policies", "realtime-settings", "db-tables", "obs-auth", "logs-auth", "logs-storage", "obs-realtime", "auth-mfa", "int-database-webhooks", "logs-functions", "logs-postgrest", "auth-url", "auth-smtp", "auth-templates", "int-vault", "auth-rate-limits", "db-backups-pitr", "db-settings", "auth-protection", "set-log-drains",
] as const;
export type RealViewId = (typeof REAL_VIEWS)[number];

export type Backend = "vorhanden" | "teilweise" | "fehlt";

export type Placeholder = {
  label: string;
  supabase: string;
  backend: Backend;
  note: string;
};

export const PLACEHOLDERS = {
  // SQL Editor
  "sql-templates": { label: "Vorlagen", supabase: "SQL Editor → Templates", backend: "fehlt", note: "Fertige Abfragen zum Einfügen, etwa für Indizes, Rollen oder Statistiken. Der SQL Editor selbst läuft schon lesend gegen die Projektdatenbank." },
  // Datenbank
  "db-pipelines": { label: "Replikation", supabase: "Database → Replication", backend: "fehlt", note: "Daten in externe Ziele replizieren. Kein Backend, keine Ansicht." },
  "db-backups-restore": { label: "In neues Projekt wiederherstellen", supabase: "Database → Backups → Restore to new project", backend: "fehlt", note: "Ein Backup in ein frisches Projekt einspielen. Kein Backend." },
  // Auth
  "auth-policies": { label: "Policies", supabase: "Authentication → Policies", backend: "teilweise", note: "RLS-Regeln aus Sicht der Anmeldung. Gleiche Lage wie unter Datenbank → Policies." },
      "auth-passkeys": { label: "Passkeys", supabase: "Authentication → Passkeys", backend: "fehlt", note: "Anmeldung mit WebAuthn statt Passwort, etwa per Fingerabdruck oder Sicherheitsschlüssel. Kein Backend." },
  "auth-hooks": { label: "Auth-Hooks", supabase: "Authentication → Hooks", backend: "fehlt", note: "Eigener Code bei Anmeldung, Token-Ausgabe oder Mailversand." },
  "auth-third-party": { label: "Fremde Anbieter", supabase: "Authentication → Third Party Auth", backend: "fehlt", note: "Token fremder Identitätsdienste akzeptieren, ohne eigene Nutzerkonten." },
  "auth-oauth-server": { label: "OAuth-Server", supabase: "Authentication → OAuth Server", backend: "fehlt", note: "QKERN selbst als OAuth-Anbieter für andere Apps. Für die AI Bridge vorgesehen, noch nicht gebaut." },
  "auth-performance": { label: "Auth-Leistung", supabase: "Authentication → Performance", backend: "fehlt", note: "Antwortzeiten und Fehlerraten der Anmeldung." },
  // Storage
  "storage-s3": { label: "S3-Zugang", supabase: "Storage → S3", backend: "fehlt", note: "S3-kompatible Schlüssel für fremde Werkzeuge. Intern spricht QKERN S3; ein Zugang nach aussen fehlt." },
  "storage-analytics": { label: "Analytics-Buckets", supabase: "Storage → Analytics", backend: "fehlt", note: "Spaltenorientierte Ablage für grosse Auswertungen (Iceberg)." },
  "storage-vectors": { label: "Vektor-Buckets", supabase: "Storage → Vectors", backend: "fehlt", note: "Ablage für Embeddings mit Ähnlichkeitssuche." },
  // Functions
  "compute-logs": { label: "Function-Logs", supabase: "Edge Functions → Logs", backend: "fehlt", note: "Ausgaben aus dem Container. Inhaltslogs bleiben heute im Container." },
  // Realtime
  // Berichte
  "obs-query-performance": { label: "Abfrage-Leistung", supabase: "Observability → Query Performance", backend: "fehlt", note: "Die teuersten Abfragen nach Zeit und Häufigkeit (pg_stat_statements)." },
  "obs-query-insights": { label: "Abfrage-Einblicke", supabase: "Observability → Query Insights", backend: "fehlt", note: "Erklärungen zu einzelnen Abfrageplänen: welcher Index greift, wo der Plan teuer wird." },
  // Logs
  "logs-api": { label: "API-Gateway", supabase: "Logs → API Gateway", backend: "fehlt", note: "Jede Anfrage am Rand mit Status und Dauer." },
  "logs-postgres": { label: "Postgres", supabase: "Logs → Postgres", backend: "fehlt", note: "Das Serverlog der Projektdatenbank: Verbindungen, Fehler, langsame Statements." },
  "logs-realtime": { label: "Realtime", supabase: "Logs → Realtime", backend: "fehlt", note: "Verbindungen, Kanäle und Nachrichten des Realtime-Transports über die Zeit." },
  "logs-pooler": { label: "Pooler", supabase: "Logs → Pooler", backend: "fehlt", note: "Log des Verbindungspools: Warteschlange, abgewiesene Verbindungen, Grenzen." },
  "logs-explorer": { label: "Log-Explorer", supabase: "Logs → Explorer", backend: "fehlt", note: "Logs mit SQL durchsuchen, speichern, als Vorlage ablegen." },
  // Integrationen
  "int-wrappers": { label: "Wrappers", supabase: "Integrations → Wrappers", backend: "fehlt", note: "Fremde Datenquellen als Tabellen einbinden (Foreign Data Wrappers)." },
  "int-graphql": { label: "GraphQL", supabase: "Integrations → GraphiQL", backend: "fehlt", note: "GraphQL-Schnittstelle über dem Schema. Die Data API ist REST." },
  // Branches
  "branches": { label: "Branches", supabase: "Branches", backend: "teilweise", note: "Ein Zweig je Feature mit eigener Datenbank. QKERN hat Development, Staging und Production je Projekt; freie Zweige fehlen." },
  "branches-merge": { label: "Merge-Anfragen", supabase: "Branches → Merge Requests", backend: "fehlt", note: "Änderungen eines Zweigs prüfen und übernehmen. Change Sets und Freigaben decken den Prüfschritt schon ab." },
  // Einstellungen
  "set-compute": { label: "Compute und Disk", supabase: "Project Settings → Compute and Disk", backend: "fehlt", note: "Grösse der Instanz und der Platte. Die Provisionierung ist noch nicht verbunden." },
  "set-infrastructure": { label: "Infrastruktur", supabase: "Project Settings → Infrastructure", backend: "fehlt", note: "Region, Postgres-Version, Lese-Replikate." },
  "set-integrations": { label: "Integrationen", supabase: "Project Settings → Integrations", backend: "fehlt", note: "Verknüpfte Dienste wie Git-Hosting oder Deploy-Plattformen." },
  "set-addons": { label: "Add-ons", supabase: "Project Settings → Add Ons", backend: "fehlt", note: "Zusatzleistungen wie eigene Domain oder mehr Backups." },
  "set-webhooks": { label: "Dashboard-Webhooks", supabase: "Project Settings → Webhooks", backend: "fehlt", note: "Benachrichtigungen bei Ereignissen des Projekts selbst." },
  "set-dashboard": { label: "Dashboard", supabase: "Project Settings → Dashboard", backend: "fehlt", note: "Darstellung der Console selbst, etwa Zeitzone und Startseite." },
} as const satisfies Record<string, Placeholder>;

export type PlaceholderId = keyof typeof PLACEHOLDERS;
export type ViewId = RealViewId | PlaceholderId;

export type NavChild = { id: ViewId; label: string };
export type NavGroup = { id: ViewId; label: string; icon: typeof Database; children?: NavChild[] };

const ph = (id: PlaceholderId): NavChild => ({ id, label: PLACEHOLDERS[id].label });

export const NAV: NavGroup[] = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboard },
  { id: "table", label: "Table Editor", icon: Table2 },
  { id: "sql", label: "SQL Editor", icon: Terminal, children: [{ id: "sql", label: "Editor" }, ph("sql-templates")] },
  { id: "database", label: "Datenbank", icon: Database, children: [
    { id: "database", label: "Übersicht" }, { id: "db-schemas", label: "Schema-Visualizer" }, { id: "db-tables", label: "Tabellen" }, { id: "db-functions", label: "Funktionen" }, { id: "db-triggers", label: "Trigger" },
    { id: "db-types", label: "Enum-Typen" }, { id: "db-extensions", label: "Erweiterungen" }, { id: "db-indexes", label: "Indizes" }, { id: "db-publications", label: "Publikationen" }, ph("db-pipelines"), { id: "db-roles", label: "Rollen" },
    { id: "db-policies", label: "Policies" }, { id: "db-column-privileges", label: "Spaltenrechte" }, { id: "db-migrations", label: "Migrationen" }, { id: "backups", label: "Backups" },
    { id: "db-backups-pitr", label: "Point-in-time Recovery" }, ph("db-backups-restore"), { id: "db-settings", label: "Datenbank-Einstellungen" },
  ] },
  { id: "auth", label: "Auth", icon: Fingerprint, children: [
    { id: "auth", label: "Nutzer" }, ph("auth-policies"), { id: "auth-providers", label: "Anmeldeverfahren" }, { id: "auth-sessions", label: "Sitzungen" }, { id: "auth-rate-limits", label: "Rate Limits" },
    { id: "auth-templates", label: "E-Mail-Vorlagen" }, { id: "auth-smtp", label: "SMTP" }, { id: "auth-mfa", label: "Mehrfaktor" }, ph("auth-passkeys"), { id: "auth-url", label: "URL-Konfiguration" }, { id: "auth-protection", label: "Passwortschutz" },
    ph("auth-hooks"), ph("auth-third-party"), ph("auth-oauth-server"), { id: "auth-audit", label: "Audit-Log" }, ph("auth-performance"),
  ] },
  { id: "storage", label: "Storage", icon: Cloud, children: [
    { id: "storage", label: "Buckets" }, { id: "storage-policies", label: "Policies" }, { id: "storage-settings", label: "Einstellungen" }, ph("storage-s3"),
    ph("storage-analytics"), ph("storage-vectors"),
  ] },
  { id: "compute", label: "Functions & Jobs", icon: Webhook, children: [
    { id: "compute", label: "Functions, Cron, Webhooks" }, { id: "compute-secrets", label: "Secrets" }, { id: "compute-invocations", label: "Aufrufe" }, ph("compute-logs"),
  ] },
  { id: "realtime-inspector", label: "Realtime", icon: Radio, children: [{ id: "realtime-inspector", label: "Inspector" }, { id: "realtime-policies", label: "Rechte" }, { id: "realtime-settings", label: "Einstellungen" }] },
  { id: "api", label: "API", icon: Braces },
  { id: "ai", label: "AI Bridge", icon: Bot },
  { id: "activity", label: "KI-Aktivität", icon: Activity },
  { id: "approvals", label: "Freigabezentrale", icon: ShieldCheck },
  { id: "advisors-security", label: "Advisors", icon: Stethoscope, children: [{ id: "advisors-security", label: "Sicherheit" }, { id: "advisors-performance", label: "Leistung" }, { id: "advisors-health", label: "Gesundheit" }] },
  { id: "obs-api", label: "Berichte", icon: BarChart3, children: [
    { id: "obs-api", label: "API" }, { id: "obs-auth", label: "Auth" }, { id: "obs-storage", label: "Storage" }, { id: "obs-database", label: "Datenbank" }, { id: "obs-realtime", label: "Realtime" }, { id: "obs-functions", label: "Functions" },
    ph("obs-query-performance"), ph("obs-query-insights"), { id: "obs-connections", label: "Verbindungen" },
  ] },
  { id: "logs", label: "Logs", icon: FileClock, children: [
    { id: "logs", label: "Audit" }, ph("logs-api"), ph("logs-postgres"), { id: "logs-postgrest", label: "Data API" }, { id: "logs-auth", label: "Auth" }, { id: "logs-storage", label: "Storage" },
    ph("logs-realtime"), { id: "logs-functions", label: "Functions" }, ph("logs-pooler"), { id: "logs-cron", label: "Cron" }, ph("logs-explorer"),
  ] },
  { id: "monitoring", label: "Nutzung & Limits", icon: CircleGauge },
  { id: "int-queues", label: "Integrationen", icon: Plug, children: [
    { id: "int-queues", label: "Queues" }, { id: "int-cron", label: "Cron" }, { id: "int-vault", label: "Vault" }, ph("int-wrappers"), ph("int-graphql"), { id: "int-database-webhooks", label: "Datenbank-Webhooks" },
  ] },
  { id: "branches", label: "Branches", icon: GitBranch, children: [ph("branches"), ph("branches-merge")] },
  { id: "settings", label: "Einstellungen", icon: Settings, children: [
    { id: "settings", label: "Allgemein" }, ph("set-compute"), ph("set-infrastructure"), ph("set-integrations"), ph("set-addons"),
    { id: "set-api", label: "Data API" }, { id: "set-api-keys", label: "API-Keys" }, { id: "set-jwt", label: "JWT-Schlüssel" }, { id: "set-log-drains", label: "Log-Drains" }, ph("set-webhooks"), { id: "set-billing", label: "Abrechnung" }, ph("set-dashboard"),
  ] },
];

/** Alle Einträge flach, für Suche und Titel. */
export const NAV_ENTRIES: Array<{ id: ViewId; label: string; group: string }> = NAV.flatMap((group) =>
  group.children
    ? group.children.map((child) => ({ id: child.id, label: child.label, group: group.label }))
    : [{ id: group.id, label: group.label, group: group.label }],
);

export function groupOf(view: ViewId): NavGroup {
  return NAV.find((group) => group.id === view || group.children?.some((child) => child.id === view)) ?? NAV[0];
}

export function labelOf(view: ViewId): string {
  const group = groupOf(view);
  const child = group.children?.find((entry) => entry.id === view);
  return child && child.label !== group.label ? `${group.label} · ${child.label}` : group.label;
}

export function isPlaceholder(view: ViewId): view is PlaceholderId {
  return view in PLACEHOLDERS;
}
