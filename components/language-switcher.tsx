"use client";

import { useMenuKeyboard } from "@/components/use-menu-keyboard";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Globe } from "lucide-react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "@/lib/i18n/locales";
import { StableLabel } from "@/components/stable-label";

/**
 * Sprachwahl der Website (2.2). Schreibt das Cookie und lässt den Server
 * die Seite in der neuen Sprache rendern; kein Reload, kein Flackern.
 */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Tastatur, Klick ausserhalb und Fokus beim Schliessen (2.168).
  const { root, trigger, list, chose, onListKey } = useMenuKeyboard(open, setOpen);
  function choose(next: Locale, event: { detail: number }) {
    chose(event);
    if (next === locale) return;
    try { document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
    document.documentElement.lang = next;
    startTransition(() => router.refresh());
  }
  return <div className="language-switcher" ref={root}>
    <button type="button" ref={trigger} className="icon-button language-button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)} disabled={pending}>
      <Globe size={16} aria-hidden="true"/><StableLabel current={locale.toUpperCase()} variants={LOCALES.map((entry) => entry.toUpperCase())}/>
    </button>
    {open && <ul className="language-list" role="listbox" aria-label={label} ref={list as React.RefObject<HTMLUListElement>} onKeyDown={onListKey}>
      {LOCALES.map((entry) => <li key={entry} role="option" aria-selected={entry === locale}>
        <button type="button" lang={entry} onClick={(event) => choose(entry, event)}><span>{LOCALE_NAMES[entry]}</span>{entry === locale && <Check size={14} aria-hidden="true"/>}</button>
      </li>)}
    </ul>}
  </div>;
}
