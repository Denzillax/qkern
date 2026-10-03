"use client";

import { Clock, Database, X } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/components/console/console-i18n";
import { activeTimeZoneName } from "@/components/console/console-display";

/**
 * Die kleinen Bausteine, die mehrere Ansichten gleich benutzen (2.65).
 *
 * Als 2.64 die dreizehn Ansichten aus `console-app.tsx` in eigene Dateien zog,
 * ging jede mit ihrer Kopie dieser Stuecke mit: `EmptyState` stand danach in
 * drei Dateien, `ErrorState` in zwei, `CheckIcon` in zwei. Es waren jedes Mal
 * dieselben Zeilen mit denselben Texten. Sie stehen jetzt hier.
 *
 * Diese Datei ist keine Seite. Sie liegt trotzdem in `components/console`,
 * weil der i18n-Vertrag und der Darstellungsvertrag genau diesen Ordner lesen;
 * eine Datei daneben faellt aus beiden heraus.
 */

/**
 * Ein leerer Bereich: Symbol, Titel und ein Satz, der sagt, was fehlt.
 *
 * `action` ist seit 2.137 dabei. Ein leerer Zustand, der nur feststellt, dass
 * nichts da ist, laesst den Betreiber stehen; wo die Ansicht die Sache selbst
 * anlegen kann, gehoert der Knopf dorthin, wo die Leere steht. Optional ist er,
 * weil es Ansichten gibt, die nur lesen -- dort waere ein Knopf eine Luege.
 */
export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Database; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><Icon size={28}/><h3>{title}</h3><p>{text}</p>{action !== undefined && <div className="empty-state-action">{action}</div>}</div>;
}

/**
 * Der leere Zustand einer Karte: ein erklaerender Satz, dazu der Knopf, der
 * die Sache anlegt oder in die Ansicht fuehrt, die es kann (2.137).
 *
 * Ohne `action` ist es genau das alte `<p className="muted">` mit einem Satz,
 * der etwas sagt. Das ist der Fall fuer jede Ansicht, die nur liest.
 */
export function InlineEmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="empty-state-inline"><p className="muted">{text}</p>{action}</div>;
}

/** Die Console-Daten kamen nicht; der Knopf fragt noch einmal. */
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error-state"><X size={30}/><h3>{t("Console-Daten konnten nicht geladen werden")}</h3><p>{message}</p><button className="button small" onClick={retry}>{t("Noch einmal")}</button></div>;
}

/** Das Haekchen vor einem erledigten Punkt. */
export function CheckIcon() {
  return <span className="check-icon">✓</span>;
}

/**
 * Die Zone, in der die Zeiten dieser Liste stehen (2.149).
 *
 * **Warum.** Jede Zeitangabe der Console wird in der Zone gerechnet, die in
 * Einstellungen -> Dashboard steht, und ohne Vorgabe in der Zone der Laufzeit.
 * Dastehen tat sie bisher nirgends. Ein Protokolleintrag um 14:05 ist damit
 * eine Angabe ohne Bezug: Wer in Zuerich sitzt und einen Vorfall mit einem
 * Kollegen in Singapur bespricht, vergleicht zwei verschiedene Uhren und merkt
 * es nicht. `activeTimeZoneName` gab es seit 2.55 und niemand hat sie benutzt.
 *
 * **Warum als Baustein und nicht je Ansicht.** Siebenundvierzig Ansichten
 * zeigen Zeitpunkte. Ein Satz, der in jeder einzeln steht, ist in der dritten
 * schon anders formuliert.
 */
export function TimeZoneNote({ className }: { className?: string }) {
  return <span className={className ?? "muted time-zone-note"}>
    <Clock size={12} aria-hidden="true"/> {t("Zeiten in")} {activeTimeZoneName()}
  </span>;
}
