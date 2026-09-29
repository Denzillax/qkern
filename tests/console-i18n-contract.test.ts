import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { NAV, PLACEHOLDERS } from "@/components/console/navigation";
import { securityAdvisorTexts } from "@/lib/console/security-advisor-texts";
import { performanceAdvisorTexts } from "@/lib/console/performance-advisor-texts";
import { cronLogTexts } from "@/lib/console/cron-log-texts";
import { healthAdvisorTexts } from "@/lib/console/health-advisor-texts";
import { usageSeriesTexts } from "@/lib/console/usage-series-texts";
import { databaseActivityTexts } from "@/lib/console/database-activity-texts";
import { realtimeTexts } from "@/lib/console/realtime-texts";
import { tableChangeSetTexts } from "@/lib/console/table-change-sets";
import { authObservabilityTexts } from "@/lib/console/auth-observability-texts";
import { storageLogTexts } from "@/lib/console/storage-log-texts";
import { authMfaTexts } from "@/lib/console/auth-mfa-texts";
import { authSettingsTexts } from "@/lib/console/auth-settings-texts";
import { databaseWebhookTexts } from "@/lib/console/database-webhooks";
import { logViewTexts } from "@/lib/console/log-view-texts";
import { vaultOverviewTexts } from "@/lib/console/vault-overview-texts";
import { authRateLimitTexts } from "@/lib/console/auth-rate-limits-texts";
import { pointInTimeTexts } from "@/lib/console/point-in-time-texts";
import { databaseSettingsTexts } from "@/lib/console/database-settings-texts";
import { authProtectionTexts } from "@/lib/console/auth-protection-texts";
import { authPoliciesTexts } from "@/lib/console/auth-policies-texts";
import { sqlTemplateTexts } from "@/lib/console/sql-templates";
import { logDrainTexts } from "@/lib/console/log-drains";
import { dashboardWebhookTexts } from "@/lib/console/dashboard-webhooks";
import { displaySettingsTexts } from "@/lib/console/display-settings-texts";
import { logExplorerTexts } from "@/lib/console/log-explorer";
import { queryPerformanceTexts } from "@/lib/console/query-performance-texts";
import { infrastructureTexts } from "@/lib/console/infrastructure-texts";
import { queryInsightsTexts } from "@/lib/console/query-insights";
import { authPerformanceTexts } from "@/lib/console/auth-performance-texts";
import { databaseHealthTexts } from "@/lib/console/database-health-texts";
import { wrappersTexts } from "@/lib/console/wrappers-texts";
import { replicationTexts } from "@/lib/console/replication-texts";
import { s3AccessTexts } from "@/lib/console/s3-access-texts";
import { authHookTexts } from "@/lib/console/auth-hooks-texts";
import { authPasskeysTexts } from "@/lib/console/auth-passkeys-texts";
import { branchFlowTexts } from "@/lib/console/branch-flow-texts";
import { authThirdPartyTexts } from "@/lib/console/auth-third-party-texts";
import { missingLogTexts } from "@/lib/console/missing-log-texts";
import { realtimeLogTexts } from "@/lib/console/realtime-log-texts";
import { integrationsGraphqlTexts } from "@/lib/console/integrations-graphql-texts";
import { authOAuthServerTexts } from "@/lib/console/auth-oauth-server-texts";
import { restoreToNewProjectTexts } from "@/lib/console/restore-to-new-project-texts";
import { provisioningOrderTexts } from "@/lib/console/provisioning-order-texts";
import { integrationsServicesTexts } from "@/lib/console/integrations-services-texts";
import { addonsTexts } from "@/lib/console/addons-texts";
import { backupsTexts } from "@/lib/console/backups-texts";
import { vectorBucketTexts } from "@/lib/console/vector-buckets-texts";

/**
 * Die Console spricht vier Sprachen (2.3). Der Schluessel jeder Uebersetzung
 * ist der deutsche Text im Code. Der Vertrag liest alle `t("...")`-Aufrufe
 * aus `console-app.tsx` und alle Labels und Erklaerungen der Navigation und
 * verlangt fuer jeden eine englische, franzoesische und italienische
 * Uebersetzung. Fehlt eine, faellt der Text stumm auf Deutsch zurueck —
 * genau das soll hier auffallen.
 */
async function consoleKeys(): Promise<string[]> {
  // Jede Ansicht der Console liegt als .tsx in diesem Ordner (seit 2.6 auch
  // ausserhalb von console-app.tsx); alle werden gelesen.
  const dir = path.resolve(process.cwd(), "components/console");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".tsx"));
  const keys = new Set<string>();
  for (const name of files) {
    const source = await readFile(path.join(dir, name), "utf8");
    for (const match of source.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)) keys.add(JSON.parse(match[1]) as string);
  }
  for (const group of NAV) { keys.add(group.label); for (const child of group.children ?? []) keys.add(child.label); }
  for (const entry of Object.values(PLACEHOLDERS)) { keys.add(entry.label); keys.add(entry.note); }
  // Die Texte des Sicherheitsberaters (2.39) kommen vom Server und laufen als t(variable) durch die Ansicht.
  for (const text of securityAdvisorTexts()) keys.add(text);
  // Dieselbe Lage beim Leistungsberater (2.40).
  for (const text of performanceAdvisorTexts()) keys.add(text);
  // Das Cron-Log (2.42) zeigt seine Zustandstexte ueber t(variable).
  for (const text of cronLogTexts()) keys.add(text);
  // Die Projekt-Gesundheit (2.44) zeigt Zustaende, Belege und Gruende ueber t(variable).
  for (const text of healthAdvisorTexts()) keys.add(text);
  // Die Zeitreihen der Nutzung (2.45) zeigen Metriken, Titel und ihre
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of usageSeriesTexts()) keys.add(text);
  // Datenbank und Verbindungen (2.46) zeigen Zustaende, Einheiten und ihre
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of databaseActivityTexts()) keys.add(text);
  // Realtime-Einstellungen und -Rechte (2.48) zeigen Grenzen, Einheiten,
  // Urspruenge, Rollen und ihre Ehrlichkeitssaetze ueber t(variable).
  for (const text of realtimeTexts()) keys.add(text);
  // Der Tabellen-Designer (2.49) zeigt Typen, Vorgabewerte und die Gruende
  // einer Ablehnung ueber t(variable).
  for (const text of tableChangeSetTexts()) keys.add(text);
  // Die beiden Auth-Berichte (2.47) zeigen Handlungen, Akteure und ihre
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of authObservabilityTexts()) keys.add(text);
  // Der Stand der Speicherobjekte (2.51) zeigt Urteile, ihre Bedeutung und
  // seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of storageLogTexts()) keys.add(text);
  // Auth → Mehrfaktor (2.52) zeigt Zustaende, Faktoren, Warnungen und
  // seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of authMfaTexts()) keys.add(text);
  // Die drei Auth-Seiten rund um die Anmeldung (2.54) zeigen Ablehnungsgruende,
  // Betriebsarten, Herkuenfte, Zwecke und ihre Ehrlichkeitssaetze ueber
  // t(variable).
  for (const text of authSettingsTexts()) keys.add(text);
  // Die Datenbank-Webhooks (2.50) zeigen die Gruende einer Ablehnung ueber
  // t(variable).
  for (const text of databaseWebhookTexts()) keys.add(text);
  // Logs -> Functions und Logs -> Data API (2.51) zeigen Spalten, Ausgaenge,
  // Zustaende und ihre Ehrlichkeitssaetze ueber t(variable).
  for (const text of logViewTexts()) keys.add(text);
  // Integrationen -> Vault (2.58) zeigt Zustaende, Quellen, die Schritte im
  // Vault und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of vaultOverviewTexts()) keys.add(text);
  // Auth -> Rate Limits (2.56) zeigt Arten, Gruende einer Ablehnung und seine
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of authRateLimitTexts()) keys.add(text);
  // Datenbank -> Point-in-time Recovery (2.53) zeigt Zustaende, Belege des
  // Drills, die Schritte einer Wiederherstellung und seine Ehrlichkeitssaetze
  // ueber t(variable).
  for (const text of pointInTimeTexts()) keys.add(text);
  // Datenbank -> Einstellungen (2.53) zeigt Rollenrechte, Urteile, den
  // TLS-Zustand und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of databaseSettingsTexts()) keys.add(text);
  // Auth -> Passwortschutz (2.53) zeigt Wortlaute, Listenherkuenfte, Gruende
  // einer Ablehnung und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of authProtectionTexts()) keys.add(text);
  // Auth -> Policies (2.62) zeigt Urteile, Befehle, Bedingungen, die Abbildung
  // auf PostgreSQL und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of authPoliciesTexts()) keys.add(text);
  // Die Vorlagen des SQL-Editors (2.61) zeigen Titel, Fragen und die Gruende
  // einer Ablehnung ueber t(variable).
  for (const text of sqlTemplateTexts()) keys.add(text);
  // Einstellungen -> Log-Drains (2.54) zeigt Quellen, ihre Feldlisten, die
  // Gruende einer Ablehnung und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of logDrainTexts()) keys.add(text);
  // Einstellungen -> Dashboard-Webhooks (2.75) zeigt Ereignisarten, ihre
  // Feldlisten, die Gruende einer Ablehnung und seine Ehrlichkeitssaetze ueber
  // t(variable).
  for (const text of dashboardWebhookTexts()) keys.add(text);
  // Einstellungen -> Dashboard (2.55) zeigt Sprachen, Formate, das Aussehen,
  // die Gruende einer Ablehnung und seine Ehrlichkeitssaetze ueber
  // t(variable).
  for (const text of displaySettingsTexts()) keys.add(text);
  // Logs -> Explorer (2.65) zeigt Quellen, ihre Bedeutung, die Zustaende je
  // Quelle, die Gruende einer Ablehnung, was er nicht erreicht und seine
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of logExplorerTexts()) keys.add(text);
  // Berichte -> Abfrage-Leistung (2.67) zeigt Zeiteinheiten und seine
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of queryPerformanceTexts()) keys.add(text);
  // Einstellungen -> Infrastruktur (2.67) zeigt Zustaende, Bindungen, was es
  // nicht gibt und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of infrastructureTexts()) keys.add(text);
  // Berichte -> Abfrage-Einblicke (2.67) zeigt Knotenarten, ihre Bedeutung,
  // die Gruende einer Ablehnung und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of queryInsightsTexts()) keys.add(text);
  // Auth -> Auth-Leistung (2.71) zeigt seine Ehrlichkeitssaetze ueber
  // t(variable), darunter den Satz, dass es keine Antwortzeit gibt.
  for (const text of authPerformanceTexts()) keys.add(text);
  // Logs -> Postgres-Zustand (2.70) zeigt Quellen der Statistik, den Zustand
  // der Pruefsummen, was es nicht gibt und seine Ehrlichkeitssaetze ueber
  // t(variable).
  for (const text of databaseHealthTexts()) keys.add(text);
  // Integrationen -> Wrappers (2.72) zeigt den Zustand eines Wrappers, die
  // Schritte zum Anlegen, was es nicht kann und seine Ehrlichkeitssaetze
  // ueber t(variable).
  for (const text of wrappersTexts()) keys.add(text);
  // Datenbank -> Replikation (2.74) zeigt den Zustand eines Slots, was
  // wal_level erlaubt, die Schritte zum Einrichten, was es nicht kann und
  // seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of replicationTexts()) keys.add(text);
  // Storage -> S3-Zugang (2.78) erklaert ueber t(variable), was ein
  // Schluesselpaar ist, und nennt die Grenze: Kein Endpunkt nimmt es heute an.
  for (const text of s3AccessTexts()) keys.add(text);
  // Auth -> Auth-Hooks (2.77) zeigt die Punkte, was sie duerfen, was bei einem
  // Ausfall gilt, die Gruende einer Ablehnung und seine Ehrlichkeitssaetze
  // ueber t(variable).
  for (const text of authHookTexts()) keys.add(text);
  // Auth -> Passkeys (2.79) zeigt die Pruefungen, die laufen, die, die nicht
  // laufen, die Gruende einer Ablehnung, die Verfahren und seine
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of authPasskeysTexts()) keys.add(text);
  // Branches (2.81) zeigt die Zustaende der Change Sets, der Freigaben und der
  // Auftraege, die Schritte des Pruefschritts, was es nicht gibt und seine
  // Ehrlichkeitssaetze ueber t(variable).
  for (const text of branchFlowTexts()) keys.add(text);
  // Auth -> Fremde Anbieter (2.80) zeigt den Unterschied zum OIDC-Weg, die
  // geprueften Verfahren, die Obergrenze der Rolle, die Gruende einer Ablehnung
  // und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of authThirdPartyTexts()) keys.add(text);
  // Die drei Logseiten aus 2.84 (Function-Logs, API-Gateway, Pooler) zeigen,
  // was fehlt, warum es fehlt, was es stattdessen gibt und was ein Betreiber
  // tun kann, alles ueber t(variable).
  for (const text of missingLogTexts()) keys.add(text);
  // Logs -> Realtime (2.86) zeigt die Spalten, die Rolle eines Absenders, den
  // Zustand des Aenderungs-Feeds und seine Ehrlichkeitssaetze ueber
  // t(variable).
  for (const text of realtimeLogTexts()) keys.add(text);
  // Integrationen -> GraphQL (2.83) zeigt den Ausschnitt der Sprache, was
  // bewusst fehlt, die Argumente eines Tabellenfeldes, die Gruende einer
  // Ablehnung und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of integrationsGraphqlTexts()) keys.add(text);
  // Auth → OAuth-Server (2.82) zeigt Bereiche, Auslässungen und die Gründe
  // einer Ablehnung über t(variable).
  for (const text of authOAuthServerTexts()) keys.add(text);
  // Datenbank → In neues Projekt wiederherstellen (2.87) zeigt die vier
  // Glieder der Kette, ihre Zustände und seine Ehrlichkeitssätze über
  // t(variable).
  for (const text of restoreToNewProjectTexts()) keys.add(text);
  // Einstellungen -> Compute und Disk (2.88) zeigt die Zustaende eines
  // Auftrags, die Felder einer Bestellung, die Felder einer Bindung, die
  // fuenf Fehlerklassen und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of provisioningOrderTexts()) keys.add(text);
  // Einstellungen -> Integrationen (2.88) zeigt je fremdem Dienst Zweck,
  // Beleg, Grenze und Ort, dazu die Dienste ohne Auskunft, was es nicht gibt
  // und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of integrationsServicesTexts()) keys.add(text);
  // Einstellungen -> Add-ons (2.88) zeigt die Form einer Rechnungszeile, was
  // es nicht gibt und seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of addonsTexts()) keys.add(text);
  // Datenbank -> Backups (2.90) zeigt den Stand des erklaerten Archivs, den
  // Befund zu Produktweg und Pruefweg, die Schritte eines Betreibers und
  // seine Ehrlichkeitssaetze ueber t(variable).
  for (const text of backupsTexts()) keys.add(text);
  // Storage -> Vektor-Buckets (2.93) zeigt sein Urteil ueber den Server,
  // die Schritte, die es braeuchte, und seine Ehrlichkeitssaetze ueber
  // t(variable).
  for (const text of vectorBucketTexts()) keys.add(text);
  return [...keys];
}

describe("console i18n contract", () => {

  it("translates every console text into en, fr and it", async () => {
    const keys = await consoleKeys();
    expect(keys.length).toBeGreaterThan(400);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(key in CONSOLE_TRANSLATIONS[locale]) || CONSOLE_TRANSLATIONS[locale][key].trim() === "");
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });

  it("carries no translation for a text that no longer exists", async () => {
    const keys = new Set(await consoleKeys());
    for (const locale of ["en", "fr", "it"] as const) {
      const stale = Object.keys(CONSOLE_TRANSLATIONS[locale]).filter((key) => !keys.has(key));
      expect(stale, `${locale}: verwaiste Uebersetzungen`).toEqual([]);
    }
  });

  it("keeps placeholders and ellipses aligned with the German source", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      for (const [key, value] of Object.entries(CONSOLE_TRANSLATIONS[locale])) {
        expect(value.endsWith("…"), `${locale}: ${key}`).toBe(key.endsWith("…"));
        expect(value.startsWith(" "), `${locale}: ${key}`).toBe(key.startsWith(" "));
      }
    }
  });
});
