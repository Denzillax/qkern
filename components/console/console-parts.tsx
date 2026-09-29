"use client";

import { Database, X } from "lucide-react";
import { t } from "@/components/console/console-i18n";

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

/** Ein leerer Bereich: Symbol, Titel und ein Satz, der sagt, was fehlt. */
export function EmptyState({ icon: Icon, title, text }: { icon: typeof Database; title: string; text: string }) {
  return <div className="empty-state"><Icon size={28}/><h3>{title}</h3><p>{text}</p></div>;
}

/** Die Console-Daten kamen nicht; der Knopf fragt noch einmal. */
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error-state"><X size={30}/><h3>{t("Console-Daten konnten nicht geladen werden")}</h3><p>{message}</p><button className="button small" onClick={retry}>{t("Noch einmal")}</button></div>;
}

/** Das Haekchen vor einem erledigten Punkt. */
export function CheckIcon() {
  return <span className="check-icon">✓</span>;
}
