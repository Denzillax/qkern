"use client";

import { LayoutPanelLeft } from "lucide-react";

import { OptionMenu } from "@/components/console/option-menu";
import { t } from "@/components/console/console-i18n";
import { EASY_NAV, INTERFACE_MODES, NAV, type InterfaceMode } from "@/components/console/navigation";

/**
 * Der Umschalter fuer den Oberflaechenmodus (2.134).
 *
 * **Warum er dasselbe Bauteil ist wie das Umgebungsmenue.** Weil er daneben
 * steht. Zwei Menues in einer Kopfzeile, die verschieden aussehen, sind genau
 * der Fehler, den 2.133 ueberall sonst behoben hat.
 *
 * **Warum kein Schieber.** Ein Schieber zeigt zwei Zustaende und keinen Grund.
 * Hier steht in der Erklaerzeile, was die Wahl bedeutet, naemlich die Anzahl
 * der Gruppen im Menue, und die Zahl kommt aus den Navigationen selbst. Waere
 * sie abgeschrieben, waere sie beim naechsten neuen Menuepunkt falsch.
 *
 * **Warum "Easy" und "Advanced" stehen bleiben.** Es sind die Worte aus dem
 * Auftrag, sie sind in allen vier Sprachen dieselben, und sie sagen nichts
 * ueber die Person aus. "Anfaenger" waere eine Einordnung des Nutzers und
 * nicht der Oberflaeche.
 */
/**
 * Die Erklaerzeile je Modus, als Literal und nicht aus einer Tabelle: Der
 * i18n-Vertrag liest die Textliterale aus dem Quelltext, und einen Aufruf mit
 * einer Variablen darin findet er nicht. Eine Tabelle waere hier huebscher und
 * waere unuebersetzt.
 */
function modeHint(mode: InterfaceMode): string {
  return mode === "easy"
    ? t("Das Häufige vorne, der Rest in Abschnitten")
    : t("Jede Gruppe offen, nichts eingeklappt");
}

/** Die Anzahl Gruppen je Modus, gelesen und nicht geschrieben. */
export function interfaceModeGroupCount(mode: InterfaceMode): number {
  return mode === "easy" ? EASY_NAV.length : NAV.length;
}

export function InterfaceMenu({ value, onChange }: {
  value: InterfaceMode;
  onChange: (next: InterfaceMode) => void;
}) {
  return <OptionMenu
    value={value}
    ariaLabel={t("Oberfläche")}
    listLabel={t("Oberfläche wählen")}
    icon={<LayoutPanelLeft size={14} aria-hidden="true"/>}
    onChange={onChange}
    options={INTERFACE_MODES.map((entry) => ({
      id: entry,
      label: entry === "easy" ? "Easy" : "Advanced",
      hint: `${interfaceModeGroupCount(entry)} ${t("Gruppen")} · ${modeHint(entry)}`,
    }))}
  />;
}
