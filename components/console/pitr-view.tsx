"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, ShieldCheck } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { formatDecimal, formatMoment, formatNumber } from "@/components/console/console-display";
import {
  POINT_IN_TIME_ASSERTION_TEXTS,
  POINT_IN_TIME_HONESTY,
  POINT_IN_TIME_STATE_TEXTS,
  POINT_IN_TIME_STEP_TEXTS,
  POINT_IN_TIME_WINDOW_TEXTS,
} from "@/lib/console/point-in-time-texts";
import type { PointInTimeRecoveryOverview } from "@/lib/server/backup/point-in-time";

/**
 * Datenbank → Point-in-time Recovery (2.53). Nur lesend, und bewusst arm an
 * Zahlen: Die Seite zeigt, was QKERN verantworten kann, und sagt beim Rest,
 * warum sie nichts zeigt. Kein Knopf stellt etwas wieder her; die Schritte
 * stehen als Text da, weil sie ein Mensch am Server ausfuehrt.
 */
type Environment = "development" | "staging" | "production";

/**
 * Sekunden als Zahl mit Einheit, ohne Rundung auf Minuten.
 *
 * Vorher stand hier `Math.round(seconds / 60)`. Damit erschien ein Rueckstand
 * von 29 Sekunden als "0", und das ist an genau dieser Stelle die
 * unguenstigste Luege: Die Zahl soll sagen, wie viel ein Wiederanlauf
 * verliert. Sekunden bleiben Sekunden, bis eine Minute voll ist.
 */
const seconds = (value: number) => value < 60
  ? `${formatNumber(value)} s`
  : `${formatDecimal(value / 60, 1)} min`;

export function PitrView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "error" }) {
  const [overview, setOverview] = useState<PointInTimeRecoveryOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/database/backups/point-in-time`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? t("Der Stand der Wiederherstellung ist nicht verfügbar."));
      setOverview(payload.data as PointInTimeRecoveryOverview); setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Der Stand der Wiederherstellung ist nicht verfügbar.")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Der Stand der Wiederherstellung wird geladen…")}</h3></div>;
  if (state === "error" || !overview) return <div className="console-card live-module-state"><History size={26}/><h3>{t("Nicht verfügbar")}</h3><p>{message}</p><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;

  const verdict = POINT_IN_TIME_STATE_TEXTS[overview.state];
  const drill = overview.lastDrill;

  return <div className="module-grid">
    <article className={`console-card span-2 ${overview.state === "no_archive" ? "placeholder-state" : ""}`}>
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t(verdict.label)}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button></div>
      <p>{t(verdict.explains)}</p>
      <p className="muted">{t(POINT_IN_TIME_HONESTY)}</p>
      {overview.archive.invalid.length > 0 && <p className="muted">{t("Unbrauchbar gesetzt und darum übergangen:")} {overview.archive.invalid.join(", ")}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FENSTER")}</span><h3>{t("Ältester und neuester Wiederherstellungspunkt")}</h3></div></div>
      <div className="bucket-row"><span className="bucket-icon"><History size={16}/></span>
        <div><strong>{overview.window.earliestRestorablePoint ? formatMoment(overview.window.earliestRestorablePoint, "dateTimeSeconds") : t("nicht bekannt")}</strong>
          <small>{t("Ältester Punkt")}{overview.window.earliestSource === "retention" ? ` · ${t("aus der erklärten Aufbewahrung")}` : overview.window.earliestSource === "archiving_since" ? ` · ${t("aus dem erklärten Beginn der Archivierung")}` : ""}</small></div>
      </div>
      <div className="bucket-row"><span className="bucket-icon"><History size={16}/></span>
        <div><strong>{t("nicht bekannt")}</strong><small>{t("Neuester Punkt")}</small></div>
      </div>
      <p className="muted">{t(POINT_IN_TIME_WINDOW_TEXTS[overview.window.reason])}</p>
      {overview.archive.retentionDays !== null && <p className="muted">{t("Erklärte Aufbewahrung in Tagen:")} {overview.archive.retentionDays}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("LETZTER DRILL")}</span><h3>{drill ? t("Was der letzte Drill belegt hat") : t("Kein gültiger Drill")}</h3></div></div>
      {!drill && <p className="muted">{t("Es liegt keine gültige, signierte Evidenz eines Restore-Drills vor. Entweder ist die Prüfung nicht eingeschaltet, oder die Evidenz ist älter, als die Policy zulässt.")}</p>}
      {drill && <>
        <article className="console-card auth-overview">
          <div><span>{t("GEPRÜFT AM")}</span><strong>{formatMoment(drill.verifiedAt, "dateTimeSeconds")}</strong><small>{t("Zeitpunkt der Prüfung")}</small></div>
          <div><span>{t("RÜCKSTAND")}</span><strong>{seconds(drill.recoveryPointLagSeconds)}</strong><small>{t("Zeit zwischen Snapshot und Ende des Backups")}</small></div>
          <div><span>{t("DAUER")}</span><strong>{seconds(drill.restoreDurationSeconds)}</strong><small>{t("Zeit, bis der wiederhergestellte Server stand")}</small></div>
        </article>
        {drill.proves.map((assertion) => <div className="bucket-row" key={assertion}><span className="bucket-icon"><ShieldCheck size={16}/></span>
          <div><small>{t(POINT_IN_TIME_ASSERTION_TEXTS[assertion])}</small></div></div>)}
        <p className="muted">{t("Der Drill läuft gegen einen eigenen Stack mit eigenem WAL-Archiv, und er stellt dort die Kontrollebene wieder her, nicht diese Projektdatenbank. Er belegt das Verfahren und die Software, nicht das Archiv dieser Umgebung.")}</p>
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORGEHEN")}</span><h3>{t("Wiederherstellung auf einen Zeitpunkt, Schritt für Schritt")}</h3></div></div>
      <ol>{overview.steps.map((step, index) => <li key={step}>{index + 1}. {t(POINT_IN_TIME_STEP_TEXTS[step])}</li>)}</ol>
      <p className="muted">{t("Diese Seite führt nichts davon aus. Eine Wiederherstellung greift in laufende Daten ein und gehört an die Hand eines Menschen, der den Server vor sich hat.")}</p>
    </article>
  </div>;
}
