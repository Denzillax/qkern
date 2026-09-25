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
  "db-migrations", "compute-invocations", "realtime-inspector", "db-triggers", "db-functions", "db-indexes", "db-policies", "db-types",
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
  "db-schemas": { label: "Schema-Visualizer", supabase: "Database → Schema Visualizer", backend: "teilweise", note: "Tabellen und Beziehungen als Diagramm. Die Schema-Route liefert Tabellen und Spalten schon, die Fremdschlüssel und das Diagramm fehlen." },
  "db-tables": { label: "Tabellen", supabase: "Database → Tables", backend: "teilweise", note: "Tabellen anlegen, umbenennen, Spalten ändern. Lesen geht über den Table Editor; Schemaänderungen laufen über Change Sets und die Freigabezentrale." },
  "db-extensions": { label: "Erweiterungen", supabase: "Database → Extensions", backend: "fehlt", note: "PostgreSQL-Erweiterungen ein- und ausschalten. Welche Erweiterungen der Projektdatenbank erlaubt sind, entscheidet heute allein die Migration." },
  "db-publications": { label: "Publikationen", supabase: "Database → Publications", backend: "teilweise", note: "Welche Tabellen Änderungen nach aussen melden. Der Realtime-Change-Feed ist zertifiziert, die Auswahl je Tabelle fehlt in der Console." },
  "db-pipelines": { label: "Replikation", supabase: "Database → Replication", backend: "fehlt", note: "Daten in externe Ziele replizieren. Kein Backend, keine Ansicht." },
  "db-roles": { label: "Rollen", supabase: "Database → Roles", backend: "teilweise", note: "Datenbankrollen und ihre Rechte. QKERN trennt Runtime-, Auth-, Worker-, Provisioner- und Projekt-API-Rolle in der Migration; eine Verwaltung fehlt." },
  "db-column-privileges": { label: "Spaltenrechte", supabase: "Database → Column Privileges", backend: "teilweise", note: "Rechte je Spalte und Rolle. Sensible Spalten werden heute ausgeblendet; die Rechte selbst zeigt noch nichts an." },
  "db-backups-pitr": { label: "Point-in-time Recovery", supabase: "Database → Backups → PITR", backend: "fehlt", note: "Wiederherstellung auf einen Zeitpunkt. Braucht ein WAL-Archiv ausserhalb des Wegwerf-Stacks." },
  "db-backups-restore": { label: "In neues Projekt wiederherstellen", supabase: "Database → Backups → Restore to new project", backend: "fehlt", note: "Ein Backup in ein frisches Projekt einspielen. Kein Backend." },
  "db-settings": { label: "Datenbank-Einstellungen", supabase: "Database → Settings", backend: "fehlt", note: "Verbindungsdaten, Pooler, SSL-Zwang, Netzwerkbeschränkungen. Die Provisionierung ist noch nicht verbunden." },
  // Auth
  "auth-policies": { label: "Policies", supabase: "Authentication → Policies", backend: "teilweise", note: "RLS-Regeln aus Sicht der Anmeldung. Gleiche Lage wie unter Datenbank → Policies." },
  "auth-providers": { label: "Anmeldeverfahren", supabase: "Authentication → Sign In / Providers", backend: "vorhanden", note: "Passwort, Magic Link, TOTP und OIDC sind zertifiziert. Ein- und ausschalten je Verfahren geht noch nicht über die Console." },
  "auth-sessions": { label: "Sitzungen", supabase: "Authentication → Sessions", backend: "teilweise", note: "Laufende Sitzungen sehen und beenden. Sitzungen gibt es; eine Liste und ein Widerruf fehlen." },
  "auth-rate-limits": { label: "Rate Limits", supabase: "Authentication → Rate Limits", backend: "fehlt", note: "Grenzen für Anmeldungen, Mails und Token je Zeitfenster." },
  "auth-templates": { label: "E-Mail-Vorlagen", supabase: "Authentication → Emails → Templates", backend: "fehlt", note: "Texte für Bestätigung, Magic Link und Zurücksetzen. Mails gehen heute mit festem Text." },
  "auth-smtp": { label: "SMTP", supabase: "Authentication → Emails → SMTP Settings", backend: "teilweise", note: "Eigener Mailserver. SMTP ist gegen Mailpit zertifiziert; die Einstellung liegt in der Umgebung, nicht in der Console." },
  "auth-mfa": { label: "Mehrfaktor", supabase: "Authentication → Multi-Factor", backend: "teilweise", note: "TOTP mit Recovery-Codes ist zertifiziert. Erzwingen je Projekt und weitere Faktoren fehlen." },
  "auth-passkeys": { label: "Passkeys", supabase: "Authentication → Passkeys", backend: "fehlt", note: "Anmeldung mit WebAuthn statt Passwort, etwa per Fingerabdruck oder Sicherheitsschlüssel. Kein Backend." },
  "auth-url": { label: "URL-Konfiguration", supabase: "Authentication → URL Configuration", backend: "fehlt", note: "Site-URL und erlaubte Rücksprungziele für Magic Link und OIDC." },
  "auth-protection": { label: "Angriffsschutz", supabase: "Authentication → Attack Protection", backend: "fehlt", note: "Captcha, Passwortprüfung gegen bekannte Lecks, Bot-Abwehr." },
  "auth-hooks": { label: "Auth-Hooks", supabase: "Authentication → Hooks", backend: "fehlt", note: "Eigener Code bei Anmeldung, Token-Ausgabe oder Mailversand." },
  "auth-third-party": { label: "Fremde Anbieter", supabase: "Authentication → Third Party Auth", backend: "fehlt", note: "Token fremder Identitätsdienste akzeptieren, ohne eigene Nutzerkonten." },
  "auth-oauth-server": { label: "OAuth-Server", supabase: "Authentication → OAuth Server", backend: "fehlt", note: "QKERN selbst als OAuth-Anbieter für andere Apps. Für die AI Bridge vorgesehen, noch nicht gebaut." },
  "auth-audit": { label: "Audit-Log", supabase: "Authentication → Audit Logs", backend: "teilweise", note: "Anmeldungen, Fehlversuche, Widerrufe. Die Audit-Kette der Plattform gibt es; ein Auth-Auszug je Projekt fehlt." },
  "auth-performance": { label: "Auth-Leistung", supabase: "Authentication → Performance", backend: "fehlt", note: "Antwortzeiten und Fehlerraten der Anmeldung." },
  // Storage
  "storage-policies": { label: "Policies", supabase: "Storage → Policies", backend: "teilweise", note: "Lese- und Schreibregeln je Bucket. Die fünf Richtlinien gibt es; feinere Regeln je Pfad fehlen." },
  "storage-settings": { label: "Einstellungen", supabase: "Storage → Settings", backend: "teilweise", note: "Grössengrenzen, MIME-Liste, Aufbewahrung. Die Werte stehen am Bucket; eine Ansicht zum Ändern fehlt." },
  "storage-s3": { label: "S3-Zugang", supabase: "Storage → S3", backend: "fehlt", note: "S3-kompatible Schlüssel für fremde Werkzeuge. Intern spricht QKERN S3; ein Zugang nach aussen fehlt." },
  "storage-analytics": { label: "Analytics-Buckets", supabase: "Storage → Analytics", backend: "fehlt", note: "Spaltenorientierte Ablage für grosse Auswertungen (Iceberg)." },
  "storage-vectors": { label: "Vektor-Buckets", supabase: "Storage → Vectors", backend: "fehlt", note: "Ablage für Embeddings mit Ähnlichkeitssuche." },
  // Functions
  "compute-secrets": { label: "Secrets", supabase: "Edge Functions → Secrets", backend: "teilweise", note: "Geheimnisse für Functions. Referenzen auf den Vault gibt es; anlegen und lesen über die Console fehlt." },
  "compute-logs": { label: "Function-Logs", supabase: "Edge Functions → Logs", backend: "fehlt", note: "Ausgaben aus dem Container. Inhaltslogs bleiben heute im Container." },
  // Realtime
  "realtime-policies": { label: "Policies", supabase: "Realtime → Policies", backend: "teilweise", note: "Wer welchen Kanal lesen und schreiben darf." },
  "realtime-settings": { label: "Einstellungen", supabase: "Realtime → Settings", backend: "fehlt", note: "Grenzen für Verbindungen und Nachrichten je Sekunde." },
  // Advisors
  "advisors-security": { label: "Sicherheit", supabase: "Advisors → Security Advisor", backend: "fehlt", note: "Automatische Prüfung: Tabellen ohne RLS, offene Buckets, schwache Regeln." },
  "advisors-performance": { label: "Leistung", supabase: "Advisors → Performance Advisor", backend: "fehlt", note: "Fehlende Indizes, langsame Abfragen, unbenutzte Indizes." },
  "advisors-health": { label: "Projekt-Gesundheit", supabase: "Advisors → Health", backend: "fehlt", note: "Zustand aller Dienste eines Projekts auf einer Seite." },
  // Berichte
  "obs-api": { label: "API", supabase: "Observability → API", backend: "teilweise", note: "Anfragen, Fehler und Antwortzeiten der Data API. Der Zähler für API-Anfragen meldet; Zeitreihen fehlen." },
  "obs-auth": { label: "Auth", supabase: "Observability → Auth", backend: "fehlt", note: "Anmeldungen, Fehlversuche und ausgegebene Token über die Zeit. Kein Zähler dafür." },
  "obs-storage": { label: "Storage", supabase: "Observability → Storage", backend: "teilweise", note: "Belegung und Zugriffe. Der Storage-Zähler meldet; der Verlauf fehlt." },
  "obs-database": { label: "Datenbank", supabase: "Observability → Database", backend: "fehlt", note: "Auslastung, Verbindungen, Cache-Trefferquote." },
  "obs-realtime": { label: "Realtime", supabase: "Observability → Realtime", backend: "fehlt", note: "Verbindungen und Nachrichten über die Zeit." },
  "obs-functions": { label: "Functions", supabase: "Observability → Edge Functions", backend: "teilweise", note: "Aufrufe und Fehler. Der Zähler meldet; der Verlauf fehlt." },
  "obs-query-performance": { label: "Abfrage-Leistung", supabase: "Observability → Query Performance", backend: "fehlt", note: "Die teuersten Abfragen nach Zeit und Häufigkeit (pg_stat_statements)." },
  "obs-query-insights": { label: "Abfrage-Einblicke", supabase: "Observability → Query Insights", backend: "fehlt", note: "Erklärungen zu einzelnen Abfrageplänen: welcher Index greift, wo der Plan teuer wird." },
  "obs-connections": { label: "Verbindungen", supabase: "Observability → Connections", backend: "fehlt", note: "Offene Verbindungen je Rolle und Quelle." },
  // Logs
  "logs-api": { label: "API-Gateway", supabase: "Logs → API Gateway", backend: "fehlt", note: "Jede Anfrage am Rand mit Status und Dauer." },
  "logs-postgres": { label: "Postgres", supabase: "Logs → Postgres", backend: "fehlt", note: "Das Serverlog der Projektdatenbank: Verbindungen, Fehler, langsame Statements." },
  "logs-postgrest": { label: "Data API", supabase: "Logs → PostgREST", backend: "fehlt", note: "Log der generierten Data API: jede Anfrage mit Rolle, Tabelle und Antwortzeit." },
  "logs-auth": { label: "Auth", supabase: "Logs → Auth", backend: "fehlt", note: "Log des Anmeldedienstes: Anmeldungen, Magic Links, TOTP-Prüfungen, Fehlversuche." },
  "logs-storage": { label: "Storage", supabase: "Logs → Storage", backend: "fehlt", note: "Uploads, Downloads und Scanner-Urteile je Objekt, mit Bucket und Richtlinie." },
  "logs-realtime": { label: "Realtime", supabase: "Logs → Realtime", backend: "fehlt", note: "Verbindungen, Kanäle und Nachrichten des Realtime-Transports über die Zeit." },
  "logs-functions": { label: "Functions", supabase: "Logs → Edge Functions", backend: "fehlt", note: "Start, Ende und Fehler je Function-Aufruf, mit Dauer und Ausgangsverbindungen." },
  "logs-pooler": { label: "Pooler", supabase: "Logs → Pooler", backend: "fehlt", note: "Log des Verbindungspools: Warteschlange, abgewiesene Verbindungen, Grenzen." },
  "logs-cron": { label: "Cron", supabase: "Logs → Cron", backend: "teilweise", note: "Jede Einreihung mit Dedupe-Schlüssel. Der Cron-Prozess ist zertifiziert; ein Log je Lauf fehlt in der Console." },
  "logs-explorer": { label: "Log-Explorer", supabase: "Logs → Explorer", backend: "fehlt", note: "Logs mit SQL durchsuchen, speichern, als Vorlage ablegen." },
  // Integrationen
  "int-cron": { label: "Cron", supabase: "Integrations → Cron", backend: "vorhanden", note: "Läuft unter Functions & Jobs. Hier nur der Einstieg, wie bei Supabase." },
  "int-vault": { label: "Vault", supabase: "Integrations → Vault", backend: "teilweise", note: "Geheimnisse verwalten. Webhook-Signaturen liegen im Vault und sind zertifiziert; eine Verwaltung fehlt." },
  "int-wrappers": { label: "Wrappers", supabase: "Integrations → Wrappers", backend: "fehlt", note: "Fremde Datenquellen als Tabellen einbinden (Foreign Data Wrappers)." },
  "int-graphql": { label: "GraphQL", supabase: "Integrations → GraphiQL", backend: "fehlt", note: "GraphQL-Schnittstelle über dem Schema. Die Data API ist REST." },
  "int-webhooks": { label: "Datenbank-Webhooks", supabase: "Integrations → Database Webhooks", backend: "teilweise", note: "Webhooks bei Tabellenänderungen. Ausgehende Webhooks sind zertifiziert; die Kopplung an Tabellen-Trigger fehlt." },
  // Branches
  "branches": { label: "Branches", supabase: "Branches", backend: "teilweise", note: "Ein Zweig je Feature mit eigener Datenbank. QKERN hat Development, Staging und Production je Projekt; freie Zweige fehlen." },
  "branches-merge": { label: "Merge-Anfragen", supabase: "Branches → Merge Requests", backend: "fehlt", note: "Änderungen eines Zweigs prüfen und übernehmen. Change Sets und Freigaben decken den Prüfschritt schon ab." },
  // Einstellungen
  "set-compute": { label: "Compute und Disk", supabase: "Project Settings → Compute and Disk", backend: "fehlt", note: "Grösse der Instanz und der Platte. Die Provisionierung ist noch nicht verbunden." },
  "set-infrastructure": { label: "Infrastruktur", supabase: "Project Settings → Infrastructure", backend: "fehlt", note: "Region, Postgres-Version, Lese-Replikate." },
  "set-integrations": { label: "Integrationen", supabase: "Project Settings → Integrations", backend: "fehlt", note: "Verknüpfte Dienste wie Git-Hosting oder Deploy-Plattformen." },
  "set-addons": { label: "Add-ons", supabase: "Project Settings → Add Ons", backend: "fehlt", note: "Zusatzleistungen wie eigene Domain oder mehr Backups." },
  "set-api": { label: "Data API", supabase: "Project Settings → Data API", backend: "teilweise", note: "Freigegebene Schemata und Grenzen der Data API. Heute nur `public` mit RLS-Tabellen." },
  "set-api-keys": { label: "API-Keys", supabase: "Project Settings → API Keys", backend: "vorhanden", note: "Public und Service Keys gibt es unter API. Hier der Einstieg, wie bei Supabase." },
  "set-jwt": { label: "JWT-Schlüssel", supabase: "Project Settings → JWT Keys", backend: "teilweise", note: "Ed25519-JWKS ist online; Rotation über die Console fehlt." },
  "set-log-drains": { label: "Log-Drains", supabase: "Project Settings → Log Drains", backend: "fehlt", note: "Logs an fremde Ziele weiterleiten, etwa an einen Log-Dienst oder ein SIEM." },
  "set-webhooks": { label: "Dashboard-Webhooks", supabase: "Project Settings → Webhooks", backend: "fehlt", note: "Benachrichtigungen bei Ereignissen des Projekts selbst." },
  "set-billing": { label: "Abrechnung", supabase: "Project Settings → Billing / Usage", backend: "teilweise", note: "Nutzung, Preisblatt und Rechnungen stehen unter Nutzung & Limits. Keine Zahlungsanbindung." },
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
    { id: "database", label: "Übersicht" }, ph("db-schemas"), ph("db-tables"), { id: "db-functions", label: "Funktionen" }, { id: "db-triggers", label: "Trigger" },
    { id: "db-types", label: "Enum-Typen" }, ph("db-extensions"), { id: "db-indexes", label: "Indizes" }, ph("db-publications"), ph("db-pipelines"), ph("db-roles"),
    { id: "db-policies", label: "Policies" }, ph("db-column-privileges"), { id: "db-migrations", label: "Migrationen" }, { id: "backups", label: "Backups" },
    ph("db-backups-pitr"), ph("db-backups-restore"), ph("db-settings"),
  ] },
  { id: "auth", label: "Auth", icon: Fingerprint, children: [
    { id: "auth", label: "Nutzer" }, ph("auth-policies"), ph("auth-providers"), ph("auth-sessions"), ph("auth-rate-limits"),
    ph("auth-templates"), ph("auth-smtp"), ph("auth-mfa"), ph("auth-passkeys"), ph("auth-url"), ph("auth-protection"),
    ph("auth-hooks"), ph("auth-third-party"), ph("auth-oauth-server"), ph("auth-audit"), ph("auth-performance"),
  ] },
  { id: "storage", label: "Storage", icon: Cloud, children: [
    { id: "storage", label: "Buckets" }, ph("storage-policies"), ph("storage-settings"), ph("storage-s3"),
    ph("storage-analytics"), ph("storage-vectors"),
  ] },
  { id: "compute", label: "Functions & Jobs", icon: Webhook, children: [
    { id: "compute", label: "Functions, Cron, Webhooks" }, ph("compute-secrets"), { id: "compute-invocations", label: "Aufrufe" }, ph("compute-logs"),
  ] },
  { id: "realtime-inspector", label: "Realtime", icon: Radio, children: [{ id: "realtime-inspector", label: "Inspector" }, ph("realtime-policies"), ph("realtime-settings")] },
  { id: "api", label: "API", icon: Braces },
  { id: "ai", label: "AI Bridge", icon: Bot },
  { id: "activity", label: "KI-Aktivität", icon: Activity },
  { id: "approvals", label: "Freigabezentrale", icon: ShieldCheck },
  { id: "advisors-security", label: "Advisors", icon: Stethoscope, children: [ph("advisors-security"), ph("advisors-performance"), ph("advisors-health")] },
  { id: "obs-api", label: "Berichte", icon: BarChart3, children: [
    ph("obs-api"), ph("obs-auth"), ph("obs-storage"), ph("obs-database"), ph("obs-realtime"), ph("obs-functions"),
    ph("obs-query-performance"), ph("obs-query-insights"), ph("obs-connections"),
  ] },
  { id: "logs", label: "Logs", icon: FileClock, children: [
    { id: "logs", label: "Audit" }, ph("logs-api"), ph("logs-postgres"), ph("logs-postgrest"), ph("logs-auth"), ph("logs-storage"),
    ph("logs-realtime"), ph("logs-functions"), ph("logs-pooler"), ph("logs-cron"), ph("logs-explorer"),
  ] },
  { id: "monitoring", label: "Nutzung & Limits", icon: CircleGauge },
  { id: "int-queues", label: "Integrationen", icon: Plug, children: [
    { id: "int-queues", label: "Queues" }, ph("int-cron"), ph("int-vault"), ph("int-wrappers"), ph("int-graphql"), ph("int-webhooks"),
  ] },
  { id: "branches", label: "Branches", icon: GitBranch, children: [ph("branches"), ph("branches-merge")] },
  { id: "settings", label: "Einstellungen", icon: Settings, children: [
    { id: "settings", label: "Allgemein" }, ph("set-compute"), ph("set-infrastructure"), ph("set-integrations"), ph("set-addons"),
    ph("set-api"), ph("set-api-keys"), ph("set-jwt"), ph("set-log-drains"), ph("set-webhooks"), ph("set-billing"), ph("set-dashboard"),
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
