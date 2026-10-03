import { NAV, REAL_VIEWS, type ViewId } from "@/components/console/navigation";

/**
 * Die Gruppen der Einstellungen (2.139).
 *
 * **Warum ein eigenes Modul.** Der Auftrag nennt sieben Gruppen, die Console
 * fuehrt unter Einstellungen zwoelf Menuepunkte, und beides passt nicht
 * eins zu eins aufeinander. Welche Ansicht in welcher Gruppe liegt, ist
 * darum eine Entscheidung und kein Nebenprodukt des Markups. Hier steht sie
 * als Daten, damit ein Vertrag sie lesen kann, ohne die Seite zu rendern.
 *
 * **Warum hier kein Text steht.** Jeder deutsche Satz der Console braucht
 * drei Uebersetzungen, und `console-i18n-contract` findet die Schluessel in
 * `components/console/*.tsx` und in den Textmodulen, die er namentlich
 * importiert. Ein neues Textmodul waere also stumm; die Saetze stehen darum
 * in `settings-view.tsx` als `t("...")`, und hier liegt allein die Struktur.
 *
 * **Warum `missing` ein Feld ist und keine Folgerung aus `views.length`.**
 * Die Gefahrenzone hat Verweise und trotzdem keine eigene Faehigkeit: Ein
 * Projekt loeschen, zuruecksetzen oder pausieren kann die Console nicht, und
 * ihre Verweise zeigen nur dorthin, wo das Einzelne zerstoerbar ist. Team hat
 * weder das eine noch das andere. Ein Feld sagt das; eine Laenge nicht.
 */
export const SETTINGS_GROUP_IDS = [
  "general", "infrastructure", "api-keys", "security", "billing", "team", "danger",
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

export type SettingsGroup = {
  id: SettingsGroupId;
  /** Ansichten, auf die diese Gruppe verweist, in der Reihenfolge der Anzeige. */
  views: readonly ViewId[];
  /**
   * `true`, wenn die Faehigkeit, die der Name der Gruppe nennt, in QKERN
   * nicht existiert. Diese Gruppen tragen einen Satz statt eines Knopfs.
   */
  missing: boolean;
};

/**
 * Die Zuordnung. `settings` selbst steht in keiner Gruppe, denn das ist diese
 * Seite. Eine Ansicht steht in genau einer Gruppe, mit einer Ausnahme:
 * `set-api-keys` steht auch in der Gefahrenzone, weil ein Widerruf dort
 * geschieht und ein widerrufener Schluessel eine laufende Anwendung anhaelt.
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  // Allgemein traegt die Werte des Projekts selbst und die Darstellung der
  // Console. Umbenennen gibt es nicht, also steht hier auch kein Feld dafuer.
  { id: "general", views: ["set-dashboard"], missing: false },
  // Infrastruktur: worauf das Projekt laeuft, und was bestellbar waere.
  { id: "infrastructure", views: ["set-infrastructure", "set-compute", "set-integrations"], missing: false },
  // Schluessel und die Endpunkte, die sie oeffnen.
  { id: "api-keys", views: ["set-api-keys", "set-jwt", "set-api", "storage-s3"], missing: false },
  // Sicherheit: der Berater, die Haertung der Anmeldung und das Audit-Log.
  { id: "security", views: ["advisors-security", "auth-protection", "auth-mfa", "logs"], missing: false },
  // Abrechnung, Verbrauch und Zusatzleistungen gehoeren zusammen gelesen.
  { id: "billing", views: ["set-billing", "monitoring", "set-addons"], missing: false },
  // Team: es gibt keine Mitglieder, keine Einladungen, keine Personenrollen.
  { id: "team", views: [], missing: true },
  // Gefahrenzone: kein Loeschen, kein Zuruecksetzen, kein Pausieren eines
  // Projekts. Die Verweise fuehren zu den Seiten, auf denen das Einzelne
  // wirklich zerstoerbar ist.
  { id: "danger", views: ["table", "storage", "set-api-keys", "compute"], missing: true },
];

/** Ein Weg in der Navigation: die Gruppe und der Eintrag, beides uebersetzbar. */
export type NavPath = { group: string; label: string };

/**
 * Die Beschriftung einer Ansicht, wie die Navigation sie fuehrt. Beide Teile
 * sind Schluessel der Uebersetzungstabelle, weil `console-i18n-contract`
 * jedes Label aus `NAV` ohnehin einsammelt; die Seite muss also keinen
 * eigenen Namen fuer eine Ansicht erfinden, die schon einen hat.
 */
export function navPath(view: ViewId): NavPath {
  for (const group of NAV) {
    if (group.children === undefined) {
      if (group.id === view) return { group: group.label, label: group.label };
      continue;
    }
    const child = group.children.find((entry) => entry.id === view);
    if (child) return { group: group.label, label: child.label };
  }
  // Unerreichbar, solange jede Ansicht in der Navigation steht; der Vertrag
  // `console-settings-groups-contract` belegt das fuer jede Zeile oben.
  return { group: view, label: view };
}

/** Ob eine Ansicht existiert. Ein Verweis ins Leere waere ein toter Knopf. */
export function isRealView(view: string): view is ViewId {
  return (REAL_VIEWS as readonly string[]).includes(view);
}
