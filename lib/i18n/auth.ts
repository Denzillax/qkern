import type { Locale } from "@/lib/i18n/locales";

/** Texte der Anmelde- und Registrierungsseite in vier Sprachen (2.2). */
export type AuthDictionary = {
  loginTitle: string; registerTitle: string;
  asideKicker: string; asideLogin: string; asideRegister: string; asideLead: string;
  boundaries: [string, string, string];
  eyebrow: string; cardLogin: string; cardRegister: string; leadLogin: string; leadRegister: string;
  switchLogin: string; switchLoginLink: string; switchRegister: string; switchRegisterLink: string;
  footer: string;
  email: string; emailPlaceholder: string; password: string; passwordPlaceholderLogin: string; passwordPlaceholderRegister: string;
  showPassword: string; hidePassword: string; ruleLength: string; ruleHash: string;
  wait: string; submitLogin: string; submitRegister: string; failed: string; security: string;
};

const de: AuthDictionary = {
  loginTitle: "Anmelden · QKERN", registerTitle: "Account erstellen · QKERN",
  asideKicker: "Kontrolliert, von Anfang an", asideLogin: "Willkommen zurück.", asideRegister: "Bau den Kern. Behalte die Kontrolle.",
  asideLead: "Datenbank, Auth, Storage, APIs und abgesicherte Agentenwerkzeuge in einer Plattform.",
  boundaries: ["Daten je Projekt getrennt", "MCP-Werkzeuge mit engem Scope", "Freigaben vor jeder Änderung"],
  eyebrow: "QKERN-Konto", cardLogin: "Melde dich an.", cardRegister: "Starte dein erstes Projekt.",
  leadLogin: "Öffne deine Organisationen, Projekte und offenen Freigaben.", leadRegister: "Dein Workspace und ein isoliertes Development-Projekt werden vorbereitet.",
  switchLogin: "Noch kein Konto?", switchLoginLink: "Jetzt starten", switchRegister: "Schon registriert?", switchRegisterLink: "Anmelden",
  footer: "QKERN MVP · Rechtstexte vor dem Marktstart prüfen",
  email: "E-Mail-Adresse", emailPlaceholder: "name@unternehmen.ch", password: "Passwort", passwordPlaceholderLogin: "Dein Passwort", passwordPlaceholderRegister: "Mindestens 12 Zeichen",
  showPassword: "Passwort anzeigen", hidePassword: "Passwort ausblenden", ruleLength: "Mindestens 12 Zeichen", ruleHash: "Mit Argon2id geschützt",
  wait: "Bitte warten…", submitLogin: "Anmelden", submitRegister: "Konto erstellen", failed: "Anmeldung fehlgeschlagen",
  security: "HttpOnly-Session · SameSite Strict · Rollenprüfung auf dem Server",
};

const en: AuthDictionary = {
  loginTitle: "Sign in · QKERN", registerTitle: "Create account · QKERN",
  asideKicker: "Controlled from the start", asideLogin: "Welcome back.", asideRegister: "Build the core. Keep control.",
  asideLead: "Database, auth, storage, APIs and guarded agent tools in one platform.",
  boundaries: ["Data isolated per project", "Narrowly scoped MCP tools", "Approvals before every change"],
  eyebrow: "QKERN account", cardLogin: "Sign in.", cardRegister: "Start your first project.",
  leadLogin: "Open your organisations, projects and pending approvals.", leadRegister: "Your workspace and an isolated development project are being prepared.",
  switchLogin: "No account yet?", switchLoginLink: "Get started", switchRegister: "Already registered?", switchRegisterLink: "Sign in",
  footer: "QKERN MVP · legal texts to be reviewed before launch",
  email: "Email address", emailPlaceholder: "name@company.ch", password: "Password", passwordPlaceholderLogin: "Your password", passwordPlaceholderRegister: "At least 12 characters",
  showPassword: "Show password", hidePassword: "Hide password", ruleLength: "At least 12 characters", ruleHash: "Protected with Argon2id",
  wait: "Please wait…", submitLogin: "Sign in", submitRegister: "Create account", failed: "Authentication failed",
  security: "HttpOnly session · SameSite Strict · role check on the server",
};

const fr: AuthDictionary = {
  loginTitle: "Connexion · QKERN", registerTitle: "Créer un compte · QKERN",
  asideKicker: "Sous contrôle dès le départ", asideLogin: "Bon retour.", asideRegister: "Construisez le noyau. Gardez le contrôle.",
  asideLead: "Base de données, auth, stockage, API et outils d'agent encadrés dans une seule plateforme.",
  boundaries: ["Données isolées par projet", "Outils MCP étroitement délimités", "Validations avant chaque changement"],
  eyebrow: "Compte QKERN", cardLogin: "Connectez-vous.", cardRegister: "Lancez votre premier projet.",
  leadLogin: "Ouvrez vos organisations, projets et validations en attente.", leadRegister: "Votre espace de travail et un projet de développement isolé sont en préparation.",
  switchLogin: "Pas encore de compte ?", switchLoginLink: "Commencer", switchRegister: "Déjà inscrit ?", switchRegisterLink: "Se connecter",
  footer: "QKERN MVP · textes légaux à vérifier avant le lancement",
  email: "Adresse e-mail", emailPlaceholder: "nom@entreprise.ch", password: "Mot de passe", passwordPlaceholderLogin: "Votre mot de passe", passwordPlaceholderRegister: "Au moins 12 caractères",
  showPassword: "Afficher le mot de passe", hidePassword: "Masquer le mot de passe", ruleLength: "Au moins 12 caractères", ruleHash: "Protégé par Argon2id",
  wait: "Veuillez patienter…", submitLogin: "Se connecter", submitRegister: "Créer le compte", failed: "Échec de l'authentification",
  security: "Session HttpOnly · SameSite Strict · vérification des rôles côté serveur",
};

const it: AuthDictionary = {
  loginTitle: "Accedi · QKERN", registerTitle: "Crea account · QKERN",
  asideKicker: "Sotto controllo fin dall'inizio", asideLogin: "Bentornato.", asideRegister: "Costruisci il nucleo. Mantieni il controllo.",
  asideLead: "Database, auth, storage, API e strumenti per agenti protetti in un'unica piattaforma.",
  boundaries: ["Dati isolati per progetto", "Strumenti MCP ben delimitati", "Approvazioni prima di ogni modifica"],
  eyebrow: "Account QKERN", cardLogin: "Accedi.", cardRegister: "Avvia il tuo primo progetto.",
  leadLogin: "Apri le tue organizzazioni, i progetti e le approvazioni in sospeso.", leadRegister: "Il tuo workspace e un progetto di sviluppo isolato sono in preparazione.",
  switchLogin: "Non hai ancora un account?", switchLoginLink: "Inizia", switchRegister: "Già registrato?", switchRegisterLink: "Accedi",
  footer: "QKERN MVP · testi legali da verificare prima del lancio",
  email: "Indirizzo e-mail", emailPlaceholder: "nome@azienda.ch", password: "Password", passwordPlaceholderLogin: "La tua password", passwordPlaceholderRegister: "Almeno 12 caratteri",
  showPassword: "Mostra password", hidePassword: "Nascondi password", ruleLength: "Almeno 12 caratteri", ruleHash: "Protetta con Argon2id",
  wait: "Attendere…", submitLogin: "Accedi", submitRegister: "Crea account", failed: "Autenticazione non riuscita",
  security: "Sessione HttpOnly · SameSite Strict · verifica dei ruoli sul server",
};

export const AUTH: Record<Locale, AuthDictionary> = { de, en, fr, it };
export function getAuthDictionary(locale: Locale): AuthDictionary { return AUTH[locale]; }
