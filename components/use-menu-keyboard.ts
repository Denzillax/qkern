"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Was ein aufklappendes Menue mit der Tastatur tut (2.168).
 *
 * **Der Befund.** Die Console hatte vier Menues nach demselben Muster:
 * Auswahl, Umgebung, Sprache und Konto. Gemessen mit echten Tastendruecken:
 * Nach Escape und nach einer Auswahl lag der Fokus auf `body`, weil der
 * Eintrag, der ihn hielt, beim Schliessen verschwand. Wer mit der Tastatur
 * arbeitet, stand danach am Anfang der Seite. Pfeiltasten gab es nicht,
 * obwohl die Liste sich als `listbox` ausgibt.
 *
 * **Was der Hook tut.** Klick ausserhalb schliesst, Escape schliesst und gibt
 * den Fokus an den Knopf zurueck. Beim Oeffnen steht der Fokus auf dem
 * gewaehlten Eintrag oder dem ersten benutzbaren. Pfeil hoch und runter, Pos1
 * und Ende bewegen ihn in der Liste. Ein Klick ausserhalb nimmt den Fokus
 * nicht zurueck: Dort hat jemand schon woanders hingezeigt.
 */
const ITEMS = "li > button:not(:disabled), [role='menuitem']:not(:disabled)";

export function useMenuKeyboard(open: boolean, setOpen: (next: boolean) => void) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const selected = list.current?.querySelector<HTMLButtonElement>("[aria-selected='true'] > button:not(:disabled)");
    (selected ?? list.current?.querySelector<HTMLButtonElement>(ITEMS))?.focus();
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") close(true); }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, close]);

  function onListKey(event: ReactKeyboardEvent<HTMLElement>) {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? Math.min(at + 1, items.length - 1)
      : event.key === "ArrowUp" ? Math.max(at - 1, 0)
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  }

  /** Nach einer Wahl: Mit der Tastatur ausgeloest (`detail === 0`) geht der Fokus zurueck. */
  function chose(event: { detail: number }) { close(event.detail === 0); }

  return { root, trigger, list, close, chose, onListKey };
}
