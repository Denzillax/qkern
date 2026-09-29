import {
  Activity, BarChart3, Bot, Braces, CircleGauge, Cloud, Database, FileClock,
  Fingerprint, GitBranch, LayoutDashboard, Plug, Radio, Settings, ShieldCheck, Stethoscope, Table2,
  Terminal, Webhook,
} from "lucide-react";

/**
 * Die Navigation der Console (2.0).
 *
 * Denzil wollte jeden Menüpunkt, den Supabase Studio hat, auch in QKERN
 * sehen, anfangs als Platzhalter, damit klar ist, was noch zu bauen ist.
 * Die Liste stammt aus dem Routen-Verzeichnis von Supabase Studio
 * (`apps/studio/pages/project/[ref]` im Repo supabase/supabase, Stand
 * 24. September 2026), nicht aus dem Gedächtnis.
 *
 * Seit 2.99 ist kein Platzhalter mehr übrig: Jeder Menüpunkt ist eine echte
 * Seite, und wo QKERN die Sache nicht hat, sagt die Seite das aus dem
 * Katalog, dem Repository oder der Datenbank heraus, statt es zu versprechen.
 * `PLACEHOLDERS` bleibt als leere Tabelle, damit die Verträge der Seiten
 * weiter fragen können, ob ein Eintrag ein Platzhalter ist; ein neuer
 * Menüpunkt, der noch keine Seite hat, kommt wieder hier hinein.
 */

export const REAL_VIEWS = [
  "overview", "database", "table", "sql", "auth", "storage", "compute", "api", "ai", "activity",
  "approvals", "logs", "monitoring", "backups", "settings", "int-queues",
  "db-migrations", "compute-invocations", "compute-secrets", "realtime-inspector", "db-triggers", "db-functions", "db-indexes", "db-policies", "db-types", "db-extensions", "db-roles", "db-publications", "db-column-privileges", "db-schemas", "int-cron", "set-api-keys", "auth-providers", "auth-sessions", "auth-audit", "set-jwt", "storage-policies", "storage-settings", "set-api", "set-billing", "advisors-security", "advisors-performance", "advisors-health", "logs-cron", "obs-api", "obs-storage", "obs-functions", "obs-database", "obs-connections", "realtime-policies", "realtime-settings", "db-tables", "obs-auth", "logs-auth", "logs-storage", "obs-realtime", "auth-mfa", "int-database-webhooks", "logs-functions", "logs-postgrest", "auth-url", "auth-smtp", "auth-templates", "int-vault", "auth-rate-limits", "db-backups-pitr", "db-settings", "auth-protection", "auth-policies", "sql-templates", "set-log-drains", "set-dashboard", "logs-explorer", "obs-query-performance", "set-infrastructure", "obs-query-insights", "auth-performance", "logs-postgres", "int-wrappers", "db-pipelines", "set-webhooks", "storage-s3", "auth-hooks", "auth-passkeys", "branches", "auth-third-party", "compute-logs", "logs-api", "logs-pooler", "int-graphql", "auth-oauth-server", "auth-oauth-consents", "db-backups-restore", "logs-realtime", "set-compute", "set-integrations", "set-addons", "storage-vectors", "storage-analytics",
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
  // Datenbank: "In neues Projekt wiederherstellen" ist seit 2.87 eine echte
  // Seite. Der Platzhalter sagte "Kein Backend", und das war zur Haelfte
  // falsch: Den Wiederherstellungslauf gibt es zertifiziert, es fehlt das
  // neue Projekt.
  // Auth: der OAuth-Server ist seit 2.82 eine echte Seite.
  // Storage
  // Analytics-Buckets sind seit 2.99 eine echte Seite, die letzte, die ein
  // Platzhalter war. Der Platzhalter sagte "Backend fehlt", und das stimmte;
  // was genau fehlt (Katalog, Multipart am S3-Endpunkt, Engine), sagt die
  // Seite jetzt selbst, das Dritte aus dem Katalog des Servers.
  // Vektor-Buckets sind seit 2.93 eine echte Seite. Der Platzhalter sagte
  // "Backend fehlt", und das war zu freundlich: Was fehlt, ist der Vektortyp
  // im Server, und ohne ihn hilft auch ein Backend nichts.
  // `postgres:17-alpine` bietet die Erweiterung `vector` nicht an, und Alpines
  // Paket dafuer ist gegen PostgreSQL 18 gebaut, nicht gegen den Server im Image.
  // Functions
  // Function-Logs sind seit 2.84 eine echte Seite: Die Ausgabe des Containers
  // gibt es nicht, und die Seite sagt, warum, statt darauf zu warten.
  // Realtime
  // Berichte
  // Logs
  // API-Gateway und Pooler sind seit 2.84 echte Seiten. Beide Male fehlt nicht
  // das Backend, sondern die Sache selbst: kein Rand, der protokolliert, und
  // kein Pooler zwischen Anwendung und Datenbank.
  // Realtime ist seit 2.86 eine echte Seite: Kanäle und Nachrichten stehen
  // dauerhaft in der Kontrollebene, der Rückstand des Änderungs-Feeds wird
  // gezählt, und Verbindungen führt niemand auf.
  // Integrationen
  // Branches: beide Platzhalter sind seit 2.81 eine echte Seite.
  // Einstellungen
  // Compute und Disk, Integrationen und Add-ons sind seit 2.88 echte Seiten,
  // und mit ihnen sind die letzten Platzhalter der Einstellungen weg. Alle
  // drei hatten mehr versprochen, als es gibt, und dreimal anders: Die
  // Provisionierung ist gebaut, aber sie bestellt keine Groesse; verknuepfte
  // Dienste gibt es, nur andere als Git-Hosting und Deploy-Plattformen; und
  // eine Zusatzleistung ist in der Abrechnung nicht ausdrueckbar.
} as const satisfies Record<string, Placeholder>;

export type PlaceholderId = keyof typeof PLACEHOLDERS;
export type ViewId = RealViewId | PlaceholderId;

export type NavChild = { id: ViewId; label: string };
export type NavGroup = { id: ViewId; label: string; icon: typeof Database; children?: NavChild[] };

export const NAV: NavGroup[] = [
  { id: "overview", label: "Übersicht", icon: LayoutDashboard },
  { id: "table", label: "Table Editor", icon: Table2 },
  { id: "sql", label: "SQL Editor", icon: Terminal, children: [{ id: "sql", label: "Editor" }, { id: "sql-templates", label: "Vorlagen" }] },
  { id: "database", label: "Datenbank", icon: Database, children: [
    { id: "database", label: "Übersicht" }, { id: "db-schemas", label: "Schema-Visualizer" }, { id: "db-tables", label: "Tabellen" }, { id: "db-functions", label: "Funktionen" }, { id: "db-triggers", label: "Trigger" },
    { id: "db-types", label: "Enum-Typen" }, { id: "db-extensions", label: "Erweiterungen" }, { id: "db-indexes", label: "Indizes" }, { id: "db-publications", label: "Publikationen" }, { id: "db-pipelines", label: "Replikation" }, { id: "db-roles", label: "Rollen" },
    { id: "db-policies", label: "Policies" }, { id: "db-column-privileges", label: "Spaltenrechte" }, { id: "db-migrations", label: "Migrationen" }, { id: "backups", label: "Backups" },
    { id: "db-backups-pitr", label: "Point-in-time Recovery" }, { id: "db-backups-restore", label: "In neues Projekt wiederherstellen" }, { id: "db-settings", label: "Datenbank-Einstellungen" },
  ] },
  { id: "auth", label: "Auth", icon: Fingerprint, children: [
    { id: "auth", label: "Nutzer" }, { id: "auth-policies", label: "Policies" }, { id: "auth-providers", label: "Anmeldeverfahren" }, { id: "auth-sessions", label: "Sitzungen" }, { id: "auth-rate-limits", label: "Rate Limits" },
    { id: "auth-templates", label: "E-Mail-Vorlagen" }, { id: "auth-smtp", label: "SMTP" }, { id: "auth-mfa", label: "Mehrfaktor" }, { id: "auth-passkeys", label: "Passkeys" }, { id: "auth-url", label: "URL-Konfiguration" }, { id: "auth-protection", label: "Passwortschutz" },
    { id: "auth-hooks", label: "Auth-Hooks" }, { id: "auth-third-party", label: "Fremde Anbieter" }, { id: "auth-oauth-server", label: "OAuth-Server" }, { id: "auth-oauth-consents", label: "Zustimmungen" }, { id: "auth-audit", label: "Audit-Log" }, { id: "auth-performance", label: "Auth-Leistung" },
  ] },
  { id: "storage", label: "Storage", icon: Cloud, children: [
    { id: "storage", label: "Buckets" }, { id: "storage-policies", label: "Policies" }, { id: "storage-settings", label: "Einstellungen" }, { id: "storage-s3", label: "S3-Zugang" },
    { id: "storage-analytics", label: "Analytics-Buckets" }, { id: "storage-vectors", label: "Vektor-Buckets" },
  ] },
  { id: "compute", label: "Functions & Jobs", icon: Webhook, children: [
    { id: "compute", label: "Functions, Cron, Webhooks" }, { id: "compute-secrets", label: "Secrets" }, { id: "compute-invocations", label: "Aufrufe" }, { id: "compute-logs", label: "Function-Logs" },
  ] },
  { id: "realtime-inspector", label: "Realtime", icon: Radio, children: [{ id: "realtime-inspector", label: "Inspector" }, { id: "realtime-policies", label: "Rechte" }, { id: "realtime-settings", label: "Einstellungen" }] },
  { id: "api", label: "API", icon: Braces },
  { id: "ai", label: "AI Bridge", icon: Bot },
  { id: "activity", label: "KI-Aktivität", icon: Activity },
  { id: "approvals", label: "Freigabezentrale", icon: ShieldCheck },
  { id: "advisors-security", label: "Advisors", icon: Stethoscope, children: [{ id: "advisors-security", label: "Sicherheit" }, { id: "advisors-performance", label: "Leistung" }, { id: "advisors-health", label: "Gesundheit" }] },
  { id: "obs-api", label: "Berichte", icon: BarChart3, children: [
    { id: "obs-api", label: "API" }, { id: "obs-auth", label: "Auth" }, { id: "obs-storage", label: "Storage" }, { id: "obs-database", label: "Datenbank" }, { id: "obs-realtime", label: "Realtime" }, { id: "obs-functions", label: "Functions" },
    { id: "obs-query-performance", label: "Abfrage-Leistung" }, { id: "obs-query-insights", label: "Abfrage-Einblicke" }, { id: "obs-connections", label: "Verbindungen" },
  ] },
  { id: "logs", label: "Logs", icon: FileClock, children: [
    { id: "logs", label: "Audit" }, { id: "logs-api", label: "API-Gateway" }, { id: "logs-postgres", label: "Postgres-Zustand" }, { id: "logs-postgrest", label: "Data API" }, { id: "logs-auth", label: "Auth" }, { id: "logs-storage", label: "Storage" },
    { id: "logs-realtime", label: "Realtime" }, { id: "logs-functions", label: "Functions" }, { id: "logs-pooler", label: "Pooler" }, { id: "logs-cron", label: "Cron" }, { id: "logs-explorer", label: "Explorer" },
  ] },
  { id: "monitoring", label: "Nutzung & Limits", icon: CircleGauge },
  { id: "int-queues", label: "Integrationen", icon: Plug, children: [
    { id: "int-queues", label: "Queues" }, { id: "int-cron", label: "Cron" }, { id: "int-vault", label: "Vault" }, { id: "int-wrappers", label: "Wrappers" }, { id: "int-graphql", label: "GraphQL" }, { id: "int-database-webhooks", label: "Datenbank-Webhooks" },
  ] },
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "settings", label: "Einstellungen", icon: Settings, children: [
    { id: "settings", label: "Allgemein" }, { id: "set-compute", label: "Compute und Disk" }, { id: "set-infrastructure", label: "Infrastruktur" }, { id: "set-integrations", label: "Integrationen" }, { id: "set-addons", label: "Add-ons" },
    { id: "set-api", label: "Data API" }, { id: "set-api-keys", label: "API-Keys" }, { id: "set-jwt", label: "JWT-Schlüssel" }, { id: "set-log-drains", label: "Log-Drains" }, { id: "set-webhooks", label: "Dashboard-Webhooks" }, { id: "set-billing", label: "Abrechnung" }, { id: "set-dashboard", label: "Dashboard" },
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
