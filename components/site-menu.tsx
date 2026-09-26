"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Hamburger-Menue der Website (1.97). Unter 1260 px verschwindet die
 * Desktop-Navigation; bis dahin gab es keinen Ersatz — die Seite war auf dem
 * Telefon ohne Navigation. Das Menue liegt als Blatt unter der Kapsel,
 * schliesst bei Escape, bei Klick auf einen Eintrag und beim Wechsel auf
 * Desktop-Breite. Seit 2.2 kommen die Beschriftungen aus dem Woerterbuch.
 */
export function SiteMenu({ links, labels }: {
  links: ReadonlyArray<readonly [string, string]>;
  labels: { open: string; close: string; login: string; createProject: string };
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    const query = window.matchMedia("(min-width: 1261px)");
    function onWidth(event: MediaQueryListEvent) { if (event.matches) setOpen(false); }
    document.addEventListener("keydown", onKey); query.addEventListener("change", onWidth);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); query.removeEventListener("change", onWidth); document.body.style.overflow = ""; };
  }, [open]);
  const sheet = <>
    <div className="site-menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true"/>
    <nav id="site-menu" className="site-menu is-open" aria-label="Hauptnavigation">
      {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
      <div className="site-menu-actions">
        <Link className="secondary-button" href="/login" onClick={() => setOpen(false)}>{labels.login}</Link>
        <Link className="button" href="/register" onClick={() => setOpen(false)}>{labels.createProject}</Link>
      </div>
    </nav>
  </>;
  return <>
    <button type="button" className="site-menu-button" aria-label={open ? labels.close : labels.open} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)}>
      {open ? <X size={20}/> : <Menu size={20}/>}
    </button>
    {/* Blatt und Abdunkelung liegen ausserhalb der Kopfzeile: So bleibt die
        Kapsel scharf und ungedimmt, und das Blatt nimmt die volle Breite. */}
    {open && typeof document !== "undefined" && createPortal(sheet, document.body)}
  </>;
}
