"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { NavGroup, ViewId } from "@/components/console/navigation";
import { isPlaceholder } from "@/components/console/navigation";
import { t } from "@/components/console/console-i18n";

/**
 * Flyout für eine Gruppe in der eingeklappten Sidebar (2.5), Entwurf in
 * `docs/superpowers/specs/2026-09-25-collapsed-sidebar-flyout-design.md`.
 *
 * Öffnet nach kurzem Hover oder sofort per Klick, liegt rechts neben dem
 * Icon, scrollt bei langen Gruppen und bleibt im Fenster. Schliesst bei
 * Wahl eines Unterpunkts, Escape, Klick ausserhalb und kurz nachdem die
 * Maus Icon und Flyout verlassen hat.
 */
export const FLYOUT_HOVER_DELAY_MS = 150;
export const FLYOUT_GRACE_MS = 250;
export const FLYOUT_WIDTH = 220;
const VIEWPORT_MARGIN = 12;

export function SidebarFlyout({ group, view, badge, onNavigate }: {
  group: NavGroup & { children: NonNullable<NavGroup["children"]> };
  view: ViewId;
  badge: number;
  onNavigate: (view: ViewId) => void;
}) {
  const Icon = group.icon;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>({ left: 0, top: 0, maxHeight: 400 });
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = group.id === view || group.children.some((child) => child.id === view);

  const clearTimers = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
  };

  const place = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const maxHeight = window.innerHeight - 2 * VIEWPORT_MARGIN;
    setPosition({ left: rect.right + 8, top: rect.top, maxHeight });
  }, []);

  const show = useCallback(() => { clearTimers(); place(); setOpen(true); }, [place]);
  const hide = useCallback(() => { clearTimers(); setOpen(false); }, []);

  // Nach dem Rendern: ragt das Flyout unten aus dem Fenster, nach oben schieben.
  useEffect(() => {
    if (!open || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    const overflow = rect.bottom - (window.innerHeight - VIEWPORT_MARGIN);
    if (overflow > 0) setPosition((current) => ({ ...current, top: Math.max(VIEWPORT_MARGIN, current.top - overflow) }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || panel.current?.contains(target)) return;
      hide();
    }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") { hide(); anchor.current?.focus(); } }
    document.addEventListener("pointerdown", onPointer); document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, hide, place]);

  useEffect(() => () => clearTimers(), []);

  function onEnter() { if (open) { clearTimers(); return; } clearTimers(); hoverTimer.current = setTimeout(show, FLYOUT_HOVER_DELAY_MS); }
  function onLeave() { clearTimers(); if (open) graceTimer.current = setTimeout(() => setOpen(false), FLYOUT_GRACE_MS); }

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus();
  }

  return <>
    <button
      ref={anchor}
      type="button"
      className={`${isActive ? "active" : ""} has-children has-flyout`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={t(group.label)}
      title={open ? undefined : t(group.label)}
      onClick={() => (open ? hide() : show())}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); show(); setTimeout(() => panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(), 0); } }}
    >
      <Icon size={17}/><span>{t(group.label)}</span>{badge > 0 && <small>{badge}</small>}
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div
        ref={panel}
        className="sidebar-flyout"
        role="menu"
        aria-label={t(group.label)}
        style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, width: FLYOUT_WIDTH }}
        onMouseEnter={() => clearTimers()}
        onMouseLeave={onLeave}
        onKeyDown={onMenuKey}
      >
        <div className="sidebar-flyout-title">{t(group.label)}</div>
        <div className="sidebar-flyout-list">
          {group.children.map((child) => <button
            key={child.id}
            type="button"
            role="menuitem"
            className={`${view === child.id ? "active" : ""} ${isPlaceholder(child.id) ? "is-placeholder-entry" : "is-real-entry"}`}
            title={isPlaceholder(child.id) ? `${t(child.label)} · ${t("noch nicht verbunden")}` : undefined}
            onClick={() => { onNavigate(child.id); hide(); }}
          ><i className="nav-dot" aria-hidden="true"/><span>{t(child.label)}</span></button>)}
        </div>
      </div>,
      document.body,
    )}
  </>;
}
