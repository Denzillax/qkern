"use client";

import { Gauge, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatDecimal, formatNumber, formatPercent } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { useQueryPerformance, type Environment } from "@/components/console/query-performance-source";
import {
  duration,
  durationFromMilliseconds,
  QUERY_PERFORMANCE_HONESTY,
  QUERY_PERFORMANCE_MISSING_EXTENSION,
  QUERY_PERFORMANCE_NO_TEXT,
  QUERY_PERFORMANCE_NO_TEXT_REASON,
  QUERY_PERFORMANCE_SHARE,
  rowsPerCall,
  timeShare,
} from "@/lib/console/query-performance-texts";

/**
 * Berichte -> Abfrage-Leistung (2.67): welche Statements der
 * Projektdatenbank Zeit kosten, gelesen über `database/statements` aus
 * `pg_stat_statements`.
 *
 * Eine Zeile ist ein normalisiertes Statement, benannt durch seine Kennung.
 * Der Abfragetext steht nicht da, und die Seite sagt das in einem eigenen
 * Satz, statt es den Leser suchen zu lassen. Der Grund dafür steht
 * ausgeschrieben an der Abfrage in der Data Plane: Ein Utility-Befehl behält
 * seine Literale, und ein Feld, das keinen Text trägt, kann auch kein
 * Passwort tragen.
 *
 * Fehlt die Erweiterung, zeigt die Seite keine leere Liste, sondern den
 * Satz, dass niemand mitzählt. Eine leere Liste hiesse "keine teuren
 * Abfragen", und das wäre eine Behauptung über etwas, das QKERN nicht
 * gemessen hat.
 */

export function QueryPerformanceView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const source = useQueryPerformance(projectId, environment);
  const { state, statements, refreshing } = source;

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Abfrage-Leistung wird geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Gauge size={26}/>
      <h3>{state === "disabled" ? t("Die Data Plane ist abgeschaltet")
        : state === "unavailable" ? t("Datenbank nicht bereit")
          : t("Abfrage-Leistung nicht verfügbar")}</h3>
      <p>{state === "disabled"
        ? t("Ohne Verbindung zur Projektdatenbank gibt es nichts zu messen. Diese Seite erfindet keine Abfragen.")
        : source.message || t("Die Projektdatenbank hat nicht geantwortet.")}</p>
      <button className="secondary-button" onClick={() => source.reload(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const digests = statements!.statements;
  const installed = statements!.installed;
  // Der Nenner des Anteils: die Summe der gezeigten Zeilen, nicht die Zeit der
  // ganzen Datenbank. Was das bedeutet, sagt QUERY_PERFORMANCE_SHARE.
  const sumTotalMs = digests.reduce((sum, digest) => sum + digest.totalTimeMs, 0);
  const sumCalls = digests.reduce((sum, digest) => sum + digest.calls, 0);
  const listed = durationFromMilliseconds(sumTotalMs);
  const slowest = digests.length > 0 ? duration(digests[0].meanTimeUs) : null;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("GEZEIGTE STATEMENTS")}</span><strong>{formatNumber(digests.length)}</strong><small>{t("die teuersten nach Gesamtzeit")}</small></div>
      <div><span>{t("AUFRUFE ZUSAMMEN")}</span><strong>{formatNumber(sumCalls)}</strong><small>{t("über alle gezeigten Statements")}</small></div>
      <div><span>{t("ZEIT DER GEZEIGTEN")}</span><strong>{formatDecimal(listed.value, listed.fractionDigits)}</strong><small>{t(listed.unit)}</small></div>
      <div><span>{t("TEUERSTE ZEILE IM MITTEL")}</span><strong>{slowest ? formatDecimal(slowest.value, slowest.fractionDigits) : t("keine")}</strong><small>{slowest ? t(slowest.unit) : t("es gibt keine Zeile")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BERICHTE")} · {environment.toUpperCase()}</span><h3>{t("Abfrage-Leistung")}</h3></div><div>
        <button className="secondary-button" onClick={() => source.reload(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(QUERY_PERFORMANCE_NO_TEXT)}</p>
      <p className="muted">{t(QUERY_PERFORMANCE_HONESTY)}</p>
      <p className="muted">{t(QUERY_PERFORMANCE_SHARE)}</p>

      {!installed && <p className="risk medium">{t(QUERY_PERFORMANCE_MISSING_EXTENSION)}</p>}
      {installed && statements!.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; es gibt mehr Statements als hier stehen.")}</p>}
      {installed && digests.length === 0 && <p className="muted">{t("Die Erweiterung zählt mit, hat aber für diese Datenbank noch kein Statement erfasst. Entweder wurde die Statistik gerade zurückgesetzt, oder diese Rolle darf keine Zeile mit Kennung sehen.")}</p>}

      {digests.length > 0 && <>
        <div className="log-row log-header">
          <span>{t("Kennung")}</span><span>{t("Aufrufe")}</span><span>{t("Gesamtzeit")}</span><span>{t("Mittelwert")}</span><span>{t("Zeilen")}</span><span>{t("Anteil")}</span>
        </div>
        {digests.map((digest) => {
          const total = durationFromMilliseconds(digest.totalTimeMs);
          const mean = duration(digest.meanTimeUs);
          const share = timeShare(digest.totalTimeMs, sumTotalMs);
          const perCall = rowsPerCall(digest.rows, digest.calls);
          return <div className="log-row" key={digest.id}>
            <code>{digest.id}</code>
            <span>{formatNumber(digest.calls)}</span>
            <span>{formatDecimal(total.value, total.fractionDigits)} {t(total.unit)}</span>
            <span>{formatDecimal(mean.value, mean.fractionDigits)} {t(mean.unit)}</span>
            <span>{formatNumber(digest.rows)}{perCall !== null && <small> ({formatDecimal(perCall, 1)} {t("je Aufruf")})</small>}</span>
            <span>{share === null ? t("nicht messbar") : formatPercent(share)}</span>
          </div>;
        })}
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Warum hier keine Abfrage steht")}</h3></div><Gauge size={18}/></div>
      <p className="muted">{t(QUERY_PERFORMANCE_NO_TEXT_REASON)}</p>
      <p className="muted">{t("Die Kennung ist ein Hash über den Abfragebaum. Sie bleibt über Neustarts gleich, und aus ihr lässt sich der Text nicht zurückrechnen. Welche Abfrage dahintersteckt, zeigt der Abfrageplan im SQL-Editor, wo der Text vom Menschen kommt.")}</p>
      <p className="muted">{t("Diese Seite kann nichts beenden, nichts zurücksetzen und keine Statistik löschen. Sie liest, und sie liest nur die Zeilen dieser einen Datenbank.")}</p>
    </article>
  </div>;
}
