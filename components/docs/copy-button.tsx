"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StableLabel } from "@/components/stable-label";
import styles from "@/app/docs/docs.module.css";

/** Kopiert einen Codeblock. Der Knopf wechselt die Beschriftung, nie die Breite. */
export function CopyButton({ code, labels }: { code: string; labels: { copy: string; copied: string } }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Nach dem Abbau darf kein Zeitgeber mehr den Zustand setzen.
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    } catch {
      // Ohne Zwischenablage bleibt der Text markierbar.
    }
  }
  return (
    <button type="button" className="ghost-button docs-copy" onClick={copy}>
      {done ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <StableLabel current={done ? labels.copied : labels.copy} variants={[labels.copy, labels.copied]} />
      {/* Screenreader hoeren nur die Bestaetigung, nicht jeden Wechsel der Beschriftung. */}
      <span role="status" className={styles.visuallyHidden}>{done ? labels.copied : ""}</span>
    </button>
  );
}
