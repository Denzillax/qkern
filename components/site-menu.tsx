"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Hamburger-Menue der Website (1.97). Unter 1000 px verschwindet die
 * Desktop-Navigation; bis dahin gab es keinen Ersatz — die Seite war auf dem
 * Telefon ohne Navigation. Das Menue liegt als Blatt unter der Kapsel,
 * schliesst bei Escape, bei Klick auf einen Eintrag und beim Wechsel auf
 * Desktop-Breite.
 */
export function SiteMenu({ links }: { links: ReadonlyArray<readonly [string, string]> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    const query = window.matchMedia("(min-width: 1001px)");
    function onWidth(event: MediaQueryListEvent) { if (event.matches) setOpen(false); }
    document.addEventListener("keydown", onKey); query.addEventListener("change", onWidth);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); query.removeEventListener("change", onWidth); document.body.style.overflow = ""; };
  }, [open]);
  const sheet = <>
    <div className="site-menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true"/>
    <nav id="site-menu" className="site-menu is-open" aria-label="Hauptnavigation">
      {links.map(([label, href]) => <Link key={label} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
      <div className="site-menu-actions">
        <Link className="secondary-button" href="/login" onClick={() => setOpen(false)}>Anmelden</Link>
        <Link className="button" href="/register" onClick={() => setOpen(false)}>Projekt erstellen</Link>
      </div>
    </nav>
  </>;
  return <>
    <button type="button" className="site-menu-button" aria-label={open ? "Menü schliessen" : "Menü öffnen"} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)}>
      {open ? <X size={20}/> : <Menu size={20}/>}
    </button>
    {/* Blatt und Abdunkelung liegen ausserhalb der Kopfzeile: So bleibt die
        Kapsel scharf und ungedimmt, und das Blatt nimmt die volle Breite. */}
    {open && typeof document !== "undefined" && createPortal(sheet, document.body)}
  </>;
}
