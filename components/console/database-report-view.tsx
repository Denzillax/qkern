"use client";

import { Database, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber, formatPercent } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import { useDatabaseActivity, type Environment } from "@/components/console/database-activity-source";
import { cacheHitRatio, connectionLoad, DATABASE_REPORT_HONESTY } from "@/lib/console/database-activity-texts";

/**
 * Berichte → Datenbank (2.46): die Betriebszahlen der Projektdatenbank aus
 * `pg_stat_database`, gelesen über `database/activity`.
 *
 * Nur lesend. Kein Abfragetext, keine einzelne Sitzung, kein Beenden einer
 * Verbindung — die Seite hat keinen Knopf, der etwas in der Datenbank
 * verändert, und die Route kennt kein Schreibverb.
 *
 * Jede Zahl ist ein Zähler seit dem letzten Zurücksetzen der Statistik. Der
 * Satz dazu steht über den Zahlen und nicht im Kleingedruckten.
 */

/** Bytes lesbar, ohne eine Genauigkeit vorzutäuschen, die der Zähler nicht hat. */
function bytes(value: number): string {
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} KiB`;
  if (value < 1024 * 1024 * 1024) return `${formatNumber(Math.round(value / (1024 * 1024)))} MiB`;
  return `${formatNumber(Math.round(value / (1024 * 1024 * 1024)))} GiB`;
}

export function DatabaseReportView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const source = useDatabaseActivity(projectId, environment);
  const { state, activity, refreshing } = source;

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Betriebszahlen werden geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Database size={26}/>
      <h3>{state === "disabled" ? t("Die Data Plane ist abgeschaltet")
        : state === "unavailable" ? t("Datenbank nicht bereit")
          : t("Betriebszahlen nicht verfügbar")}</h3>
      <p>{state === "disabled"
        ? t("Ohne Verbindung zur Projektdatenbank gibt es keine Betriebszahlen. Diese Seite erfindet keine.")
        : source.message || t("Die Projektdatenbank hat nicht geantwortet.")}</p>
      <button className="secondary-button" onClick={() => source.reload(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const database = activity!.database;
  const hitRatio = cacheHitRatio(database.blocksHit, database.blocksRead);
  const load = connectionLoad(database.backends, database.maxConnections);
  const transactions = database.commits + database.rollbacks;

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("CACHE-TREFFERQUOTE")}</span>
        <strong>{hitRatio === null ? "–" : formatPercent(hitRatio)}</strong>
        <small>{hitRatio === null ? t("noch kein Block gelesen") : t("Blöcke aus dem Speicher statt von der Platte")}</small></div>
      <div><span>{t("VERBINDUNGEN")}</span>
        <strong>{formatNumber(database.backends)} / {formatNumber(database.maxConnections)}</strong>
        <small>{load === null ? t("ohne gemeldete Grenze") : `${formatPercent(load)} ${t("von max_connections")}`}</small></div>
      <div><span>{t("TRANSAKTIONEN")}</span>
        <strong>{formatNumber(transactions)}</strong>
        <small>{formatNumber(database.rollbacks)} {t("davon zurückgerollt")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BERICHTE")} · {environment.toUpperCase()}</span><h3>{t("Datenbank")}</h3></div><div>
        <button className="secondary-button" onClick={() => source.reload(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(DATABASE_REPORT_HONESTY)}</p>
      <p className="muted">{database.statsReset
        ? `${t("Zuletzt zurückgesetzt:")} ${formatMoment(database.statsReset)}`
        : t("Die Statistik wurde nie zurückgesetzt.")}</p>
      {hitRatio === null && <p className="muted">{t("Solange kein Block gelesen wurde, gibt es keine Trefferquote. Null Prozent wäre hier eine Behauptung.")}</p>}

      <div className="log-row log-header"><span>{t("Zahl")}</span><span>{t("Wert")}</span><span>{t("Was sie sagt")}</span></div>
      <div className="log-row"><span>{t("Commits")}</span><code>{formatNumber(database.commits)}</code><small>{t("abgeschlossene Transaktionen")}</small></div>
      <div className="log-row"><span>{t("Rollbacks")}</span><code>{formatNumber(database.rollbacks)}</code><small>{t("zurückgerollte Transaktionen; ein Fehler im Code zählt hier mit")}</small></div>
      <div className="log-row"><span>{t("Blöcke aus dem Cache")}</span><code>{formatNumber(database.blocksHit)}</code><small>{t("lagen schon im Speicher")}</small></div>
      <div className="log-row"><span>{t("Blöcke von der Platte")}</span><code>{formatNumber(database.blocksRead)}</code><small>{t("mussten gelesen werden; das Betriebssystem kann sie trotzdem gecacht haben")}</small></div>
      <div className="log-row"><span>{t("Deadlocks")}</span><code className={database.deadlocks > 0 ? "risk medium" : undefined}>{formatNumber(database.deadlocks)}</code><small>{t("gegenseitig blockierte Transaktionen, die die Datenbank aufgelöst hat")}</small></div>
      <div className="log-row"><span>{t("Temporäre Dateien")}</span><code>{formatNumber(database.tempFiles)}</code><small>{t("Sortierungen, die nicht in den Arbeitsspeicher passten")}</small></div>
      <div className="log-row"><span>{t("Temporäre Bytes")}</span><code>{bytes(database.tempBytes)}</code><small>{t("Menge, die dabei auf die Platte ging")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was diese Seite nicht zeigt")}</h3></div><Database size={18}/></div>
      <p className="muted">{t("QKERN liest aus den Statistiksichten nur Zähler. Abfragetexte, Adressen und einzelne Sitzungen verlassen die Datenbank nicht, und die Seite kann nichts beenden und nichts abbrechen.")}</p>
      <p className="muted">{t("Die Zahlen gelten für die Datenbank dieses Environments, nicht für den ganzen Server. Nur max_connections ist eine Einstellung des Servers.")}</p>
    </article>
  </div>;
}
