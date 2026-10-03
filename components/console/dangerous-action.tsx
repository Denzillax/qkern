"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Zerstoerende Aktionen (2.137).
 *
 * **Der Befund.** Vor diesem Fall hing jede Loeschung an `window.confirm`.
 * Der Dialog sieht in jedem Browser gleich aus, egal ob eine Zeile oder ein
 * ganzer Bucket verschwindet, und ein Klick auf "OK" ist eine Handbewegung.
 * Drei der Dialoge standen dazu auf Deutsch im Code, ohne `t(...)`, also
 * blieben sie in jeder Sprache deutsch.
 *
 * **Warum der Name abgetippt wird.** Nicht bei jeder Loeschung, sondern wo
 * das Ergebnis nicht zurueckkommt: ein Bucket mit seinem Namen, eine
 * Function, ein Key, auf dem eine laufende Anwendung haengt. Abtippen
 * zwingt dazu, hinzusehen, welche der gleich aussehenden Zeilen getroffen
 * ist. Es ist keine Sicherheitsmassnahme, sondern eine gegen die eigene
 * Hand.
 *
 * **Was dieses Bauteil nicht tut.** Es erfindet keine Aktion. Ein Projekt
 * zuruecksetzen oder loeschen kann die Console heute nicht, keine Route
 * dafuer existiert, und darum steht hier auch kein Knopf dafuer.
 */
export function DangerousAction({ label, title, consequence, confirmName, onConfirm }: {
  /** Beschriftung des Knopfs, der die Bestaetigung oeffnet. */
  label: string;
  /** Was genau verschwindet, in einem Satz. */
  title: string;
  /** Was danach nicht mehr geht. */
  consequence: string;
  /** Der Name, der abgetippt werden muss. Fehlt er, reicht ein Druck. */
  confirmName?: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = confirmName === undefined || typed === confirmName;

  if (!open) {
    return <button type="button" className="danger-button" onClick={() => { setTyped(""); setOpen(true); }}>
      <Trash2 size={13} aria-hidden /> {label}
    </button>;
  }
  return <div className="danger-confirm">
    <p><AlertTriangle size={13} aria-hidden /> <strong>{title}</strong></p>
    <p>{consequence}</p>
    {confirmName !== undefined && <label>
      {t("Tippe den Namen ab, um die Zerstörung zu bestätigen")}
      <input type="text" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={confirmName} autoComplete="off" spellCheck={false}/>
    </label>}
    <div className="danger-confirm-actions">
      <button type="button" className="danger-button" disabled={!matches} onClick={() => { setOpen(false); setTyped(""); onConfirm(); }}>
        <Trash2 size={13} aria-hidden /> <StableLabel current={label} variants={tAll(label)}/>
      </button>
      <button type="button" className="secondary-button" onClick={() => { setOpen(false); setTyped(""); }}>{t("Abbrechen")}</button>
    </div>
  </div>;
}
