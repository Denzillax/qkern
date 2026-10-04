"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";

/**
 * Ein Formular, das an Ort und Stelle aufklappt (2.166).
 *
 * **Wofuer.** Die Console fragte Eingaben ueber `window.prompt` ab: ein Fenster
 * je Feld, nacheinander. Ein Cron-Job brauchte vier davon, ein Webhook vier,
 * eine Function drei. Man sah nie alle Felder zugleich, ein Tippfehler im
 * dritten Fenster brach alles ab, und das Fenster gehoerte dem Browser, nicht
 * der Console: eigene Knoepfe, eigene Sprache, kein Hinweis am Feld.
 *
 * **Wie.** Dieselbe Form wie `DangerousAction`: Es klappt in der Seite auf,
 * statt ein Fenster zu oeffnen. Die Ansicht haelt, ob es offen ist; dieser
 * Baustein haelt die Werte. `onSubmit` gibt eine Fehlermeldung zurueck oder
 * `null`. Mit Meldung bleibt das Formular offen, und die Eingaben bleiben
 * stehen, damit man nur das falsche Feld korrigiert.
 *
 * **Vorbelegung.** Die Prompts waren mit Beispielen vorbelegt
 * ("nightly-report"). In einem Formular waeren das echte Werte, und ein
 * schneller Druck legte das Beispiel an. Beispiele stehen darum als
 * Platzhalter; vorbelegt wird nur eine echte Vorgabe wie `UTC`.
 */
export type FormPanelField = {
  name: string;
  label: string;
  hint?: string;
  placeholder?: string;
  initial?: string;
  required?: boolean;
  multiline?: boolean;
  /** Bezeichner, Pfade und Ausdruecke stehen in der Festbreitenschrift. */
  mono?: boolean;
};

export function FormPanel({ title, fields, submitLabel, onSubmit, onCancel }: {
  title: string;
  fields: FormPanelField[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((field) => [field.name, field.initial ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Der Fokus geht beim Schliessen dorthin zurueck, wo er beim Oeffnen stand,
  // also auf den Knopf, der das Formular geoeffnet hat (2.169). Gemessen:
  // Nach Escape lag er auf `body`. Steht der Knopf nicht mehr im Dokument,
  // etwa weil die Liste neu geladen wurde, bleibt es dabei.
  const previous = useRef<Element | null>(null);
  useEffect(() => {
    previous.current = document.activeElement;
    first.current?.focus();
    return () => {
      const target = previous.current as HTMLElement | null;
      if (target?.isConnected) target.focus();
    };
  }, []);

  const missing = fields.some((field) => field.required && !(values[field.name] ?? "").trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (missing || busy) return;
    setBusy(true);
    setError("");
    const message = await onSubmit(values);
    setBusy(false);
    if (message) setError(message);
  }

  return <form className="form-panel" onSubmit={(event) => void submit(event)}
    onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
    <h4>{title}</h4>
    {fields.map((field, index) => {
      const common = {
        id: `form-panel-${field.name}`,
        value: values[field.name] ?? "",
        placeholder: field.placeholder,
        autoComplete: "off",
        spellCheck: false,
        className: field.mono ? "mono" : undefined,
        "aria-describedby": field.hint ? `form-panel-${field.name}-hint` : undefined,
        ref: index === 0 ? first : undefined,
        onChange: (event: { target: { value: string } }) => setValues({ ...values, [field.name]: event.target.value }),
      };
      return <label key={field.name} htmlFor={common.id}>
        <span>{field.label}{field.required ? null : <em> {t("optional")}</em>}</span>
        {field.multiline ? <textarea rows={6} {...common}/> : <input type="text" {...common}/>}
        {field.hint && <small id={`form-panel-${field.name}-hint`}>{field.hint}</small>}
      </label>;
    })}
    {error && <p className="form-panel-error" role="alert">{error}</p>}
    <div className="form-panel-actions">
      <button type="submit" className="button small" disabled={missing || busy}>
        <StableLabel current={busy ? t("Wird gespeichert…") : submitLabel} variants={[...tAll("Wird gespeichert…"), submitLabel]}/>
      </button>
      <button type="button" className="secondary-button" onClick={onCancel}>{t("Abbrechen")}</button>
    </div>
  </form>;
}
