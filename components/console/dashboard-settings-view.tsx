"use client";

import { useMemo, useState } from "react";
import { Clock, Eye, Globe, Palette, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { OptionMenu } from "@/components/console/option-menu";
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
        {/* 2.133: Fuenf Menues statt fuenf `select`. Die Erklaerzeile traegt
            dort, wo es einen gibt, den Bezeichner, der hinter dem Wort steht:
            "Deutsch" ist der Name, `de` ist der Wert im Cookie, und `de-CH`
            ist das Gebietsschema, mit dem gerechnet wird. Wo die Beschriftung
            schon alles sagt -- "Wie der Browser", "Hell", "Europe/Zurich" --
            bleibt die Zeile weg. */}
        <label>{t("Sprache der Console")}
          <OptionMenu value={draft.language} ariaLabel={t("Sprache der Console")} listLabel={t("Sprache der Console wählen")}
            align="left" onChange={(next) => set("language", next)}
            options={[
              { id: CONSOLE_DISPLAY_INHERIT as ConsoleDisplaySettings["language"], label: t(CONSOLE_DISPLAY_INHERIT_LANGUAGE) },
              ...LOCALES.map((entry) => ({ id: entry as ConsoleDisplaySettings["language"], label: LOCALE_NAMES[entry], hint: entry })),
            ]}/>
        </label>
        <label>{t("Zahlen- und Datumsformat")}
          <OptionMenu value={draft.formatLocale} ariaLabel={t("Zahlen- und Datumsformat")} listLabel={t("Zahlen- und Datumsformat wählen")}
            align="left" onChange={(next) => set("formatLocale", next)}
            options={CONSOLE_FORMAT_LOCALES.map((entry) => ({
              id: entry, label: t(CONSOLE_FORMAT_LOCALE_LABELS[entry]), hint: entry,
            }))}/>
        </label>
        <label>{t("Zeitzone")}
          <OptionMenu value={draft.timeZone} ariaLabel={t("Zeitzone")} listLabel={t("Zeitzone wählen")}
            align="left" onChange={(next) => set("timeZone", next)}
            options={[
              { id: CONSOLE_DISPLAY_INHERIT as string, label: t(CONSOLE_DISPLAY_INHERIT_TIME_ZONE) },
              ...CONSOLE_SUGGESTED_TIME_ZONES.map((entry) => ({ id: entry as string, label: entry })),
            ]}/>
        </label>
        {/* Die Gruppe der Navigation als Erklaerzeile: Sie sagt, wo die Seite
            im Menue steht, und das ist genau die Frage vor dieser Wahl. */}
        <label>{t("Startseite der Console")}
          <OptionMenu value={draft.startView} ariaLabel={t("Startseite der Console")} listLabel={t("Startseite der Console wählen")}
            align="left" onChange={(next) => set("startView", next)}
            options={startEntries.map((entry) => ({
              id: entry.id as ConsoleDisplaySettings["startView"], label: t(entry.label), hint: t(entry.group),
            }))}/>
        </label>
        {/* Der Oberflaechenmodus steht auch oben in der Kopfzeile (2.134).
            Hier steht er trotzdem, weil diese Seite die Liste der eigenen
            Vorlieben ist: Wer sie durchgeht, soll nicht raten muessen, ob der
            Modus dazugehoert. Beide Wege schreiben dieselbe Spalte. */}
        <label>{t("Oberfläche")}
          <OptionMenu value={draft.interfaceMode} ariaLabel={t("Oberfläche")} listLabel={t("Oberfläche wählen")}
            align="left" onChange={(next) => set("interfaceMode", next)}
            options={[
              { id: "easy" as const, label: "Easy", hint: t("Das Häufige vorne, der Rest in Abschnitten") },
              { id: "advanced" as const, label: "Advanced", hint: t("Jede Gruppe offen, nichts eingeklappt") },
            ]}/>
        </label>
        <label>{t("Aussehen")}
          <OptionMenu value={draft.theme} ariaLabel={t("Aussehen")} listLabel={t("Aussehen wählen")}
            align="left" onChange={(next) => set("theme", next)}
            options={CONSOLE_THEMES.map((entry) => ({ id: entry, label: t(CONSOLE_THEME_LABELS[entry]) }))}/>
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
