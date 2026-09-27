/**
 * Die Texte von Auth -> Policies (2.62), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `health-advisor-texts` (2.44) und
 * `database-settings-texts` (2.53): Der Schluessel ist der deutsche Text, die
 * Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Das Modul ist rein, damit Server und Console es
 * gleichermassen laden duerfen: keine Datenbank, kein React, keine Farbe
 * ausser der Tonangabe, die die Ansicht als Klasse verwendet.
 *
 * Die Ids dieser Datei sind zugleich die Ids, die das reine Regelmodul
 * `lib/server/data-plane/auth-access-rules.ts` ausgibt. Ein Urteil dieser
 * Seite kann darum nur aus dieser Datei stammen; ein Tabellenname oder ein
 * Policy-Ausdruck laeuft nie in einen dieser Texte.
 */

/** Die vier Befehle, die eine Policy erlauben kann, in dieser Reihenfolge. */
export const AUTH_ACCESS_COMMANDS = ["select", "insert", "update", "delete"] as const;
export type AuthAccessCommand = (typeof AUTH_ACCESS_COMMANDS)[number];

/**
 * Die fuenf Urteile, von der geschlossensten Lage zur offensten.
 *
 * `refused` steht bewusst vor `locked`: Eine Tabelle ohne Row Level Security
 * ist nicht offen, sondern fuer die Data API gar nicht da. Genau das
 * ueberrascht die meisten, darum ist es ein eigenes Urteil und keine
 * Randnotiz.
 */
export const AUTH_ACCESS_VERDICTS = ["refused", "locked", "readable", "writable", "open"] as const;
export type AuthAccessVerdict = (typeof AUTH_ACCESS_VERDICTS)[number];

/** Was eine Bedingung fuer diese Seite erkennbar macht. */
export const AUTH_ACCESS_CONDITIONS = ["none", "constant", "request"] as const;
export type AuthAccessCondition = (typeof AUTH_ACCESS_CONDITIONS)[number];

/** Ob ein Befehl erlaubt ist, und wie sicher das gesagt werden kann. */
export const AUTH_ACCESS_ALLOWANCES = ["no", "always", "sometimes"] as const;
export type AuthAccessAllowance = (typeof AUTH_ACCESS_ALLOWANCES)[number];

export type AuthAccessVerdictText = {
  label: string;
  explains: string;
  /** Wie die Ansicht das Urteil einfaerbt; dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium" | "risk high";
};

export const AUTH_ACCESS_VERDICT_TEXTS: Record<AuthAccessVerdict, AuthAccessVerdictText> = {
  refused: {
    label: "verweigert",
    explains: "Row Level Security ist auf dieser Tabelle aus. Die Data API nimmt die Tabelle gar nicht an, egal welche Policy daneben steht; sie antwortet mit GENERATED_DATA_API_RLS_REQUIRED. Die Tabelle ist damit nicht offen, sondern unerreichbar.",
    tone: "risk high",
  },
  locked: {
    label: "verschlossen",
    explains: "Row Level Security ist an, aber keine Policy gilt für die Rolle, mit der eine angemeldete Anfrage läuft. Lesen gibt null Zeilen zurück, Schreiben wird abgewiesen.",
    tone: "muted",
  },
  readable: {
    label: "lesbar",
    explains: "Mindestens eine Policy erlaubt das Lesen. Für INSERT, UPDATE und DELETE gilt keine.",
    tone: "secure",
  },
  writable: {
    label: "schreibbar",
    explains: "Mindestens eine Policy erlaubt INSERT, UPDATE oder DELETE. Ob auch gelesen werden darf, steht in der Zeile für SELECT.",
    tone: "risk medium",
  },
  open: {
    label: "offen für alle",
    explains: "Eine Policy für PUBLIC erlaubt das Lesen ohne Bedingung. Dann sieht auch ein Public Key diese Zeilen, also jeder Besucher deiner App, angemeldet oder nicht.",
    tone: "risk high",
  },
};

export type AuthAccessCommandText = { label: string; explains: string };

export const AUTH_ACCESS_COMMAND_TEXTS: Record<AuthAccessCommand, AuthAccessCommandText> = {
  select: { label: "Lesen", explains: "Welche Zeilen eine Leseanfrage überhaupt sieht. Was eine Policy nicht erfasst, fehlt in der Antwort, ohne Fehler und ohne Hinweis." },
  insert: { label: "Einfügen", explains: "Ob eine neue Zeile angelegt werden darf. Geprüft wird die WITH-CHECK-Bedingung gegen die neue Zeile; fehlt sie, gilt die USING-Bedingung." },
  update: { label: "Ändern", explains: "Ob eine bestehende Zeile geändert werden darf. Geprüft wird zweimal: USING gegen die alte Zeile, WITH CHECK gegen die neue." },
  delete: { label: "Löschen", explains: "Ob eine Zeile gelöscht werden darf. Was die USING-Bedingung nicht erfasst, ist für DELETE nicht vorhanden." },
};

export type AuthAccessConditionText = { label: string; explains: string };

export const AUTH_ACCESS_CONDITION_TEXTS: Record<AuthAccessCondition, AuthAccessConditionText> = {
  none: {
    label: "ohne Bedingung",
    explains: "Die Policy hat keine Bedingung, oder ihre Bedingung ist wörtlich `true`. Sie erfasst jede Zeile der Tabelle.",
  },
  constant: {
    label: "auf Spalten dieser Tabelle",
    explains: "Die Bedingung vergleicht Spalten dieser Tabelle. Welche Zeilen sie erfasst, entscheidet der Inhalt der Tabelle. Diese Seite liest keine Zeile und zählt darum nicht nach.",
  },
  request: {
    label: "auf die Anfrage",
    explains: "Die Bedingung liest eine Einstellung, einen Claim oder ruft eine Funktion. Sie kann bei einer Anfrage zutreffen und bei der nächsten nicht. Wie sie ausgeht, kann diese Seite nicht wissen, und sie rät es auch nicht.",
  },
};

export type AuthAccessAllowanceText = { label: string; explains: string; tone: "secure" | "muted" | "risk medium" };

export const AUTH_ACCESS_ALLOWANCE_TEXTS: Record<AuthAccessAllowance, AuthAccessAllowanceText> = {
  no: {
    label: "nein",
    explains: "Für diesen Befehl gilt keine Policy, die diese Rolle nennt. Er erfasst keine Zeile.",
    tone: "muted",
  },
  always: {
    label: "ja",
    explains: "Mindestens eine Policy gilt und hat keine Bedingung, und keine restriktive Policy engt sie ein. Jede Zeile ist erfasst.",
    tone: "risk medium",
  },
  sometimes: {
    label: "abhängig",
    explains: "Es gilt eine Policy, aber mit Bedingung. Welche Zeile sie erfasst, entscheidet sich erst bei der Anfrage.",
    tone: "secure",
  },
};

export type AuthAccessStep = { title: string; body: string };

/**
 * Die Abbildung einer angemeldeten Anfrage auf PostgreSQL. Ohne sie sagt eine
 * Policy-Liste niemandem, was ein Nutzer darf: Die Liste nennt Rollen, und
 * welche Rolle eine Anfrage wirklich ist, steht nicht in ihr.
 */
export const AUTH_ACCESS_MAPPING: AuthAccessStep[] = [
  {
    title: "Die Datenbankrolle",
    body: "Eine angemeldete Anfrage wird keine eigene Datenbankrolle. Jede Anfrage der Data API läuft über die eine Anwendungsrolle dieser Umgebung, die oben mit Namen steht. Es gibt kein SET ROLE, und vor jeder Anweisung prüft der Server, dass diese Rolle kein Superuser ist, Row Level Security nicht umgehen darf und in keiner Gruppenrolle steckt.",
  },
  {
    title: "Die Claims",
    body: "Wer angemeldet ist, steht nicht in der Rolle, sondern in den Claims des Access Tokens: `role` ist bei einem angemeldeten Nutzer immer `authenticated`, `sub` ist seine Nutzer-ID. Dazu kommen `email`, `email_verified`, `aal`, `session_id`, `user_metadata` und `app_metadata`.",
  },
  {
    title: "Die Einstellungen",
    body: "Vor der Anweisung setzt der Server vier Einstellungen, jede nur für diese eine Transaktion: `request.jwt.claims` mit allen Claims als JSON, `request.jwt.claim.role`, `request.jwt.claim.sub` und `qkern.actor_ref`. Eine Policy liest sie mit `current_setting`; das ist der Weg, auf dem eine Bedingung überhaupt von der Anmeldung erfahren kann.",
  },
  {
    title: "Row Level Security bleibt an",
    body: "Jede Transaktion setzt `row_security = on`, und eine Leseanfrage läuft als BEGIN READ ONLY. Ein Service Key ändert daran nichts: Er trägt nur einen anderen `role`-Claim, nämlich `service_role`, und umgeht keine einzige Policy.",
  },
  {
    title: "Dieselben Claims an der Realtime-Tür",
    body: "Welchen Kanal jemand abonnieren darf, entscheiden dieselben zwei Claims. Mit `role` `anon` sind nur `public:`-Kanäle abonnierbar, mit `authenticated` dazu die `private:`-Kanäle und genau ein eigener Kanal `user:<sub>`. In `changes:`-Kanäle darf niemand senden, weil nur der Server sie füllt.",
  },
];

/** Der erste Satz der Seite: was sie nicht tut. */
export const AUTH_ACCESS_READ_ONLY_NOTE = "Diese Seite liest nur. Sie legt keine Policy an, ändert keine und schaltet Row Level Security nicht ein; das geht wie jede Schemaänderung über ein Change Set.";

export const AUTH_ACCESS_RLS_OFF_NOTE = "Ist Row Level Security auf einer Tabelle aus, verweigert die Data API die Tabelle vollständig. Sie wird dadurch nicht offen, sondern unerreichbar — und das ist die Tatsache, die die meisten überrascht.";

export const AUTH_ACCESS_UNCERTAIN_NOTE = "Eine Bedingung, die eine Einstellung oder eine Funktion liest, kann bei einer Anfrage zutreffen und bei der nächsten nicht. Diese Seite rechnet sie nicht aus. Sie sagt das in der Zeile, um die es geht, und nicht in einer Fussnote am Ende.";

export const AUTH_ACCESS_FOREIGN_ROLE_NOTE = "Eine Policy, die nur andere Rollen nennt, steht mit Namen da und gilt trotzdem nicht. Für eine angemeldete Anfrage zählt allein, was für PUBLIC oder für die Anwendungsrolle dieser Umgebung geschrieben ist.";

export const AUTH_ACCESS_VIEWS_NOTE = "Views stehen hier nicht. Eine View trägt keine eigene Policy; die Data API nimmt sie nur mit `security_invoker` an und liest sie dann unter den Policies der Tabellen darunter.";

export const AUTH_ACCESS_LIST_SOURCE_NOTE = "Die Policies selbst sind dieselben wie unter Datenbank → Policies, aus `pg_policy`. Neu ist die Frage: nicht welche Regeln es gibt, sondern was am Ende für eine angemeldete Anfrage gilt.";

export const AUTH_ACCESS_RESTRICTIVE_NOTE = "Eine restriktive Policy erlaubt nichts. Sie engt ein, was die permissiven zusammen erlauben, und sie kann aus einem Ja ein Abhängig machen.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authPoliciesTexts(): string[] {
  return [
    ...Object.values(AUTH_ACCESS_VERDICT_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(AUTH_ACCESS_COMMAND_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(AUTH_ACCESS_CONDITION_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(AUTH_ACCESS_ALLOWANCE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...AUTH_ACCESS_MAPPING.flatMap((entry) => [entry.title, entry.body]),
    AUTH_ACCESS_READ_ONLY_NOTE,
    AUTH_ACCESS_RLS_OFF_NOTE,
    AUTH_ACCESS_UNCERTAIN_NOTE,
    AUTH_ACCESS_FOREIGN_ROLE_NOTE,
    AUTH_ACCESS_VIEWS_NOTE,
    AUTH_ACCESS_LIST_SOURCE_NOTE,
    AUTH_ACCESS_RESTRICTIVE_NOTE,
  ];
}
