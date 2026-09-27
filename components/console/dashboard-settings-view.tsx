"use client";

import { useMemo, useState } from "react";
import { Clock, Eye, Globe, Palette, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { formatMoment, formatNumber, formatPercent } from "@/components/console/console-display";
import { formatMoneyMicros } from "@/lib/console/money";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/locales";
import { NAV_ENTRIES, REAL_VIEWS } from "@/components/console/navigation";
import {
  CONSOLE_DISPLAY_DEFAULTS,
  CONSOLE_DISPLAY_INHERIT,
  CONSOLE_FORMAT_LOCALES,
  CONSOLE_SUGGESTED_TIME_ZONES,
  CONSOLE_THEMES,
  ConsoleDisplayError,
  formatConsoleMoment,
  formatConsoleNumber,
  resolvedConsoleTimeZone,
  validateConsoleDisplaySettings,
  type ConsoleDisplaySettings,
  type ConsoleFormatLocale,
  type ConsoleTheme,
} from "@/lib/console/display-settings";
import {
  CONSOLE_DISPLAY_APPLIES,
  CONSOLE_DISPLAY_DAY,
  CONSOLE_DISPLAY_DEFAULTS_KEEP,
  CONSOLE_DISPLAY_INHERIT_LANGUAGE,
  CONSOLE_DISPLAY_INHERIT_TIME_ZONE,
  CONSOLE_DISPLAY_MONEY,
  CONSOLE_DISPLAY_SCOPE,
  CONSOLE_DISPLAY_TIME_ZONE_BEFORE,
  CONSOLE_FORMAT_LOCALE_LABELS,
  CONSOLE_THEME_LABELS,
} from "@/lib/console/display-settings-texts";

/**
 * Einstellungen -> Dashboard (2.55), wie bei Supabase unter Project Settings ->
 * Dashboard.
 *
 * Die Seite stellt fuenf Dinge ein, und alle fuenf wirken: die Sprache der
 * Console, das Gebietsschema fuer Datum, Uhrzeit und Zahlen, die Zeitzone, die
 * Ansicht, auf der die Console oeffnet, und das helle oder dunkle Aussehen.
 *
 * Der Teil, auf den es ankommt, ist die Vorschau. Sie rechnet mit demselben
 * reinen Modul, das jede andere Ansicht benutzt, und zeigt darum wirklich das,
 * was nach dem Speichern ueberall steht -- kein nachgebauter Beispieltext.
 * Ein Zeitpunkt mit Sekunden, ein kurzes Datum, eine Uhrzeit, eine grosse Zahl
 * und ein Geldbetrag stehen nebeneinander, mit der aufgeloesten Zeitzone
 * darunter.
 *
 * Der Betrag ist absichtlich dabei, obwohl er sich **nicht** aendert: Release
 * 2.37 hat Geld auf das Format des Ledgers festgelegt, und wer das Format
 * umstellt, soll auf derselben Seite sehen, dass der Betrag stehen bleibt,
 * statt es spaeter in einer Rechnung zu entdecken.
 */
type Props = {
  settings: ConsoleDisplaySettings;
  onSaved: (settings: ConsoleDisplaySettings) => void;
};

/** Ein Zeitpunkt, an dem sich eine Zeitzone wirklich zeigt: kurz vor Mitternacht UTC. */
const SAMPLE_MOMENT = "2026-09-24T22:30:15.000Z";
const SAMPLE_COUNT = 1_234_567;
const SAMPLE_MICROS = "12349999";

export function DashboardSettingsView({ settings, onSaved }: Props) {
  const [draft, setDraft] = useState<ConsoleDisplaySettings>(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Geprueft wird mit demselben reinen Modul, das die Route anwendet; was hier
  // als Vorschau steht, ist genau der Koerper, der abgeschickt wird.
  const checked = useMemo(() => {
    try {
      return { settings: validateConsoleDisplaySettings(draft), reason: "" };
    } catch (error) {
      return {
        settings: null,
        reason: error instanceof ConsoleDisplayError ? t(error.reason) : t("Aus dieser Eingabe lässt sich keine Darstellung bauen."),
      };
    }
  }, [draft]);

  const preview = checked.settings ?? CONSOLE_DISPLAY_DEFAULTS;
  const set = <K extends keyof ConsoleDisplaySettings>(key: K, value: ConsoleDisplaySettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function save(next: ConsoleDisplaySettings) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/console-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ? t(payload.error as string) : t("Die Darstellung wurde abgelehnt."));
        return;
      }
      const stored = payload.data as ConsoleDisplaySettings;
      setDraft(stored);
      onSaved(stored);
    } catch {
      setMessage(t("Die Darstellung konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }

  const startEntries = NAV_ENTRIES.filter((entry) => (REAL_VIEWS as readonly string[]).includes(entry.id));

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DARSTELLUNG")}</span><h3>{t("Ihre Console, in Ihrem Format")}</h3></div><ShieldCheck size={18}/></div>
      <p className="muted">{t(CONSOLE_DISPLAY_SCOPE)}</p>
      <p className="muted">{t(CONSOLE_DISPLAY_APPLIES)}</p>
      <p className="muted">{t(CONSOLE_DISPLAY_DEFAULTS_KEEP)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("EINSTELLUNGEN")}</span><h3>{t("Sprache, Format, Zeitzone, Startseite, Aussehen")}</h3></div><Palette size={18}/></div>
      <div className="settings-form">
        <label>{t("Sprache der Console")}
          <select value={draft.language} onChange={(event) => set("language", event.target.value as ConsoleDisplaySettings["language"])}>
            <option value={CONSOLE_DISPLAY_INHERIT}>{t(CONSOLE_DISPLAY_INHERIT_LANGUAGE)}</option>
            {LOCALES.map((entry) => <option key={entry} value={entry}>{LOCALE_NAMES[entry]}</option>)}
          </select>
        </label>
        <label>{t("Zahlen- und Datumsformat")}
          <select value={draft.formatLocale} onChange={(event) => set("formatLocale", event.target.value as ConsoleFormatLocale)}>
            {CONSOLE_FORMAT_LOCALES.map((entry) => <option key={entry} value={entry}>{t(CONSOLE_FORMAT_LOCALE_LABELS[entry])} · {entry}</option>)}
          </select>
        </label>
        <label>{t("Zeitzone")}
          <select value={draft.timeZone} onChange={(event) => set("timeZone", event.target.value)}>
            <option value={CONSOLE_DISPLAY_INHERIT}>{t(CONSOLE_DISPLAY_INHERIT_TIME_ZONE)}</option>
            {CONSOLE_SUGGESTED_TIME_ZONES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <label>{t("Startseite der Console")}
          <select value={draft.startView} onChange={(event) => set("startView", event.target.value as ConsoleDisplaySettings["startView"])}>
            {startEntries.map((entry) => <option key={entry.id} value={entry.id}>{t(entry.group)} · {t(entry.label)}</option>)}
          </select>
        </label>
        <label>{t("Aussehen")}
          <select value={draft.theme} onChange={(event) => set("theme", event.target.value as ConsoleTheme)}>
            {CONSOLE_THEMES.map((entry) => <option key={entry} value={entry}>{t(CONSOLE_THEME_LABELS[entry])}</option>)}
          </select>
        </label>
      </div>
      {message && <p className="risk high">{message}</p>}
      {!checked.settings && <p className="risk high">{checked.reason}</p>}
      <div>
        <button className="button" onClick={() => checked.settings && void save(checked.settings)} disabled={!checked.settings || saving}>
          <StableLabel current={saving ? t("Wird gespeichert…") : t("Darstellung speichern")} variants={tAll("Wird gespeichert…", "Darstellung speichern")}/>
        </button>
        <button className="secondary-button" onClick={() => void save(CONSOLE_DISPLAY_DEFAULTS)} disabled={saving}>
          <RefreshCw size={14}/> {t("Auf die Vorgaben zurückstellen")}
        </button>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Genau so steht es dann überall")}</h3></div><Eye size={18}/></div>
      <div className="detail-list">
        <div><span>{t("Zeitpunkt mit Sekunden")}</span><strong>{formatConsoleMoment(SAMPLE_MOMENT, preview, "dateTimeSeconds")}</strong></div>
        <div><span>{t("Kurzes Datum")}</span><strong>{formatConsoleMoment(SAMPLE_MOMENT, preview, "dateShort")}</strong></div>
        <div><span>{t("Uhrzeit")}</span><strong>{formatConsoleMoment(SAMPLE_MOMENT, preview, "hourMinute")}</strong></div>
        <div><span>{t("Grosse Zahl")}</span><strong>{formatConsoleNumber(SAMPLE_COUNT, preview)}</strong></div>
        <div><span>{t("Geldbetrag")}</span><strong>{formatMoneyMicros(SAMPLE_MICROS, "CHF")}</strong></div>
        <div><span>{t("Zeitzone")}</span><strong>{resolvedConsoleTimeZone(preview)}</strong></div>
      </div>
      <p className="muted">{t("Der Zeitpunkt in der Vorschau ist")} {SAMPLE_MOMENT} (UTC). <Clock size={13}/> <Globe size={13}/></p>
      <p className="muted">{t(CONSOLE_DISPLAY_TIME_ZONE_BEFORE)}</p>
      <p className="muted">{t(CONSOLE_DISPLAY_MONEY)}</p>
      <p className="muted">{t(CONSOLE_DISPLAY_DAY)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("JETZT AKTIV")}</span><h3>{t("Was diese Console gerade benutzt")}</h3></div><Globe size={18}/></div>
      <div className="detail-list">
        <div><span>{t("Zeitpunkt mit Sekunden")}</span><strong>{formatMoment(SAMPLE_MOMENT, "dateTimeSeconds")}</strong></div>
        <div><span>{t("Grosse Zahl")}</span><strong>{formatNumber(SAMPLE_COUNT)}</strong></div>
        <div><span>{t("Ein Anteil")}</span><strong>{formatPercent(0.1234)}</strong></div>
      </div>
    </article>
  </div>;
}
