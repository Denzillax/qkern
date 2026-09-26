"use client";

import { Plug, RefreshCw } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import { useDatabaseActivity, type Environment } from "@/components/console/database-activity-source";
import {
  CONNECTIONS_REPORT_HONESTY,
  connectionStateText,
  hiddenConnections,
  sessionAge,
} from "@/lib/console/database-activity-texts";

/**
 * Berichte → Verbindungen (2.46): offene Verbindungen je Rolle und Zustand,
 * gelesen über `database/activity`.
 *
 * Eine Zeile ist eine Gruppe, nie eine Sitzung. Der Server gruppiert und
 * zählt; die Console bekommt Rolle, Zustand, Anzahl und das Alter der
 * ältesten Sitzung der Gruppe. Kein Abfragetext, keine Adresse, keine
 * Prozessnummer — und keinen Knopf, der eine Verbindung beendet.
 *
 * Was diese Rolle nicht sehen darf, fehlt in der Zählung. PostgreSQL blendet
 * fremde Sitzungen für eine unprivilegierte Rolle aus; die Seite sagt das,
 * statt eine Vollständigkeit zu behaupten, die sie nicht prüfen kann.
 */
const NUMBER = new Intl.NumberFormat("de-CH");

export function ConnectionsReportView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const source = useDatabaseActivity(projectId, environment);
  const { state, activity, refreshing } = source;

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Verbindungen werden geladen…")}</h3></div>;
  }
  if (state === "disabled" || state === "unavailable" || state === "error") {
    return <div className="console-card live-module-state"><Plug size={26}/>
      <h3>{state === "disabled" ? t("Die Data Plane ist abgeschaltet")
        : state === "unavailable" ? t("Datenbank nicht bereit")
          : t("Verbindungen nicht verfügbar")}</h3>
      <p>{state === "disabled"
        ? t("Ohne Verbindung zur Projektdatenbank gibt es nichts zu zählen. Diese Seite erfindet keine Sitzungen.")
        : source.message || t("Die Projektdatenbank hat nicht geantwortet.")}</p>
      <button className="secondary-button" onClick={() => source.reload(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const groups = activity!.connections;
  const database = activity!.database;
  const counted = groups.reduce((sum, group) => sum + group.count, 0);
  const roles = new Set(groups.map((group) => group.role)).size;
  const working = groups.filter((group) => group.state === "active").reduce((sum, group) => sum + group.count, 0);
  // Der Unterschied zwischen numbackends und der Zählung ist eine Zahl, keine
  // Fussnote (2.57).
  const hidden = hiddenConnections(database.backends, counted);

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("GEZÄHLTE VERBINDUNGEN")}</span><strong>{NUMBER.format(counted)}</strong><small>{t("was diese Rolle sehen darf")}</small></div>
      <div><span>{t("FÜR DIESE ROLLE UNSICHTBAR")}</span><strong className={hidden > 0 ? "risk medium" : undefined}>{NUMBER.format(hidden)}</strong><small>{t("Backends, die die Datenbank meldet und die Zählung nicht enthält")}</small></div>
      <div><span>{t("ROLLEN")}</span><strong>{NUMBER.format(roles)}</strong><small>{t("verschiedene Rollen in der Zählung")}</small></div>
      <div><span>{t("DAVON ARBEITEND")}</span><strong>{NUMBER.format(working)}</strong><small>{t("führen gerade ein Statement aus")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BERICHTE")} · {environment.toUpperCase()}</span><h3>{t("Verbindungen")}</h3></div><div>
        <button className="secondary-button" onClick={() => source.reload(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(CONNECTIONS_REPORT_HONESTY)}</p>
      <p className="muted">{t("Die Datenbank selbst meldet")} {NUMBER.format(database.backends)} {t("offene Verbindungen bei einer Grenze von")} {NUMBER.format(database.maxConnections)}. {t("Gezählt sind")} {NUMBER.format(counted)}; {hidden > 0
        ? <>{NUMBER.format(hidden)} {t("Verbindungen meldet die Datenbank, ohne dass diese Rolle die zugehörigen Sitzungen sehen darf. Sie fehlen in jeder Zeile unten.")}</>
        : t("die Zählung erreicht die Zahl der Backends, diese Rolle sieht also gerade jede Sitzung dieser Datenbank.")}</p>
      {activity!.truncated && <p className="risk medium">{t("Die Antwort wurde an der Zeilengrenze abgeschnitten; es gibt mehr Gruppen als hier stehen.")}</p>}

      {groups.length === 0 && <p className="muted">{t("Keine sichtbare Verbindung. Entweder ist gerade keine offen, oder diese Rolle darf keine sehen.")}</p>}

      {groups.length > 0 && <>
        <div className="log-row log-header">
          <span>{t("Rolle")}</span><span>{t("Zustand")}</span><span>{t("Anzahl")}</span><span>{t("Älteste Sitzung")}</span>
        </div>
        {groups.map((group) => {
          const text = connectionStateText(group.state);
          const age = sessionAge(group.oldestSeconds);
          return <div className="log-row" key={`${group.role}:${group.state}`}>
            <strong>{group.role}</strong>
            <span className={text.tone}>{t(text.label)}</span>
            <code>{NUMBER.format(group.count)}</code>
            <span>{NUMBER.format(age.value)} {t(age.unit)}</span>
          </div>;
        })}
      </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was die Zustände bedeuten")}</h3></div><Plug size={18}/></div>
      {[...new Set(groups.map((group) => group.state))].map((state) => {
        const text = connectionStateText(state);
        return <div className="log-row" key={state}><span className={text.tone}>{t(text.label)}</span><small>{t(text.explains)}</small></div>;
      })}
      <p className="muted">{t("QKERN zeigt weder den Abfragetext einer Sitzung noch ihre Adresse, und es kann keine Sitzung beenden. Eine einzelne Sitzung ist ein Mensch bei der Arbeit; eine Anzahl ist eine Betriebszahl.")}</p>
    </article>
  </div>;
}
