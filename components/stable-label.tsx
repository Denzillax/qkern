import type { ReactNode } from "react";

/**
 * Eine Beschriftung, die ihre Breite nicht ändert, wenn sie wechselt (2.4).
 *
 * Alle Varianten liegen in derselben Grid-Zelle; nur die aktive ist
 * sichtbar, die anderen sind unsichtbar, nehmen aber Platz. Die Breite ist
 * damit immer die der längsten Variante — egal ob ein Zustand wechselt
 * („Pausieren" → „Aktivieren") oder die Sprache („DE" → „EN").
 */
export function StableLabel({ current, variants, className }: { current: ReactNode; variants: ReadonlyArray<ReactNode>; className?: string }) {
  return <span className={`stable-label${className ? ` ${className}` : ""}`}>
    {variants.map((variant, index) => <span key={index} className="stable-label-ghost" aria-hidden="true">{variant}</span>)}
    <span className="stable-label-live">{current}</span>
  </span>;
}
