"use client";

import { useEffect, useRef } from "react";
import styles from "@/app/page.module.css";

/**
 * Das Q-Feld im Hero (2.10): grosse, blasse Q-Symbole treiben langsam im
 * Hintergrund und weichen der Maus aus, jede Ebene anders tief; ein
 * weicher Lichtfleck folgt dem Zeiger. Rein dekorativ, `aria-hidden`,
 * ohne Einfluss auf Klicks (`pointer-events: none`).
 *
 * Bewegung nur, wo sie erwuenscht ist: `prefers-reduced-motion` schaltet
 * Drift und Parallaxe ab, Touch-Geraete bekommen nur den Drift.
 */
const Q_PATH = "M 426.11325315265435 339.61600182611454 L 376.67010002004827 339.61600182611454 L 327.2269468874422 306.6555238065957 L 376.67010002004827 273.69017358042186 L 327.2269468874422 240.72969556090277 L 376.67010002004827 240.72969556090277 L 426.11325315265435 273.69017358042186 L 376.67010002004827 306.6555238065956 L 426.11325315265435 339.61600182611454 Z M 277.788665961491 240.72969556090277 L 327.2269468874424 240.72969556090277 L 277.788665961491 273.69017358042186 L 327.2269468874424 306.6555238065957 L 277.788665961491 306.6555238065957 L 228.34551282888538 273.69017358042186 L 277.788665961491 240.72969556090277 Z";

/** Feste Positionen, damit Server und Client dasselbe rendern. */
const MARKS: ReadonlyArray<{ x: number; y: number; size: number; depth: number; duration: number; delay: number; rotate: number; opacity: number }> = [
  { x: 6, y: 12, size: 260, depth: 26, duration: 22, delay: 0, rotate: -8, opacity: 0.10 },
  { x: 78, y: 4, size: 340, depth: 40, duration: 28, delay: -9, rotate: 6, opacity: 0.08 },
  { x: 88, y: 58, size: 220, depth: 18, duration: 19, delay: -4, rotate: -14, opacity: 0.11 },
  { x: 14, y: 66, size: 180, depth: 14, duration: 24, delay: -13, rotate: 10, opacity: 0.09 },
  { x: 48, y: 82, size: 420, depth: 48, duration: 34, delay: -20, rotate: 4, opacity: 0.06 },
  { x: 60, y: 30, size: 140, depth: 10, duration: 17, delay: -6, rotate: -20, opacity: 0.12 },
  { x: 30, y: 40, size: 110, depth: 8, duration: 21, delay: -15, rotate: 16, opacity: 0.13 },
];

export function HeroField() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let target = { x: 0, y: 0, px: 0.5, py: 0.35 };
    let current = { x: 0, y: 0, px: 0.5, py: 0.35 };
    let frame = 0;
    let active = false;
    const tick = () => {
      current = {
        x: current.x + (target.x - current.x) * 0.08,
        y: current.y + (target.y - current.y) * 0.08,
        px: current.px + (target.px - current.px) * 0.12,
        py: current.py + (target.py - current.py) * 0.12,
      };
      node.style.setProperty("--mx", current.x.toFixed(4));
      node.style.setProperty("--my", current.y.toFixed(4));
      node.style.setProperty("--px", `${(current.px * 100).toFixed(2)}%`);
      node.style.setProperty("--py", `${(current.py * 100).toFixed(2)}%`);
      const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001 &&
        Math.abs(target.px - current.px) < 0.0005 && Math.abs(target.py - current.py) < 0.0005;
      if (settled) { active = false; return; }
      frame = requestAnimationFrame(tick);
    };
    const onMove = (event: MouseEvent) => {
      const rect = node.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      target = { x: px * 2 - 1, y: py * 2 - 1, px, py };
      node.classList.add(styles.fieldLit);
      if (!active) { active = true; frame = requestAnimationFrame(tick); }
    };
    const onLeave = () => { target = { x: 0, y: 0, px: target.px, py: target.py }; node.classList.remove(styles.fieldLit); if (!active) { active = true; frame = requestAnimationFrame(tick); } };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    return () => { window.removeEventListener("mousemove", onMove); document.removeEventListener("mouseleave", onLeave); cancelAnimationFrame(frame); };
  }, []);

  return <div ref={root} className={styles.field} aria-hidden="true">
    <div className={styles.fieldGlow}/>
    {MARKS.map((mark, index) => <svg
      key={index}
      className={styles.fieldMark}
      viewBox="208 220 238 140"
      style={{
        left: `${mark.x}%`, top: `${mark.y}%`, width: mark.size,
        "--depth": mark.depth, "--rotate": `${mark.rotate}deg`, "--opacity": mark.opacity,
        animationDuration: `${mark.duration}s`, animationDelay: `${mark.delay}s`,
      } as React.CSSProperties}
    ><path d={Q_PATH}/></svg>)}
  </div>;
}
