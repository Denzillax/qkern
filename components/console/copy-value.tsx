"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StableLabel } from "@/components/stable-label";

/**
 * Der eine Kopier-Weg (2.137).
 *
 * **Warum ein eigenes Bauteil und nicht `components/docs/copy-button`.** Der
 * Docs-Knopf hing an `app/docs/docs.module.css`, nur fuer die eine Klasse
 * `visuallyHidden`. Haette die Console ihn importiert, zoge jede
 * Console-Seite das Docs-Stylesheet mit, obwohl sie keine Regel daraus
 * braucht. Zwei Wege fuer dasselbe sind aber auch keine Loesung, darum ist
 * dieses Bauteil der eine Mechanismus und `CopyButton` ruft es auf. Die
 * versteckte Bestaetigung laeuft jetzt ueber die globale Klasse
 * `.visually-hidden`.
 *
 * **Warum eine Rueckmeldung ueberhaupt.** Vor diesem Fall standen in der
 * Console rohe `navigator.clipboard.writeText`-Aufrufe. Wer darauf drueckte,
 * sah nichts: nicht ob es geklappt hat, und nicht ob die Zwischenablage
 * ueberhaupt erreichbar war. Ohne Zwischenablage bleibt der Wert markierbar,
 * und der Knopf sagt es.
 */
export function CopyValue({ value, labels, className, children }: {
  value: string;
  labels: { copy: string; copied: string; failed?: string };
  className?: string;
  children?: React.ReactNode;
}) {
  const [phase, setPhase] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Nach dem Abbau darf kein Zeitgeber mehr den Zustand setzen.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: "done" | "failed" = "done";
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      next = "failed";
    }
    setPhase(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase("idle"), 1500);
  }

  // Ohne eigenen Fehlertext bleibt die Aufforderung stehen: Der Wert ist dann
  // noch nicht kopiert, und ein zweiter Druck ist das Richtige.
  const failed = labels.failed ?? labels.copy;
  const current = phase === "done" ? labels.copied : phase === "failed" ? failed : labels.copy;
  return (
    <>
      <button type="button" className={className ?? "secondary-button"} onClick={() => void copy()}>
        {phase === "done" ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {children}
        <StableLabel current={current} variants={[labels.copy, labels.copied, failed]} />
      </button>
      {/* Screenreader hoeren nur die Bestaetigung. Ausserhalb des Knopfs, damit sein Name nicht doppelt klingt. */}
      <span role="status" className="visually-hidden">{phase === "idle" ? "" : current}</span>
    </>
  );
}
