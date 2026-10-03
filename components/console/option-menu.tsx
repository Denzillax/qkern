"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { StableLabel } from "@/components/stable-label";

/**
 * Das Auswahlmenue der Konsole (2.133).
 *
 * **Warum es das gibt.** Die Konsole hatte zwei Bauarten fuer dieselbe Sache:
 * das Umgebungsmenue oben in der Kopfzeile, ein eigenes Bauteil mit Punkt,
 * Titel, Erklaerzeile und Haken, und ueberall sonst ein `select` des
 * Betriebssystems. Das zweite sieht aus, wie das Betriebssystem es zeichnet,
 * und das ist auf Windows ein eckiger grauer Pfeil neben einer runden Flaeche.
 * Dieses Bauteil ist das erste, herausgeloest und ohne die Umgebungen darin.
 *
 * **Was es vom Vorbild uebernimmt.** Die Form, die Tastatur und das Verhalten:
 * Klick ausserhalb schliesst, Escape schliesst, `aria-haspopup="listbox"`, je
 * Eintrag `role="option"` mit `aria-selected`, Haken auf dem gewaehlten. Das
 * Schliessen haengt an `pointerdown` und nicht an `click`, damit ein Klick auf
 * einen anderen Knopf nicht erst das Menue schliesst und dann ins Leere geht.
 *
 * **Die Erklaerzeile ist freiwillig.** Beim Umgebungsmenue traegt sie die
 * Folgen der Wahl ("Schreibzugriffe brauchen Freigabe"). Wo es nichts zu
 * erklaeren gibt, bleibt sie weg, statt mit einer Wiederholung des Titels
 * gefuellt zu werden.
 *
 * **Der Punkt links ist freiwillig.** Er zeigt beim Vorbild einen Zustand an,
 * gruen fuer Development. Ohne Zustand waere er Zierde, darum steht an seiner
 * Stelle dann das Symbol, das der Aufrufer mitgibt, oder nichts.
 */
export type OptionMenuEntry<Id extends string> = {
  id: Id;
  label: string;
  /** Eine Zeile darunter, die die Folgen der Wahl nennt. Weglassen ist erlaubt. */
  hint?: string;
  /** Faerbt Punkt und Rand, wie `development`, `staging`, `production`. */
  tone?: string;
};

export function OptionMenu<Id extends string>({
  value, options = [], onChange, ariaLabel, listLabel, icon, align = "right",
}: {
  value: Id;
  options: readonly OptionMenuEntry<Id>[];
  onChange: (next: Id) => void;
  ariaLabel: string;
  listLabel: string;
  /** Steht links statt des Zustandspunkts. */
  icon?: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Ohne Eintraege bleibt der Knopf stehen und tut nichts: Der Render-Vertrag
  // zeichnet jede Ansicht ohne Daten, und ein Bauteil, das dabei wirft, macht
  // aus einer leeren Liste einen Absturz.
  const current = options.find((entry) => entry.id === value) ?? options[0];
  const tone = current?.tone ?? "";
  return <div className={`option-menu ${tone}`} ref={root}>
    <button type="button" className={`option-field ${tone}`} aria-haspopup="listbox"
            aria-expanded={open} aria-label={`${ariaLabel}: ${current?.label ?? ""}`}
            disabled={options.length === 0}
            onClick={() => setOpen(!open)}>
      {icon ?? <i aria-hidden="true"/>}
      <StableLabel current={current?.label ?? ""} variants={options.map((entry) => entry.label)}/>
      <ChevronDown size={14} aria-hidden="true" className={open ? "is-open" : ""}/>
    </button>
    {open && options.length > 0 && <ul className={`option-list ${align}`} role="listbox" aria-label={listLabel}>
      {options.map((entry) => <li key={entry.id} role="option" aria-selected={entry.id === value}
                                  className={entry.tone ?? ""}>
        <button type="button" onClick={() => { onChange(entry.id); setOpen(false); }}>
          {entry.tone ? <i aria-hidden="true"/> : null}
          <span><strong>{entry.label}</strong>{entry.hint ? <small>{entry.hint}</small> : null}</span>
          {entry.id === value && <Check size={14} aria-hidden="true"/>}
        </button>
      </li>)}
    </ul>}
  </div>;
}
