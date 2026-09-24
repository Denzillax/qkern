"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-Effekte der Landingpage (1.96), nach der Referenz: Abschnitte
 * gleiten beim ersten Sichtkontakt ein, Kennzahlen zaehlen von 0 hoch.
 *
 * Ohne JavaScript bleibt alles sichtbar: Die Ausblendung greift erst, wenn
 * `html[data-reveal="on"]` gesetzt ist — und das passiert im Effekt.
 * `prefers-reduced-motion` schaltet beides ab (CSS bzw. Sofortwert).
 */

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Reveal({ children, className, stagger = false, as: Tag = "div" }: {
  children: ReactNode; className?: string; stagger?: boolean; as?: "div" | "section" | "ul";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined" || reducedMotion()) { setInView(true); return; }
    document.documentElement.dataset.reveal = "on";
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const Component = Tag as "div";
  return <Component ref={ref as never} className={`${stagger ? "reveal-stagger" : "reveal"}${className ? ` ${className}` : ""}`} data-in={inView ? "true" : undefined}>{children}</Component>;
}

export function CountUp({ value, duration = 1400 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined" || reducedMotion()) return;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setShown(Math.round(value * eased));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      setShown(0);
      frame = requestAnimationFrame(tick);
      // Endwert unabhaengig von requestAnimationFrame: In Hintergrund-Tabs
      // pausiert der Frame-Takt, die Zahl darf trotzdem nie unter dem Beleg
      // stehen bleiben.
      settle = setTimeout(() => { cancelAnimationFrame(frame); setShown(value); }, duration + 120);
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); if (settle) clearTimeout(settle); };
  }, [value, duration]);
  return <span ref={ref}>{shown}</span>;
}
