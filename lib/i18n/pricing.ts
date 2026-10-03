import type { Locale } from "@/lib/i18n/locales";
import { PRICING_PLAN_IDS, type PricingPlanId } from "@/lib/pricing/plans";

/**
 * Die Worte der Preisseite in vier Sprachen (2.135), nach dem Muster von
 * `lib/i18n/landing.ts`: Deutsch ist die Vorlage, die anderen drei sind
 * Uebersetzungen davon.
 *
 * Hier stehen nur Worte. Kein Eintrag enthaelt eine Ziffer, und das ist eine
 * Regel, die der Vertrag prueft: Betraege kommen aus `lib/pricing/plans.ts`,
 * und technische Grenzen gibt es noch keine, die wir nennen koennten. Eine
 * Zahl in einem Uebersetzungstext waere entweder ein zweiter Preis oder eine
 * erfundene Grenze.
 */
export type PricingDictionary = {
  meta: { title: string; description: string };
  hero: { eyebrow: string; title: string; lead: string };
  /** `perMonth` traegt den Schraegstrich mit, weil die Preiszeile ihn braucht. */
  words: { from: string; perMonth: string; badge: string };
  plans: Record<PricingPlanId, { name: string; audience: string }>;
  cta: Record<PricingPlanId, string>;
  notes: { origin: string; metering: string; noOrderPath: string; businessContact: string; draft: string };
};

const de: PricingDictionary = {
  meta: {
    title: "Preise, QKERN",
    description: "Fünf Tarife in Schweizer Franken. Was du verbrauchst, wird gemessen, und die Console zeigt eine Projektion für den laufenden Monat.",
  },
  hero: {
    eyebrow: "Preise",
    title: "Fünf Tarife, in Franken.",
    lead: "Du zahlst den Tarif und das, was du darüber hinaus verbrauchst. Welche Grenzen zu welchem Tarif gehören, legen wir vor dem Marktstart fest; solange steht hier keine Zahl, die wir nicht halten können.",
  },
  words: { from: "ab", perMonth: "/ Monat", badge: "Most Popular" },
  plans: {
    free: { name: "Free", audience: "Zum Lernen und für Prototypen. Du probierst die geprüften Bausteine aus, ohne zu bezahlen." },
    launch: { name: "Launch", audience: "Für kleine Apps, die produktiv laufen und schon echte Nutzer haben." },
    pro: { name: "Pro", audience: "Für professionelle Apps und Startups, die ihr Geschäft auf das Backend stellen." },
    scale: { name: "Scale", audience: "Für grössere Anwendungen mit mehreren Umgebungen und mehreren Teams daran." },
    business: { name: "Business", audience: "Für Unternehmen, die verbindlichen Support brauchen. Umfang und Preis besprechen wir vorher." },
  },
  cta: {
    free: "Kostenlos starten",
    launch: "Launch wählen",
    pro: "Pro wählen",
    scale: "Scale wählen",
    business: "Vertrieb kontaktieren",
  },
  notes: {
    origin: "Entwickelt in der Schweiz; die Hosting-Aussage ist noch nicht verifiziert. Preise in Schweizer Franken.",
    metering: "Dein Verbrauch wird gemessen, und die Console zeigt daraus eine Projektion für den laufenden Monat.",
    noOrderPath: "Einen Bestellweg gibt es noch nicht, weil Billing keine Zahlungsanbindung hat. Die Knöpfe führen in die Registrierung.",
    businessContact: "Für Business ist noch keine Vertriebsadresse eingerichtet. Schreib dem Betreiber, bis sie hier steht.",
    draft: "Die Preise sind ein Entwurf und werden vor dem Marktstart geprüft.",
  },
};

const en: PricingDictionary = {
  meta: {
    title: "Pricing, QKERN",
    description: "Five plans in Swiss francs. Your usage is metered, and the console shows a projection for the current month.",
  },
  hero: {
    eyebrow: "Pricing",
    title: "Five plans, in francs.",
    lead: "You pay for the plan and for what you use beyond it. Which limits belong to which plan is something we settle before launch; until then there is no number here that we cannot keep.",
  },
  words: { from: "from", perMonth: "/ month", badge: "Most Popular" },
  plans: {
    free: { name: "Free", audience: "For learning and prototypes. Try the certified building blocks without paying." },
    launch: { name: "Launch", audience: "For small apps that are live and already have real users." },
    pro: { name: "Pro", audience: "For professional apps and startups that run their business on the backend." },
    scale: { name: "Scale", audience: "For larger applications with several environments and several teams on them." },
    business: { name: "Business", audience: "For companies that need committed support. We agree on scope and price first." },
  },
  cta: {
    free: "Start free",
    launch: "Choose Launch",
    pro: "Choose Pro",
    scale: "Choose Scale",
    business: "Contact Sales",
  },
  notes: {
    origin: "Built in Switzerland; the hosting claim is not verified yet. Prices in Swiss francs.",
    metering: "Your usage is metered, and the console turns it into a projection for the current month.",
    noOrderPath: "There is no order path yet, because billing has no payment integration. The buttons lead to sign-up.",
    businessContact: "There is no sales address for Business yet. Write to the operator until it appears here.",
    draft: "These prices are a draft and will be reviewed before launch.",
  },
};

const fr: PricingDictionary = {
  meta: {
    title: "Tarifs, QKERN",
    description: "Cinq forfaits en francs suisses. Votre consommation est mesurée, et la console en affiche une projection pour le mois en cours.",
  },
  hero: {
    eyebrow: "Tarifs",
    title: "Cinq forfaits, en francs.",
    lead: "Vous payez le forfait et ce que vous consommez au-delà. Les limites de chaque forfait seront fixées avant le lancement; d'ici là, aucun chiffre ici que nous ne puissions tenir.",
  },
  words: { from: "à partir de", perMonth: "/ mois", badge: "Most Popular" },
  plans: {
    free: { name: "Free", audience: "Pour apprendre et pour les prototypes. Essayez les briques certifiées sans payer." },
    launch: { name: "Launch", audience: "Pour les petites applications en production qui ont déjà de vrais utilisateurs." },
    pro: { name: "Pro", audience: "Pour les applications professionnelles et les startups qui bâtissent leur activité sur le backend." },
    scale: { name: "Scale", audience: "Pour les applications plus grandes, avec plusieurs environnements et plusieurs équipes." },
    business: { name: "Business", audience: "Pour les entreprises qui ont besoin d'un support engagé. Nous convenons d'abord du périmètre et du prix." },
  },
  cta: {
    free: "Commencer gratuitement",
    launch: "Choisir Launch",
    pro: "Choisir Pro",
    scale: "Choisir Scale",
    business: "Contacter le service commercial",
  },
  notes: {
    origin: "Développé en Suisse; l'affirmation sur l'hébergement n'est pas encore vérifiée. Prix en francs suisses.",
    metering: "Votre consommation est mesurée, et la console en tire une projection pour le mois en cours.",
    noOrderPath: "Il n'y a pas encore de parcours de commande, car la facturation n'a aucune connexion de paiement. Les boutons mènent à l'inscription.",
    businessContact: "Aucune adresse commerciale n'est encore en place pour Business. Écrivez à l'exploitant en attendant.",
    draft: "Ces prix sont une ébauche et seront revus avant le lancement.",
  },
};

const it: PricingDictionary = {
  meta: {
    title: "Prezzi, QKERN",
    description: "Cinque piani in franchi svizzeri. Il consumo viene misurato e la console ne mostra una proiezione per il mese in corso.",
  },
  hero: {
    eyebrow: "Prezzi",
    title: "Cinque piani, in franchi.",
    lead: "Paghi il piano e quello che consumi oltre. Quali limiti appartengano a quale piano lo stabiliamo prima del lancio; fino ad allora qui non c'è nessun numero che non possiamo mantenere.",
  },
  words: { from: "da", perMonth: "/ mese", badge: "Most Popular" },
  plans: {
    free: { name: "Free", audience: "Per imparare e per i prototipi. Provi i moduli certificati senza pagare." },
    launch: { name: "Launch", audience: "Per piccole app già in produzione, con utenti reali." },
    pro: { name: "Pro", audience: "Per app professionali e startup che costruiscono il proprio lavoro sul backend." },
    scale: { name: "Scale", audience: "Per applicazioni più grandi, con diversi ambienti e diversi team al lavoro." },
    business: { name: "Business", audience: "Per aziende che hanno bisogno di un supporto vincolante. Prima concordiamo portata e prezzo." },
  },
  cta: {
    free: "Inizia gratis",
    launch: "Scegli Launch",
    pro: "Scegli Pro",
    scale: "Scegli Scale",
    business: "Contatta il reparto vendite",
  },
  notes: {
    origin: "Sviluppato in Svizzera; l'affermazione sull'hosting non è ancora verificata. Prezzi in franchi svizzeri.",
    metering: "Il tuo consumo viene misurato e la console ne ricava una proiezione per il mese in corso.",
    noOrderPath: "Un percorso d'ordine non esiste ancora, perché la fatturazione non ha alcun collegamento di pagamento. I pulsanti portano alla registrazione.",
    businessContact: "Per Business non è ancora attivo un indirizzo commerciale. Fino ad allora scrivi al gestore.",
    draft: "Questi prezzi sono una bozza e saranno rivisti prima del lancio.",
  },
};

export const PRICING: Record<Locale, PricingDictionary> = { de, en, fr, it };

export function getPricingDictionary(locale: Locale): PricingDictionary {
  return PRICING[locale] ?? PRICING.de;
}

/** Die Tarife in der Reihenfolge der Seite, mit den Worten der Sprache daran. */
export function pricingPlanNames(dictionary: PricingDictionary): string[] {
  return PRICING_PLAN_IDS.map((id) => dictionary.plans[id].name);
}
