/**
 * Die Texte der Seite Einstellungen -> Integrationen (2.88), deutsch und an
 * einer Stelle.
 *
 * Gleiche Bauart wie `missing-log-texts` (2.84): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft und ein Text hinter einer Variablen durch die Suche
 * nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter versprach „verknuepfte Dienste wie Git-Hosting oder
 * Deploy-Plattformen". Git-Hosting und Deploy-Plattformen gibt es nicht, und
 * zwar nirgends: Im ganzen Baum spricht kein Modul mit GitHub, GitLab,
 * Bitbucket, Vercel, Netlify oder Fly. Die einzigen Treffer stehen in der CI
 * des Projekts selbst und in einem Testnamen.
 *
 * Verknuepfte Dienste gibt es trotzdem, nur andere. QKERN spricht mit einem
 * Geheimnisspeicher, einem Objektspeicher, einem Mailserver, fremden
 * Anmeldediensten, fremden Ausstellern von Token, Webhook-Zielen und
 * Log-Zielen. Das **ist** die Liste, die der Platzhalter versprochen hat, und
 * diese Seite zeigt sie.
 *
 * Die Regel dieser Seite ist scharf: Je Dienst steht hier, **ob** er
 * eingerichtet ist und **woher** QKERN das weiss. Kein Wert. Kein Host, kein
 * Port, keine Adresse, kein Benutzername, kein Token, kein Schluessel und
 * keine Kennung eines Anbieters. Die Zustaende und ihre Bedeutung kommen aus
 * `health-advisor-texts` (2.44, erweitert in 2.57), damit „eingerichtet" auf
 * dieser Seite dasselbe heisst wie unter Advisors -> Gesundheit: hinterlegt,
 * niemand gefragt.
 */

export const INTEGRATIONS_TEXTS = {
  kicker: "EINSTELLUNGEN",
  title: "Integrationen: andere Dienste als die versprochenen",
  /** Der Satz, der die Seite eroeffnet. */
  noGitNoDeploy:
    "Git-Hosting und Deploy-Plattformen hat QKERN nicht. Kein Modul spricht mit GitHub, GitLab oder Bitbucket, keines mit Vercel, Netlify oder Fly, und es gibt keinen Ort, an dem ein Konto dafür hinterlegt wäre. Das ist keine fehlende Oberfläche, sondern eine fehlende Sache. Verknüpfte Dienste gibt es trotzdem, nur andere, und die stehen hier.",
  /** Die Regel der Seite, wortwoertlich. */
  noValues:
    "Diese Seite sagt je Dienst zweierlei: ob er eingerichtet ist und woher QKERN das weiss. Sie zeigt keinen einzigen Wert. Kein Host, kein Port, keine Adresse, kein Benutzername, kein Token, kein Schlüssel und kein Name eines Anbieters. Wo ein Dienst gezählt wird, steht eine Anzahl und sonst nichts.",
  /** Was „eingerichtet" hier heisst. */
  whatConfiguredMeans:
    "Eingerichtet heisst hinterlegt, nicht erreichbar. Kein Feld dieser Seite baut eine Verbindung auf, fragt einen fremden Dienst oder prüft ein Passwort. Die Zustände sind dieselben wie unter Advisors → Gesundheit, und aus demselben Grund: Eine Seite, die niemanden gefragt hat, soll nicht melden, dass jemand antwortet.",

  /* Die Liste. */
  servicesTitle: "Die Dienste, mit denen QKERN spricht",
  servicesMeaning:
    "Sieben Stellen, an denen QKERN etwas ausserhalb seiner selbst anspricht. Jede hat ihre eigene Seite in der Console, an der sie auch eingerichtet wird; diese Liste richtet nichts ein und ändert nichts, sie beantwortet nur die Frage, was verknüpft ist.",
  servicesWhereToChange:
    "Geändert wird jeder dieser Dienste dort, wo er hingehört, und nicht hier. Drei davon stehen gar nicht in der Datenbank, sondern in der Umgebung des Servers; sie lassen sich aus keiner Oberfläche ändern, und diese Seite tut nicht so, als ginge es.",

  /* Was die Console nicht sehen kann. */
  invisibleTitle: "Fremde Dienste, die diese Seite nicht sieht",
  invisibleMeaning:
    "Drei weitere fremde Dienste gibt es, und über keinen von ihnen kann die Console etwas sagen. Sie werden ausschliesslich über die Umgebung des Serverprozesses eingerichtet, es gibt für sie keine Route und keine Zeile in der Datenbank. Sie hier als nicht eingerichtet zu zeigen wäre eine Behauptung; sie wegzulassen wäre eine Lücke. Deshalb stehen sie mit Namen und ohne Zustand.",
  invisibleWhyNoProbe:
    "Eine Probe wäre möglich und ist mit Absicht nicht gebaut. Jeder dieser drei nimmt signierte Nachrichten entgegen; ihn anzufragen, nur damit eine Kachel grün wird, hiesse, einen fremden Dienst aus einer Ansicht heraus anzusprechen. Das tut hier keine Seite.",

  /* Was es nicht gibt. */
  missingTitle: "Was der Platzhalter versprochen hat",
  missingMeaning:
    "Die beiden Dinge, die im Menü standen, gibt es nicht, und beide fehlen aus einem Grund, der nicht „noch nicht\" lautet.",

  /* Fuer Betreiber. */
  operatorTitle: "Wenn Sie einen Dienst verknüpfen wollen",
  operatorSteps:
    "Jeder Dienst dieser Liste wird an seiner eigenen Stelle eingerichtet, und die Seite nennt sie. Vier davon stehen in der Datenbank und lassen sich aus der Console anlegen; drei stehen in der Umgebung des Servers und brauchen einen Neustart des Prozesses.",
  operatorNoTest:
    "Einen Knopf „Verbindung testen\" gibt es auf keiner dieser Seiten, und auch hier nicht. Ein solcher Test würde eine Anfrage an einen fremden Dienst aus einer Ansicht heraus auslösen, und er würde über den Betrieb nichts aussagen, was der nächste Aufruf nicht selbst beantwortet.",
} as const;

/* ------------------------------------------------------------------ *
 * Die sieben Dienste
 * ------------------------------------------------------------------ */

export const INTEGRATION_SERVICE_IDS = [
  "vault", "storage", "smtp", "oidc", "third_party", "webhooks", "log_drains",
] as const;

export type IntegrationServiceId = (typeof INTEGRATION_SERVICE_IDS)[number];

export type IntegrationService = {
  label: string;
  /** Wofuer QKERN diesen Dienst ueberhaupt anspricht. */
  purpose: string;
  /** Woher QKERN weiss, ob er eingerichtet ist. Die Quelle, nicht der Wert. */
  evidence: string;
  /** Was diese Auskunft nicht sagt. */
  limit: string;
  /** Wo der Dienst eingerichtet wird. Ein Menuepfad oder die Umgebung. */
  managedAt: string;
};

export const INTEGRATION_SERVICES: Record<IntegrationServiceId, IntegrationService> = {
  vault: {
    label: "Geheimnisspeicher",
    purpose: "Hier liegen die Geheimnisse, die QKERN braucht und nicht selbst hält: die Signaturschlüssel der Webhooks, die Werte hinter den Secrets einer Function und die Zugangsdaten der Projektdatenbanken.",
    evidence: "Geprüft wird, ob sich der Leser für den Geheimnisspeicher aus der Umgebung überhaupt bauen lässt. Angefragt wird dabei nichts. Halb eingerichtet gilt als Fehler und nicht als eingerichtet: Wer eine Adresse setzt, aber keine Tokendatei, bekommt keinen stillen Rückfall auf lokale Geheimnisse.",
    limit: "Dass sich der Leser bauen lässt, heisst nicht, dass der Speicher antwortet, und schon gar nicht, dass ein bestimmtes Geheimnis dort liegt. Welche Referenzen es gibt und ob dahinter etwas steht, zeigt Integrationen → Vault, und auch dort steht nie ein Wert.",
    managedAt: "Umgebung des Servers",
  },
  storage: {
    label: "Objektspeicher",
    purpose: "Die Objekte von Project Storage liegen nicht in der Datenbank, sondern in einem Objektspeicher, der über die S3-Schnittstelle angesprochen wird.",
    evidence: "Gezählt werden die Buckets dieser Umgebung. Mehr als null heisst, dass Project Storage eingeschaltet ist und Ablagen angelegt sind.",
    limit: "Das ist die schwächste Auskunft dieser Seite, und sie steht hier mit dieser Einschränkung. Gezählt werden Buckets, nicht Zugangsdaten. Ob ein echter Objektspeicher hinterlegt ist oder die Ablage nur im Speicher des Prozesses liegt, ist von aussen nicht zu sehen; die fünf Einstellungen dafür erreichen keine Route.",
    managedAt: "Storage → Buckets",
  },
  smtp: {
    label: "Mailserver",
    purpose: "Über diesen Weg gehen die Mails von Project Auth hinaus: Bestätigungen, Einladungen und Links zum Zurücksetzen eines Passworts.",
    evidence: "Gelesen wird die Betriebsart, die sich aus der Umgebung ergibt. Ein hinterlegter Host heisst SMTP; ohne Host gibt es je nach Einstellung einen Entwicklungsmodus ohne Versand oder gar keinen Versand. Dazu ein einziges abgeleitetes Ja oder Nein, ob Benutzername und Passwort beide gesetzt sind.",
    limit: "Ob QKERN sich anmeldet, wird aus dem blossen Vorhandensein der beiden Werte abgeleitet; gelesen wird keiner von beiden, und der Benutzername verlässt den Server nicht. Ob der Mailserver Mails annimmt, sagt diese Zeile nicht; das zeigt erst ein Versand.",
    managedAt: "Auth → SMTP",
  },
  oidc: {
    label: "Anmeldedienste (OIDC)",
    purpose: "Fremde Anbieter, bei denen sich die Nutzerinnen einer Anwendung anmelden können, statt bei QKERN ein Passwort zu setzen.",
    evidence: "Gezählt werden die Anbieter, die im Katalog stehen. Der Katalog kommt aus der Umgebung des Servers; das Geheimnis jedes Anbieters steht in einer eigenen Variablen, deren Name geprüft, aber nie herausgegeben wird.",
    limit: "Hier steht nur die Anzahl. Welche Anbieter es sind, mit welchem Aussteller und unter welcher Kennung, zeigt Auth → Anmeldeverfahren, und auch dort nie die Client-ID und nie der Name der Geheimnisvariablen.",
    managedAt: "Auth → Anmeldeverfahren",
  },
  third_party: {
    label: "Fremde Tokenaussteller",
    purpose: "Aussteller, deren Token die Data API direkt annimmt, ohne dass sich jemand bei QKERN anmeldet. Das Gegenstück zum OIDC-Weg: Dort holt QKERN eine Identität, hier bringt der Aufrufer sie mit.",
    evidence: "Gezählt werden die Aussteller, die für diese Umgebung eingetragen sind. Sie stehen in einer Tabelle unter der Zeilensicherheit des Mandanten.",
    limit: "In dieser Tabelle steht kein Schlüsselmaterial, weil es dort keines gibt: Die öffentlichen Schlüssel werden bei Bedarf geholt und nur im Speicher gehalten. Welcher Aussteller eingetragen ist, zeigt Auth → Fremde Anbieter.",
    managedAt: "Auth → Fremde Anbieter",
  },
  webhooks: {
    label: "Webhook-Ziele",
    purpose: "Fremde Adressen, an die QKERN signierte Nachrichten schickt: bei einer Tabellenänderung, bei einem Ereignis der Console oder auf Zuruf einer Function.",
    evidence: "Gezählt werden die Ziele, die für diese Umgebung eingetragen sind. Jedes Ziel trägt eine Adresse und eine Referenz auf seinen Signaturschlüssel.",
    limit: "Die Adresse steht hier nicht, und der Signaturschlüssel erst recht nicht: Eingetragen ist ohnehin nur eine Referenz, und ihr Wert wird beim Senden aus dem Geheimnisspeicher geholt. Die Ziele selbst stehen unter Functions → Webhooks und unter Einstellungen → Dashboard-Webhooks.",
    managedAt: "Functions, Cron, Webhooks",
  },
  log_drains: {
    label: "Log-Ziele",
    purpose: "Ein Log-Drain trägt Zeilen aus QKERN nach draussen, an dieselbe Art Adresse wie ein Webhook und mit derselben Signatur.",
    evidence: "Gezählt werden die Log-Drains dieser Umgebung. Jeder hängt an einem Webhook-Ziel und nennt die Quellen, die er weiterträgt.",
    limit: "Welche Quellen ein Drain trägt und wohin, steht unter Einstellungen → Log-Drains. Eine Quelle, die es nicht gibt, kann auch ein Drain nicht tragen; das gilt vor allem für Anfragen am Rand und für Verbindungen.",
    managedAt: "Einstellungen → Log-Drains",
  },
};

/* ------------------------------------------------------------------ *
 * Fremde Dienste ohne Auskunft
 * ------------------------------------------------------------------ */

export type IntegrationNote = {
  title: string;
  body: string;
};

/**
 * Drei fremde Dienste, ueber die keine Route etwas sagt. Sie stehen mit
 * Namen da, damit die Liste oben nicht als vollstaendig gelesen wird.
 */
export const INTEGRATIONS_INVISIBLE: readonly IntegrationNote[] = [
  {
    title: "Der Vermittler der Provisionierung",
    body: "Ihm schickt QKERN den Auftrag, eine Projektdatenbank herzustellen, signiert und nur an Adressen aus einer festen Liste. Eingerichtet wird er über die Umgebung des Prozesses, der den Provisionierer fährt, und das ist nicht der Prozess, der diese Seite ausliefert. Was ein solcher Auftrag trägt, steht unter Einstellungen → Compute und Disk.",
  },
  {
    title: "Der Vermittler für das Einspielen auf Produktion",
    body: "Eine Migration auf die Produktionsumgebung verlässt QKERN als signierte Nachricht an diesen Dienst, statt dass eine Anfrage sie selbst ausführt. Auch er steht nur in der Umgebung, und sein Versand wird über einen eigenen Schalter freigegeben.",
  },
  {
    title: "Das Ziel für Störungsmeldungen",
    body: "Bricht ein Einspielvorgang ab, geht eine signierte Meldung an eine Adresse, die für Störungen hinterlegt ist. Dasselbe Bild: eine Adresse in der Umgebung, ein eigener Schalter, keine Zeile in der Datenbank und keine Route, die davon berichtet.",
  },
];

/**
 * Was der Platzhalter versprochen hat und warum es das nicht gibt. Kein
 * Eintrag beschreibt eine Oberflaeche, die fehlt; jeder nennt den Grund.
 */
export const INTEGRATIONS_MISSING: readonly IntegrationNote[] = [
  {
    title: "Kein Git-Hosting",
    body: "QKERN liest kein Repository, klont nichts und bekommt von keinem Anbieter Ereignisse. Es gibt keine Stelle, an der ein Zugangstoken für ein Git-Hosting läge, und keine Tabelle, die ein Repository mit einem Projekt verbände. Die Änderungen, die QKERN kennt, entstehen in seinen eigenen Change Sets unter Datenbank → Migrationen, nicht in einem fremden Verlauf.",
  },
  {
    title: "Keine Deploy-Plattformen",
    body: "Es gibt nichts zu verknüpfen, weil QKERN nichts ausliefert, was eine solche Plattform ausliefern würde. Eine Function wird als fertiges Image eingesetzt, mit seinem Abdruck festgehalten, und das Image baut jemand anders. Ein Vorschauzweig je Änderung, den eine solche Plattform gewöhnlich anbietet, ist bei QKERN ebenfalls keine Sache: Die drei Umgebungen stehen fest.",
  },
  {
    title: "Kein Marktplatz",
    body: "Es gibt keine Erweiterungen von Dritten, die sich hier hinzufügen liessen, und keinen Ort, an dem fremder Code in QKERN liefe, ausser der Function in ihrem Container. Die Erweiterungen, die es gibt, sind die von PostgreSQL und stehen unter Datenbank → Erweiterungen.",
  },
];

/* ------------------------------------------------------------------ *
 * Zustaende, die die Ansicht ueber t(variable) zeigt
 * ------------------------------------------------------------------ */

export const INTEGRATIONS_STATES = {
  loading: "Die Dienste werden nachgesehen…",
  notReadable: "Diese Anmeldung darf über diesen Dienst nichts erfahren, oder die Route antwortet gerade nicht. Was hier steht, wäre in beiden Fällen geraten, also steht hier nichts.",
  serviceCount: "eingetragen",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function integrationsServicesTexts(): string[] {
  return [
    ...Object.values(INTEGRATIONS_TEXTS),
    ...Object.values(INTEGRATION_SERVICES).flatMap((entry) => [
      entry.label, entry.purpose, entry.evidence, entry.limit, entry.managedAt,
    ]),
    ...INTEGRATIONS_INVISIBLE.flatMap((entry) => [entry.title, entry.body]),
    ...INTEGRATIONS_MISSING.flatMap((entry) => [entry.title, entry.body]),
    ...Object.values(INTEGRATIONS_STATES),
  ];
}
