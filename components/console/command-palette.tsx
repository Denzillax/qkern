"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { NAV_ENTRIES, groupOf, type InterfaceMode, type ViewId } from "@/components/console/navigation";
import { navPath } from "@/lib/console/settings-groups";

/**
 * Die Befehlspalette, als Dialog (2.169).
 *
 * **Der Befund**, gemessen mit echten Tastendruecken: Enter tat nichts, auch
 * wenn es genau einen Treffer gab; Pfeiltasten gab es nicht; Escape hatte
 * keinen Empfaenger ausser dem Knopf "ESC" in 7 Pixeln; der Fokus kam nach dem
 * Schliessen nicht zurueck; und ein Screenreader erfuhr nicht, dass sich etwas
 * geoeffnet hatte, weil das Fenster keine Rolle trug. Die Treffer trugen
 * ausserdem immer die Namen der Advanced-Navigation.
 *
 * **Was jetzt gilt.** `role="dialog"` mit `aria-modal`, Fokus ins Suchfeld,
 * Pfeile bewegen die Auswahl (`aria-activedescendant`, der Fokus bleibt im
 * Feld, damit man weitertippen kann), Enter oeffnet die gewaehlte Ansicht,
 * Escape schliesst, und danach steht der Fokus wieder dort, wo er vorher war.
 * Gesucht wird wie bisher in beiden Namen; angezeigt wird der Name, den die
 * Seitenleiste im aktuellen Modus traegt.
 */
export function CommandPalette({ onClose, onNavigate, mode = "advanced" }: {
  onClose: () => void;
  onNavigate: (view: ViewId) => void;
  mode?: InterfaceMode;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef<Element | null>(null);

  useEffect(() => {
    previous.current = document.activeElement;
    input.current?.focus();
    return () => { (previous.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = NAV_ENTRIES.filter((item) => {
    const shown = navPath(item.id, mode);
    return `${item.group} ${item.label} ${t(item.group)} ${t(item.label)} ${shown.group} ${t(shown.group)} ${shown.label} ${t(shown.label)}`
      .toLowerCase().includes(needle);
  }).slice(0, 12);
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  function choose(view: ViewId) { onNavigate(view); onClose(); }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(Math.min(current + 1, matches.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(current - 1, 0)); }
    else if (event.key === "Enter" && matches[current]) { event.preventDefault(); choose(matches[current].id); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }

  return <div className="command-overlay" onMouseDown={onClose}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label={t("Console durchsuchen…")} onMouseDown={(event) => event.stopPropagation()}>
      <div className="command-input">
        <Search size={18} aria-hidden="true"/>
        <input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKey}
          placeholder={t("Console durchsuchen…")} aria-label={t("Console durchsuchen…")}
          role="combobox" aria-expanded="true" aria-controls="command-results"
          aria-activedescendant={matches[current] ? `command-option-${current}` : undefined}/>
        <button type="button" onClick={onClose} aria-label={t("Schliessen")}>Esc</button>
      </div>
      <div className="command-results" id="command-results" role="listbox" aria-label={t("NAVIGATION")}>
        <span aria-hidden="true">{t("NAVIGATION")}</span>
        {matches.map((item, index) => {
          const Icon = groupOf(item.id).icon;
          const shown = navPath(item.id, mode);
          return <button type="button" id={`command-option-${index}`} role="option" aria-selected={index === current}
            className={index === current ? "is-active" : undefined} tabIndex={-1}
            key={`${item.group}-${item.id}`} onMouseEnter={() => setActive(index)} onClick={() => choose(item.id)}>
            <Icon size={16} aria-hidden="true"/>{shown.group === shown.label ? t(shown.label) : `${t(shown.group)} · ${t(shown.label)}`}
            {index === current && <CornerDownLeft size={13} aria-hidden="true"/>}
          </button>;
        })}
        {matches.length === 0 && <p className="muted">{t("Kein Treffer. Gesucht wird in den Namen der Seiten, nicht in ihrem Inhalt.")}</p>}
      </div>
    </div>
  </div>;
}
