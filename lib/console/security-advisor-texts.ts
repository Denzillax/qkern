/**
 * Die Texte des Sicherheitsberaters (2.39), deutsch und an einer Stelle.
 *
 * Der Server schreibt diese Texte in jeden Befund und jede Pruefung; die
 * Console uebersetzt sie ueber ihren Katalog, der Schluessel ist der
 * deutsche Text. Der Vertrag `console-i18n-contract` liest diese Tabelle mit
 * und verlangt fuer jeden Text en, fr und it. Das Modul ist rein, damit
 * Server und Console es gleichermassen laden duerfen.
 */

export const SECURITY_RULE_IDS = [
  "rls_disabled",
  "rls_no_policies",
  "policy_always_true",
  "policy_check_missing",
  "bucket_public_read",
  "bucket_authenticated_write_any_type",
  "api_key_broad",
  "auth_provider_unverified_email",
] as const;

export type SecurityRuleId = (typeof SECURITY_RULE_IDS)[number];
export type SecuritySeverity = "high" | "medium" | "low";

export type SecurityRuleText = {
  severity: SecuritySeverity;
  title: string;
  summary: string;
  remedy: string;
  /** Was die Regel liest, fuer die Karte "Was geprueft wurde". */
  reads: string;
};

export const SECURITY_RULES: Record<SecurityRuleId, SecurityRuleText> = {
  rls_disabled: {
    severity: "high",
    title: "Tabelle ohne RLS",
    summary: "Row Level Security ist aus. Die Data API liefert die Tabelle deshalb nicht aus, aber jede Verbindung mit Tabellenrechten liest und schreibt alle Zeilen.",
    remedy: "RLS einschalten (ALTER TABLE name ENABLE ROW LEVEL SECURITY) und Policies anlegen, als Change Set über den SQL Editor.",
    reads: "Tabellen im Schema public und ob RLS an ist.",
  },
  rls_no_policies: {
    severity: "medium",
    title: "RLS ohne Policy",
    summary: "RLS ist an, aber es gibt keine Policy. Ausser dem Besitzer sieht niemand eine Zeile; die Tabelle ist gesperrt, nicht offen.",
    remedy: "Soll die Tabelle gelesen werden, eine Policy für die passenden Rollen anlegen. Soll sie gesperrt bleiben, ist nichts zu tun.",
    reads: "Tabellen mit RLS und die Policies im Schema public.",
  },
  policy_always_true: {
    severity: "high",
    title: "Policy ohne Bedingung",
    summary: "Eine erlaubende Policy für alle oder breite Rollen hat die Bedingung true. Für diese Rollen ist jede Zeile freigegeben.",
    remedy: "Die Bedingung auf Besitzer oder Mandant einschränken. Soll die Tabelle wirklich öffentlich sein, die Policy bewusst so lassen.",
    reads: "Erlaubende Policies für public, anon oder authenticated und ihre USING- und WITH-CHECK-Bedingungen.",
  },
  policy_check_missing: {
    severity: "low",
    title: "Schreib-Policy ohne Prüfung",
    summary: "Eine erlaubende Policy für INSERT, UPDATE oder ALL prüft neue Zeilen nicht: kein WITH CHECK und keine USING-Bedingung, die PostgreSQL ersatzweise anwendet.",
    remedy: "Eine WITH-CHECK-Bedingung ergänzen, die festlegt, welche Zeilen geschrieben werden dürfen.",
    reads: "Erlaubende Policies für INSERT, UPDATE und ALL im Schema public.",
  },
  bucket_public_read: {
    severity: "medium",
    title: "Öffentlich lesbarer Bucket",
    summary: "Jedes Objekt dieses Buckets ist ohne Anmeldung lesbar.",
    remedy: "Das Leserecht auf authenticated, owner oder private setzen, wenn die Dateien nicht öffentlich sein sollen.",
    reads: "Die Leserichtlinie jedes Buckets.",
  },
  bucket_authenticated_write_any_type: {
    severity: "low",
    title: "Upload ohne Typgrenze",
    summary: "Jede angemeldete Person darf in diesen Bucket schreiben, und der Bucket beschränkt die Dateitypen nicht.",
    remedy: "Erlaubte MIME-Typen setzen oder das Schreibrecht auf owner oder service einschränken.",
    reads: "Schreibrichtlinie und erlaubte MIME-Typen jedes Buckets.",
  },
  api_key_broad: {
    severity: "medium",
    title: "Service-Key in Production",
    summary: "Ein aktiver Service-Key in Production trägt die Rolle service_role. Wer ihn hat, handelt mit den weitesten Rechten, die das Projekt vergibt.",
    remedy: "Den Key nur auf dem Server halten, die Laufzeit kurz wählen und nicht mehr gebrauchte Keys widerrufen.",
    reads: "Art, Ablauf und Widerruf der API-Keys dieser Umgebung, nie das Geheimnis.",
  },
  auth_provider_unverified_email: {
    severity: "low",
    title: "Anbieter ohne E-Mail-Bestätigung",
    summary: "Dieser Anmeldeanbieter ist als vertrauenswürdig hinterlegt: Ein ID-Token ohne den Claim email_verified wird angenommen. Wer beim Anbieter eine fremde Adresse einträgt, ohne sie zu bestätigen, landet damit im selben Konto.",
    remedy: "Den Anbieter auf email_verification: required stellen, solange nicht belegt ist, dass er jede Adresse selbst prüft. Ein ausdrückliches email_verified: false weist QKERN in beiden Betriebsarten ab.",
    reads: "Je Anmeldeanbieter den Slug und ein Ja/Nein, ob er email_verified verlangt. Nie Client-ID, Endpunkt oder Secret.",
  },
};

/** Warum eine Regel nicht oder nur teilweise lief. */
export const SECURITY_CHECK_REASONS = {
  databaseDisabled: "Die Projektdatenbank ist nicht angebunden.",
  databaseNotReady: "Die Projektdatenbank ist noch nicht bereit.",
  databaseUnavailable: "Die Projektdatenbank ist gerade nicht erreichbar.",
  tablesTruncated: "Nur die ersten 100 Tabellen des Schemas geprüft.",
  policiesTruncated: "Nur die ersten 200 Policies des Schemas geprüft.",
  policiesIncomplete: "Die Policy-Liste ist bei 200 abgeschnitten. Ohne vollständige Liste wäre jeder Befund dieser Regel geraten.",
  storageDisabled: "Storage ist nicht aktiviert.",
  storageUnavailable: "Storage ist gerade nicht erreichbar.",
  storageForbidden: "Deine Rolle darf die Buckets nicht verwalten.",
  keysUnavailable: "Die API-Keys sind gerade nicht erreichbar.",
  keysForbidden: "Deine Rolle darf die API-Keys nicht sehen.",
  consoleOnly: "Nur mit einer Console-Sitzung prüfbar, nicht mit einem Projekt-Key.",
  productionOnly: "Greift nur in Production; in dieser Umgebung gibt es dazu keinen Befund.",
  authDisabled: "Project Auth ist in dieser Installation nicht freigeschaltet.",
  authUnavailable: "Der Anmeldedienst ist gerade nicht erreichbar.",
  authForbidden: "Deine Rolle darf die Anmeldeanbieter nicht sehen.",
} as const;

export type SecurityCheckReason = keyof typeof SECURITY_CHECK_REASONS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function securityAdvisorTexts(): string[] {
  return [
    ...Object.values(SECURITY_RULES).flatMap((rule) => [rule.title, rule.summary, rule.remedy, rule.reads]),
    ...Object.values(SECURITY_CHECK_REASONS),
  ];
}
