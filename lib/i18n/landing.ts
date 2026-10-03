import type { Locale } from "@/lib/i18n/locales";

/**
 * Texte der Website in vier Sprachen (2.2). Deutsch ist die Vorlage; die
 * anderen drei sind Übersetzungen davon, keine eigenen Texte. Zahlen und
 * Daten kommen weiter aus den Manifesten; hier stehen nur Wörter.
 *
 * `names` übersetzt die Namen und Stacks der Prüfläufe, die als deutsche
 * Zeichenketten in den Manifesten liegen. Fehlt ein Eintrag, bleibt das
 * Original.
 */
export type LandingDictionary = {
  meta: { title: string; description: string };
  header: { nav: Array<[label: string, href: string]>; login: string; createProject: string; home: string; menuOpen: string; menuClose: string; language: string; mainNav: string; themeDark: string; themeLight: string };
  hero: { badge: string; title: string; lead: string; primary: string; secondary: string };
  record: { kicker: string; none: string; count: string; counterTitle: string; counterSmall: string; runs: string; stat: string };
  names: Record<string, string>;
  product: { title: string; lead: string; states: { done: string; part: string; open: string }; modules: Array<{ name: string; note: string }>; managed: { name: string; note: string } };
  verification: { eyebrow: string; title: string; steps: Array<{ title: string; text: string }> };
  bridge: { eyebrow: string; title: string; lead: string; items: string[]; cta: string; status: string; prompt: string; steps: Array<{ title: string; small: string }> };
  developers: { title: string; lead: string; rows: Array<{ title: string; text: string }> };
  gaps: { eyebrow: string; title: string; lead: string; items: string[] };
  /**
   * Der Preisabschnitt der Startseite ist seit 2.135 nur noch ein Anriss. Die
   * Tarife selbst stehen in `lib/pricing/plans.ts` und ihre Worte in
   * `lib/i18n/pricing.ts`; hier lagen sie doppelt, mit drei Plaenen und einem
   * Business-Preis, der dem auf `/pricing` widersprach. Zwei Preislisten sind
   * eine zu viel, und die falsche findet immer jemand.
   */
  pricing: { eyebrow: string; title: string; lead: string; cta: string; note: string };
  close: { title: string; lead: string; cta: string };
  footer: { tagline: string; product: string; developers: string; docs: string; company: string; modules: string; verification: string; bridge: string; pricing: string; console: string; interfaces: string; gaps: string; imprint: string; privacy: string; status: string; copyright: string; madeIn: string };
  docs: { title: string; pages: string; onThisPage: string; copy: string; copied: string; translationPending: string; menu: string };
  notFound: { title: string; heading: string; lead: string; home: string; docs: string };
  months: string[];
};

const de: LandingDictionary = {
  meta: { title: "QKERN, dein Backend, getestet bevor du es anfasst", description: "Datenbank, Login, Dateien, Realtime und Functions. Alles läuft gegen echte Dienste, und die Logs liegen im Repository." },
  header: { nav: [["Produkt", "/#product"], ["Dokumentation", "/docs"], ["Prüfverfahren", "/#verification"], ["KI", "/#ai"], ["Offene Punkte", "/#security"], ["Preise", "/pricing"]], login: "Anmelden", createProject: "Projekt erstellen", home: "QKERN Startseite", menuOpen: "Menü öffnen", menuClose: "Menü schliessen", language: "Sprache wählen", mainNav: "Hauptnavigation", themeDark: "Dark Mode aktivieren", themeLight: "Light Mode aktivieren" },
  hero: { badge: "{n} archivierte Prüfläufe", title: "Dein Backend. Getestet, bevor du es anfasst.", lead: "Datenbank, Login, Dateien, Realtime und Functions. Alles läuft gegen echte Dienste, und die Logs dazu kannst du im Repository nachlesen.", primary: "Projekt erstellen", secondary: "Console ansehen" },
  record: { kicker: "Prüflauf", none: "kein Lauf archiviert", count: "{n} von {n}", counterTitle: "Gegenprobe", counterSmall: "Garantien abgeschaltet, absichtlich fehlgeschlagen", runs: "{n} Läufe", stat: "{name} gegen {stack}" },
  names: {},
  product: {
    title: "Was heute läuft, und wie weit es belegt ist.",
    lead: "Zwei Fragen pro Modul: Läuft es? Und lief es gegen echte Dienste, mit archiviertem Log? Zertifiziert heisst nur das Zweite.",
    states: { done: "zertifiziert", part: "teilweise", open: "offen" },
    modules: [
      { name: "Datenbank und Migrationen", note: "Change Sets, Freigaben, Audit-Kette und Rollback gegen einen echten Server." },
      { name: "Generated Data API", note: "CRUD am Live-Schema, RLS und eine eigene Injection-Matrix." },
      { name: "Project Auth", note: "Passwort, Magic Link, TOTP und OIDC gegen echtes SMTP und echten Provider." },
      { name: "Object Storage", note: "Private Buckets, Quarantäne bis der Scanner urteilt, signierte Ablaufzeiten." },
      { name: "Realtime", note: "Dauerhafter Log, Fan-out über zwei Instanzen, Change Feed und Soak-Lauf." },
      { name: "Queues, Cron, Webhooks", note: "Atomare Claims, Leases, serverberechnetes Retry und Dead Letters." },
      { name: "Functions", note: "Container ohne Netz, harte Speichergrenze, vermittelte Ausgangsverbindungen." },
      { name: "Usage und Billing", note: "Alle sechs Metriken melden, Preisblatt, Rechnungslauf mit lückenlosem Nummernkreis. Keine Zahlungsanbindung." },
    ],
    managed: { name: "Managed Operations", note: "Provider-Onboarding, Hochverfügbarkeit und Restore sind beschrieben, aber nicht betrieben." },
  },
  verification: {
    eyebrow: "So prüfen wir", title: "Ein grüner Testlauf ist keine Zertifizierung.",
    steps: [
      { title: "Ausführen", text: "Jeder Adapter läuft gegen die echten Dienste: PostgreSQL, versitygw, ClamAV, SMTP, einen OIDC-Provider und Vault. Ein Speicher-Adapter kennt kein Rechtemodell und keine Transaktionsgrenze, also findet er die Fehler nicht, die Kunden treffen. Neun Produktfehler kamen so ans Licht." },
      { title: "Wiederholen", text: "Jeder Lauf zweimal, bevor ein Release entsteht. Rohlog und Manifest liegen im Repository, mit Commit, Exit-Code und Testzahlen." },
      { title: "Brechen", text: "Danach schalten wir die geprüfte Garantie ab und lassen die Suite noch einmal laufen. Fällt dabei kein Fall um, hat der Test nichts geprüft." },
    ],
  },
  bridge: {
    eyebrow: "QKERN AI Bridge", title: "Dein Agent baut. QKERN hält die Grenze.",
    lead: "Claude Code und Codex arbeiten über eng geschnittene MCP-Werkzeuge. Jede Aktion ist an Projekt, Umgebung und Berechtigung gebunden.",
    items: ["Kurzlebige, widerrufbare Tokens", "Vorschau vor jeder Änderung", "Manuell, abgesichert oder autonom je Umgebung", "Vollständiges Protokoll jeder Agentenaktion"],
    cta: "Console ansehen", status: "Wartet auf Freigabe",
    prompt: "Lege eine Tabelle für den Bestellverlauf an, aktiviere Row-Level Security und bereite eine Migration vor. Wende sie nicht an.",
    steps: [{ title: "Schema gelesen", small: "6 Tabellen, 4 Beziehungen, RLS aktiv" }, { title: "Migration geprüft", small: "0 zerstörende Operationen, Rollback vorhanden" }, { title: "Freigabe offen", small: "Risiko mittel, Umgebung Development" }],
  },
  developers: {
    title: "Drei Zugänge, die sich nicht gegenseitig übernehmen können.",
    lead: "Anwendung, Agent und Modellprovider haben je einen eigenen Schlüssel und einen eigenen Weg hinein.",
    rows: [
      { title: "Application API", text: "REST und SDK für deine Anwendung, gebunden an Public oder Service Key." },
      { title: "MCP Agent Interface", text: "Kleine Werkzeuge mit Freigabepflicht. Worker-Leases bleiben ausgeschlossen." },
      { title: "Model Provider API", text: "Optional und mit eigenem Schlüssel. Der Kontext bleibt unter deiner Kontrolle." },
    ],
  },
  gaps: {
    eyebrow: "Offene Punkte", title: "Was QKERN heute nicht kann.", lead: "Dieselbe Liste steht am Ende jeder Release-Notiz.",
    items: [
      "Function-Images müssen ausserhalb gebaut und in eine Registry geschoben werden; Inhaltslogs bleiben im Container.",
      "Die Data API kennt keine eingebetteten Joins.",
      "Billing hat keine Zahlungsanbindung.",
      "Managed Operations sind Nachweisverträge, kein betriebener Dienst: kein PITR, kein Restore-Drill.",
      "SDK und CLI sind nur auf Linux belegt, Windows und macOS stehen aus.",
    ],
  },
  pricing: {
    eyebrow: "Preise", title: "Fünf Tarife, in Franken.",
    lead: "Vom kostenlosen Projekt bis zum Vertrag mit Support. Welche Grenzen zu welchem Tarif gehören, legen wir vor dem Marktstart fest.",
    cta: "Alle Tarife ansehen",
    note: "Die Preise sind ein Entwurf; vor dem Marktstart prüfen wir sie. Dasselbe gilt für Aussagen zu Hosting, Datenresidenz und Compliance.",
  },
  close: { title: "Fang mit dem Kern an.", lead: "Ein Development-Projekt kostet nichts. Die Belege für diese Seite liegen im Repository unter docs/evidence.", cta: "Projekt erstellen" },
  footer: { tagline: "Dein Backend. Getestet, bevor du es anfasst.", product: "Produkt", developers: "Entwickler", docs: "Dokumentation", company: "Unternehmen", modules: "Module", verification: "Prüfverfahren", bridge: "AI Bridge", console: "Console", pricing: "Preise", interfaces: "Schnittstellen", gaps: "Offene Punkte", imprint: "Impressum, Vorlage", privacy: "Datenschutz, Vorlage", status: "Status", copyright: "© 2026 QKERN. Product MVP.", madeIn: "Entwickelt in der Schweiz. Hosting-Aussage noch nicht verifiziert." },
  docs: { title: "Dokumentation", pages: "Seiten", onThisPage: "Auf dieser Seite", copy: "Kopieren", copied: "Kopiert", translationPending: "Diese Seite gibt es bisher nur auf Deutsch. Die Übersetzung folgt.", menu: "Inhalt" },
  notFound: { title: "Seite nicht gefunden", heading: "Diese Seite gibt es nicht.", lead: "Vielleicht hat sich die Adresse geändert, vielleicht ein Tippfehler. Beides ist von hier aus schnell behoben.", home: "Zur Startseite", docs: "Zur Dokumentation" },
  months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};

const en: LandingDictionary = {
  meta: { title: "QKERN, your backend, tested before you touch it", description: "Database, login, files, realtime and functions. Everything runs against real services, and the logs are in the repository." },
  header: { nav: [["Product", "/#product"], ["Documentation", "/docs"], ["How we test", "/#verification"], ["AI", "/#ai"], ["Open items", "/#security"], ["Pricing", "/pricing"]], login: "Sign in", createProject: "Create a project", home: "QKERN home", menuOpen: "Open menu", menuClose: "Close menu", language: "Choose language", mainNav: "Main navigation", themeDark: "Switch to dark mode", themeLight: "Switch to light mode" },
  hero: { badge: "{n} archived test runs", title: "Your backend. Tested before you touch it.", lead: "Database, login, files, realtime and functions. Everything runs against real services, and you can read the logs in the repository.", primary: "Create a project", secondary: "See the console" },
  record: { kicker: "Test run", none: "no run archived", count: "{n} of {n}", counterTitle: "Counter-check", counterSmall: "Guarantees switched off, failed on purpose", runs: "{n} runs", stat: "{name} against {stack}" },
  names: { "Control Plane und Data API": "Control plane and Data API", "Object Storage": "Object storage", "Project Auth": "Project auth", "Functions": "Functions", "Webhook-Signatur": "Webhook signature", "Ausgehender Weg": "Outbound path", "MinIO und ClamAV": "MinIO and ClamAV", "versitygw und ClamAV": "versitygw and ClamAV", "Mailpit und Dex über TLS": "Mailpit and Dex over TLS", "Docker, Registry und PostgreSQL 17": "Docker, registry and PostgreSQL 17", "Echter HTTPS-Empfänger": "Real HTTPS receiver", "Backup und Restore": "Backup and restore", "TLS-PostgreSQL 17 mit WAL-Archiv": "TLS PostgreSQL 17 with WAL archive" },
  product: {
    title: "What runs today, and how far it is proven.",
    lead: "Two questions per module: does it run? And did it run against real services, with an archived log? Only the second one counts as certified.",
    states: { done: "certified", part: "partial", open: "open" },
    modules: [
      { name: "Database and migrations", note: "Change sets, approvals, audit chain and rollback against a real server." },
      { name: "Generated Data API", note: "CRUD on the live schema, RLS and our own injection matrix." },
      { name: "Project auth", note: "Password, magic link, TOTP and OIDC against real SMTP and a real provider." },
      { name: "Object storage", note: "Private buckets, quarantine until the scanner rules, signed expiry times." },
      { name: "Realtime", note: "Durable log, fan-out across two instances, change feed and soak run." },
      { name: "Queues, cron, webhooks", note: "Atomic claims, leases, server-computed retry and dead letters." },
      { name: "Functions", note: "Containers without network, hard memory limit, brokered outbound connections." },
      { name: "Usage and billing", note: "All six metrics report, price sheet, invoice run with a gapless number range. No payment integration." },
    ],
    managed: { name: "Managed operations", note: "Provider onboarding, high availability and restore are described, not operated." },
  },
  verification: {
    eyebrow: "How we test", title: "A green test run is not a certification.",
    steps: [
      { title: "Run", text: "Every adapter runs against the real services: PostgreSQL, versitygw, ClamAV, SMTP, an OIDC provider and Vault. An in-memory adapter knows no permission model and no transaction boundary, so it misses the bugs that hit customers. Nine product defects surfaced this way." },
      { title: "Repeat", text: "Every run twice before a release exists. Raw log and manifest live in the repository, with commit, exit code and test counts." },
      { title: "Break", text: "Then we switch off the guarantee under test and run the suite again. If no case falls, the test proved nothing." },
    ],
  },
  bridge: {
    eyebrow: "QKERN AI Bridge", title: "Your agent builds. QKERN holds the line.",
    lead: "Claude Code and Codex work through narrowly scoped MCP tools. Every action is bound to project, environment and permission.",
    items: ["Short-lived, revocable tokens", "Preview before every change", "Manual, guarded or autonomous per environment", "Full log of every agent action"],
    cta: "See the console", status: "Waiting for approval",
    prompt: "Create a table for the order history, enable row-level security and prepare a migration. Do not apply it.",
    steps: [{ title: "Schema read", small: "6 tables, 4 relations, RLS active" }, { title: "Migration checked", small: "0 destructive operations, rollback present" }, { title: "Approval open", small: "Risk medium, environment development" }],
  },
  developers: {
    title: "Three entry points that cannot take over each other.",
    lead: "Application, agent and model provider each have their own key and their own way in.",
    rows: [
      { title: "Application API", text: "REST and SDK for your application, bound to a public or service key." },
      { title: "MCP agent interface", text: "Small tools that require approval. Worker leases stay out of reach." },
      { title: "Model provider API", text: "Optional and with its own key. The context stays under your control." },
    ],
  },
  gaps: {
    eyebrow: "Open items", title: "What QKERN cannot do today.", lead: "The same list closes every release note.",
    items: [
      "Function images must be built outside and pushed to a registry; content logs stay in the container.",
      "The Data API has no embedded joins.",
      "Billing has no payment integration.",
      "Managed operations are evidence contracts, not an operated service: no PITR, no restore drill.",
      "SDK and CLI are proven on Linux only; Windows and macOS are pending.",
    ],
  },
  pricing: {
    eyebrow: "Pricing", title: "Five plans, in Swiss francs.",
    lead: "From a free project to a contract with support. Which limits belong to which plan is decided before launch.",
    cta: "See all plans",
    note: "Prices are a draft; we will review them before launch. The same goes for statements on hosting, data residency and compliance.",
  },
  close: { title: "Start with the core.", lead: "A development project costs nothing. The evidence for this page lives in the repository under docs/evidence.", cta: "Create a project" },
  footer: { tagline: "Your backend. Tested before you touch it.", product: "Product", developers: "Developers", docs: "Documentation", company: "Company", modules: "Modules", verification: "How we test", bridge: "AI Bridge", console: "Console", pricing: "Pricing", interfaces: "Interfaces", gaps: "Open items", imprint: "Imprint, template", privacy: "Privacy, template", status: "Status", copyright: "© 2026 QKERN. Product MVP.", madeIn: "Built in Switzerland. Hosting claim not yet verified." },
  docs: { title: "Documentation", pages: "Pages", onThisPage: "On this page", copy: "Copy", copied: "Copied", translationPending: "This page exists in German only for now. The translation is coming.", menu: "Contents" },
  notFound: { title: "Page not found", heading: "This page does not exist.", lead: "Maybe the address changed, maybe it is a typo. Either way, it is a short way back.", home: "Go to the home page", docs: "Go to the documentation" },
  months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const fr: LandingDictionary = {
  meta: { title: "QKERN, votre backend, testé avant que vous y touchiez", description: "Base de données, connexion, fichiers, temps réel et fonctions. Tout tourne contre de vrais services, et les journaux sont dans le dépôt." },
  header: { nav: [["Produit", "/#product"], ["Documentation", "/docs"], ["Nos tests", "/#verification"], ["IA", "/#ai"], ["Points ouverts", "/#security"], ["Tarifs", "/pricing"]], login: "Se connecter", createProject: "Créer un projet", home: "Accueil QKERN", menuOpen: "Ouvrir le menu", menuClose: "Fermer le menu", language: "Choisir la langue", mainNav: "Navigation principale", themeDark: "Activer le mode sombre", themeLight: "Activer le mode clair" },
  hero: { badge: "{n} tests archivés", title: "Votre backend. Testé avant que vous y touchiez.", lead: "Base de données, connexion, fichiers, temps réel et fonctions. Tout tourne contre de vrais services, et vous pouvez lire les journaux dans le dépôt.", primary: "Créer un projet", secondary: "Voir la console" },
  record: { kicker: "Test", none: "aucun test archivé", count: "{n} sur {n}", counterTitle: "Contre-épreuve", counterSmall: "Garanties désactivées, échec volontaire", runs: "{n} passages", stat: "{name} contre {stack}" },
  names: { "Control Plane und Data API": "Plan de contrôle et Data API", "Object Storage": "Stockage d'objets", "Project Auth": "Auth de projet", "Functions": "Fonctions", "Webhook-Signatur": "Signature des webhooks", "Ausgehender Weg": "Chemin sortant", "MinIO und ClamAV": "MinIO et ClamAV", "versitygw und ClamAV": "versitygw et ClamAV", "Mailpit und Dex über TLS": "Mailpit et Dex via TLS", "Docker, Registry und PostgreSQL 17": "Docker, registre et PostgreSQL 17", "Echter HTTPS-Empfänger": "Vrai récepteur HTTPS", "Backup und Restore": "Sauvegarde et restauration", "TLS-PostgreSQL 17 mit WAL-Archiv": "PostgreSQL 17 TLS avec archive WAL" },
  product: {
    title: "Ce qui tourne aujourd'hui, et jusqu'où c'est prouvé.",
    lead: "Deux questions par module : est-ce que ça tourne ? Et est-ce que ça a tourné contre de vrais services, avec un journal archivé ? Seule la seconde vaut certification.",
    states: { done: "certifié", part: "partiel", open: "ouvert" },
    modules: [
      { name: "Base de données et migrations", note: "Change sets, validations, chaîne d'audit et rollback contre un vrai serveur." },
      { name: "Generated Data API", note: "CRUD sur le schéma réel, RLS et notre propre matrice d'injection." },
      { name: "Auth de projet", note: "Mot de passe, lien magique, TOTP et OIDC contre un vrai SMTP et un vrai fournisseur." },
      { name: "Stockage d'objets", note: "Buckets privés, quarantaine jusqu'au verdict du scanner, expirations signées." },
      { name: "Temps réel", note: "Journal durable, diffusion sur deux instances, flux de changements et test d'endurance." },
      { name: "Files, cron, webhooks", note: "Réservations atomiques, baux, relance calculée côté serveur et lettres mortes." },
      { name: "Fonctions", note: "Conteneurs sans réseau, limite mémoire stricte, connexions sortantes via un intermédiaire." },
      { name: "Usage et facturation", note: "Les six métriques remontent, grille tarifaire, facturation avec numérotation sans trou. Pas de paiement intégré." },
    ],
    managed: { name: "Exploitation gérée", note: "Intégration de fournisseurs, haute disponibilité et restauration sont décrites, pas exploitées." },
  },
  verification: {
    eyebrow: "Nos tests", title: "Un test vert n'est pas une certification.",
    steps: [
      { title: "Exécuter", text: "Chaque adaptateur tourne contre les vrais services : PostgreSQL, versitygw, ClamAV, SMTP, un fournisseur OIDC et Vault. Un adaptateur en mémoire ne connaît ni modèle de droits ni frontière de transaction, il rate donc les erreurs qui touchent les clients. Neuf défauts produit sont apparus ainsi." },
      { title: "Répéter", text: "Chaque test deux fois avant qu'une version existe. Journal brut et manifeste sont dans le dépôt, avec commit, code de sortie et nombre de cas." },
      { title: "Casser", text: "Ensuite nous désactivons la garantie testée et relançons la suite. Si aucun cas ne tombe, le test n'a rien prouvé." },
    ],
  },
  bridge: {
    eyebrow: "QKERN AI Bridge", title: "Votre agent construit. QKERN tient la limite.",
    lead: "Claude Code et Codex passent par des outils MCP étroitement délimités. Chaque action est liée au projet, à l'environnement et à la permission.",
    items: ["Jetons éphémères et révocables", "Aperçu avant chaque changement", "Manuel, encadré ou autonome selon l'environnement", "Journal complet de chaque action d'agent"],
    cta: "Voir la console", status: "En attente de validation",
    prompt: "Crée une table pour l'historique des commandes, active la sécurité par ligne et prépare une migration. Ne l'applique pas.",
    steps: [{ title: "Schéma lu", small: "6 tables, 4 relations, RLS actif" }, { title: "Migration vérifiée", small: "0 opération destructrice, rollback présent" }, { title: "Validation ouverte", small: "Risque moyen, environnement development" }],
  },
  developers: {
    title: "Trois accès qui ne peuvent pas se substituer l'un à l'autre.",
    lead: "Application, agent et fournisseur de modèle ont chacun leur clé et leur propre chemin d'entrée.",
    rows: [
      { title: "Application API", text: "REST et SDK pour votre application, liés à une clé publique ou de service." },
      { title: "MCP Agent Interface", text: "De petits outils soumis à validation. Les baux des workers restent hors de portée." },
      { title: "Model Provider API", text: "Optionnelle et avec sa propre clé. Le contexte reste sous votre contrôle." },
    ],
  },
  gaps: {
    eyebrow: "Points ouverts", title: "Ce que QKERN ne sait pas faire aujourd'hui.", lead: "La même liste clôt chaque note de version.",
    items: [
      "Les images de fonctions doivent être construites à l'extérieur et poussées dans un registre ; les journaux de contenu restent dans le conteneur.",
      "La Data API ne connaît pas les jointures imbriquées.",
      "La facturation n'a pas de paiement intégré.",
      "L'exploitation gérée relève de contrats de preuve, pas d'un service exploité : ni PITR, ni exercice de restauration.",
      "SDK et CLI ne sont prouvés que sous Linux ; Windows et macOS restent à faire.",
    ],
  },
  pricing: {
    eyebrow: "Tarifs", title: "Cinq tarifs, en francs.",
    lead: "Du projet gratuit au contrat avec support. Les limites de chaque tarif seront fixées avant le lancement.",
    cta: "Voir tous les tarifs",
    note: "Les prix sont un brouillon ; nous les revoyons avant le lancement. Il en va de même des affirmations sur l'hébergement, la résidence des données et la conformité.",
  },
  close: { title: "Commencez par le noyau.", lead: "Un projet de développement ne coûte rien. Les preuves de cette page sont dans le dépôt, sous docs/evidence.", cta: "Créer un projet" },
  footer: { tagline: "Votre backend. Testé avant que vous y touchiez.", product: "Produit", developers: "Développeurs", docs: "Documentation", company: "Entreprise", modules: "Modules", verification: "Nos tests", bridge: "AI Bridge", console: "Console", pricing: "Tarifs", interfaces: "Interfaces", gaps: "Points ouverts", imprint: "Mentions légales, modèle", privacy: "Confidentialité, modèle", status: "Statut", copyright: "© 2026 QKERN. Product MVP.", madeIn: "Développé en Suisse. Affirmation sur l'hébergement pas encore vérifiée." },
  docs: { title: "Documentation", pages: "Pages", onThisPage: "Sur cette page", copy: "Copier", copied: "Copié", translationPending: "Cette page n'existe pour l'instant qu'en allemand. La traduction arrive.", menu: "Sommaire" },
  notFound: { title: "Page introuvable", heading: "Cette page n'existe pas.", lead: "L'adresse a peut-être changé, ou il s'agit d'une faute de frappe. Dans les deux cas, le retour est court.", home: "Aller à l'accueil", docs: "Aller à la documentation" },
  months: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

const it: LandingDictionary = {
  meta: { title: "QKERN, il tuo backend, testato prima che lo tocchi", description: "Database, login, file, realtime e funzioni. Tutto gira contro servizi reali, e i log sono nel repository." },
  header: { nav: [["Prodotto", "/#product"], ["Documentazione", "/docs"], ["Come testiamo", "/#verification"], ["IA", "/#ai"], ["Punti aperti", "/#security"], ["Prezzi", "/pricing"]], login: "Accedi", createProject: "Crea un progetto", home: "Pagina iniziale QKERN", menuOpen: "Apri il menu", menuClose: "Chiudi il menu", language: "Scegli la lingua", mainNav: "Navigazione principale", themeDark: "Attiva la modalità scura", themeLight: "Attiva la modalità chiara" },
  hero: { badge: "{n} test archiviati", title: "Il tuo backend. Testato prima che lo tocchi.", lead: "Database, login, file, realtime e funzioni. Tutto gira contro servizi reali, e i log li puoi leggere nel repository.", primary: "Crea un progetto", secondary: "Guarda la console" },
  record: { kicker: "Test", none: "nessun test archiviato", count: "{n} su {n}", counterTitle: "Controprova", counterSmall: "Garanzie disattivate, fallimento voluto", runs: "{n} esecuzioni", stat: "{name} contro {stack}" },
  names: { "Control Plane und Data API": "Piano di controllo e Data API", "Object Storage": "Storage a oggetti", "Project Auth": "Auth di progetto", "Functions": "Funzioni", "Webhook-Signatur": "Firma dei webhook", "Ausgehender Weg": "Percorso in uscita", "MinIO und ClamAV": "MinIO e ClamAV", "versitygw und ClamAV": "versitygw e ClamAV", "Mailpit und Dex über TLS": "Mailpit e Dex via TLS", "Docker, Registry und PostgreSQL 17": "Docker, registry e PostgreSQL 17", "Echter HTTPS-Empfänger": "Vero ricevitore HTTPS", "Backup und Restore": "Backup e ripristino", "TLS-PostgreSQL 17 mit WAL-Archiv": "PostgreSQL 17 TLS con archivio WAL" },
  product: {
    title: "Cosa funziona oggi, e fin dove è dimostrato.",
    lead: "Due domande per modulo: funziona? Ed è stato eseguito contro servizi reali, con un log archiviato? Solo la seconda conta come certificazione.",
    states: { done: "certificato", part: "parziale", open: "aperto" },
    modules: [
      { name: "Database e migrazioni", note: "Change set, approvazioni, catena di audit e rollback contro un server reale." },
      { name: "Generated Data API", note: "CRUD sullo schema reale, RLS e una matrice di injection nostra." },
      { name: "Auth di progetto", note: "Password, magic link, TOTP e OIDC contro SMTP reale e provider reale." },
      { name: "Storage a oggetti", note: "Bucket privati, quarantena fino al verdetto dello scanner, scadenze firmate." },
      { name: "Realtime", note: "Log durevole, fan-out su due istanze, change feed e test di durata." },
      { name: "Code, cron, webhook", note: "Claim atomici, lease, retry calcolato dal server e dead letter." },
      { name: "Funzioni", note: "Container senza rete, limite di memoria rigido, connessioni in uscita mediate." },
      { name: "Utilizzo e fatturazione", note: "Tutte e sei le metriche riportano, listino, ciclo di fatturazione con numerazione senza buchi. Nessun pagamento integrato." },
    ],
    managed: { name: "Operazioni gestite", note: "Onboarding dei provider, alta disponibilità e ripristino sono descritti, non operati." },
  },
  verification: {
    eyebrow: "Come testiamo", title: "Un test verde non è una certificazione.",
    steps: [
      { title: "Eseguire", text: "Ogni adattatore gira contro i servizi reali: PostgreSQL, versitygw, ClamAV, SMTP, un provider OIDC e Vault. Un adattatore in memoria non conosce né modello dei permessi né confine di transazione, quindi non trova gli errori che colpiscono i clienti. Nove difetti di prodotto sono emersi così." },
      { title: "Ripetere", text: "Ogni test due volte prima che esista una release. Log grezzo e manifest sono nel repository, con commit, codice di uscita e conteggio dei casi." },
      { title: "Rompere", text: "Poi disattiviamo la garanzia testata e rilanciamo la suite. Se nessun caso cade, il test non ha dimostrato nulla." },
    ],
  },
  bridge: {
    eyebrow: "QKERN AI Bridge", title: "Il tuo agente costruisce. QKERN tiene il confine.",
    lead: "Claude Code e Codex lavorano tramite strumenti MCP ben delimitati. Ogni azione è legata a progetto, ambiente e permesso.",
    items: ["Token a breve vita e revocabili", "Anteprima prima di ogni modifica", "Manuale, protetto o autonomo per ambiente", "Registro completo di ogni azione dell'agente"],
    cta: "Guarda la console", status: "In attesa di approvazione",
    prompt: "Crea una tabella per lo storico ordini, attiva la sicurezza a livello di riga e prepara una migrazione. Non applicarla.",
    steps: [{ title: "Schema letto", small: "6 tabelle, 4 relazioni, RLS attivo" }, { title: "Migrazione verificata", small: "0 operazioni distruttive, rollback presente" }, { title: "Approvazione aperta", small: "Rischio medio, ambiente development" }],
  },
  developers: {
    title: "Tre accessi che non possono sostituirsi a vicenda.",
    lead: "Applicazione, agente e provider di modelli hanno ciascuno la propria chiave e il proprio ingresso.",
    rows: [
      { title: "Application API", text: "REST e SDK per la tua applicazione, legati a una chiave pubblica o di servizio." },
      { title: "MCP Agent Interface", text: "Piccoli strumenti con obbligo di approvazione. I lease dei worker restano fuori portata." },
      { title: "Model Provider API", text: "Opzionale e con chiave propria. Il contesto resta sotto il tuo controllo." },
    ],
  },
  gaps: {
    eyebrow: "Punti aperti", title: "Cosa QKERN oggi non sa fare.", lead: "La stessa lista chiude ogni nota di rilascio.",
    items: [
      "Le immagini delle funzioni vanno costruite all'esterno e caricate in un registry; i log dei contenuti restano nel container.",
      "La Data API non conosce join annidati.",
      "La fatturazione non ha un pagamento integrato.",
      "Le operazioni gestite sono contratti di prova, non un servizio operato: niente PITR, nessuna esercitazione di ripristino.",
      "SDK e CLI sono dimostrati solo su Linux; Windows e macOS mancano.",
    ],
  },
  pricing: {
    eyebrow: "Prezzi", title: "Cinque tariffe, in franchi.",
    lead: "Dal progetto gratuito al contratto con supporto. I limiti di ogni tariffa li fissiamo prima del lancio.",
    cta: "Vedi tutte le tariffe",
    note: "I prezzi sono una bozza; li rivedremo prima del lancio. Lo stesso vale per le affermazioni su hosting, residenza dei dati e conformità.",
  },
  close: { title: "Comincia dal nucleo.", lead: "Un progetto di sviluppo non costa nulla. Le prove di questa pagina sono nel repository, sotto docs/evidence.", cta: "Crea un progetto" },
  footer: { tagline: "Il tuo backend. Testato prima che lo tocchi.", product: "Prodotto", developers: "Sviluppatori", docs: "Documentazione", company: "Azienda", modules: "Moduli", verification: "Come testiamo", bridge: "AI Bridge", console: "Console", pricing: "Prezzi", interfaces: "Interfacce", gaps: "Punti aperti", imprint: "Note legali, modello", privacy: "Privacy, modello", status: "Stato", copyright: "© 2026 QKERN. Product MVP.", madeIn: "Sviluppato in Svizzera. Affermazione sull'hosting non ancora verificata." },
  docs: { title: "Documentazione", pages: "Pagine", onThisPage: "In questa pagina", copy: "Copia", copied: "Copiato", translationPending: "Questa pagina esiste per ora solo in tedesco. La traduzione arriva.", menu: "Indice" },
  notFound: { title: "Pagina non trovata", heading: "Questa pagina non esiste.", lead: "Forse l'indirizzo è cambiato, forse è un errore di battitura. In entrambi i casi il ritorno è breve.", home: "Vai alla pagina iniziale", docs: "Vai alla documentazione" },
  months: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
};

export const LANDING: Record<Locale, LandingDictionary> = { de, en, fr, it };

export function getLandingDictionary(locale: Locale): LandingDictionary {
  return LANDING[locale];
}

/** Datum eines Prüflaufs in der Sprache der Seite, aus dem ISO-Datum des Manifests. */
export function formatDate(iso: string, locale: Locale): string {
  const [year, month, day] = iso.split("-").map(Number);
  const name = LANDING[locale].months[(month ?? 1) - 1];
  if (locale === "en") return `${name} ${day}, ${year}`;
  if (locale === "de") return `${day}. ${name} ${year}`;
  return `${day} ${name} ${year}`;
}
