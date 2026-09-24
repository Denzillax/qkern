"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Globe } from "lucide-react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "@/lib/i18n/locales";

/**
 * Sprachwahl der Website (2.2). Schreibt das Cookie und lässt den Server
 * die Seite in der neuen Sprache rendern; kein Reload, kein Flackern.
 */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointer); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  function choose(next: Locale) {
    setOpen(false);
    if (next === locale) return;
    try { document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
    document.documentElement.lang = next;
    startTransition(() => router.refresh());
  }
  return <div className="language-switcher" ref={root}>
    <button type="button" className="icon-button language-button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)} disabled={pending}>
      <Globe size={16} aria-hidden="true"/><span>{locale.toUpperCase()}</span>
    </button>
    {open && <ul className="language-list" role="listbox" aria-label={label}>
      {LOCALES.map((entry) => <li key={entry} role="option" aria-selected={entry === locale}>
        <button type="button" lang={entry} onClick={() => choose(entry)}><span>{LOCALE_NAMES[entry]}</span>{entry === locale && <Check size={14} aria-hidden="true"/>}</button>
      </li>)}
    </ul>}
  </div>;
}
