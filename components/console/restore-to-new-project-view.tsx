"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveRestore, Ban, Link2Off, RefreshCw, ShieldCheck, Sprout } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  RESTORE_ANSWER,
  RESTORE_CHAIN_STATE_TEXTS,
  RESTORE_CHAIN_TEXTS,
  RESTORE_HONESTY,
  RESTORE_KNOWLEDGE_ITEMS,
  RESTORE_KNOWLEDGE_TEXTS,
  RESTORE_QUESTION,
  RESTORE_SAME_EVIDENCE,
  RESTORE_TODAY_ITEMS,
  RESTORE_TODAY_TEXTS,
  restoreChain,
  type RestoreChainStep,
} from "@/lib/console/restore-to-new-project-texts";
import type { PointInTimeRecoveryOverview } from "@/lib/server/backup/point-in-time";

/**
 * Datenbank → In neues Projekt wiederherstellen (2.87), nur lesend.
 *
 * Der Platzhalter sagte „Kein Backend". Das war zur Haelfte falsch. Den
 * Wiederherstellungslauf gibt es, und er ist zertifiziert; was fehlt, ist das
 * neue Projekt. Die Seite trennt beides und nennt fuer jedes fehlende Glied
 * die Komponente, die es tun muesste.
 *
 * Sie liest nichts Neues. QKERN fuehrt ueber seine Backups nichts in der
 * Kontrollebene, also gibt es nichts zu lesen ausser der signierten Evidenz
 * des letzten Drills, und die holt schon
 * `/database/backups/point-in-time`. Die Seite fragt dieselbe Route und
 * stellt eine andere Frage an dieselbe Antwort; das steht auch so auf ihr.
 *
 * Kein Knopf ausser „Neu laden": Es gibt nichts auszuloesen, und ein
 * abgeschalteter Knopf waere ein Versprechen.
 */
type Environment = "development" | "staging" | "production";

type ViewState = "loading" | "ready" | "error";

const STEP_ICONS: Record<RestoreChainStep, typeof ShieldCheck> = {
  restore_run: ShieldCheck,
  fresh_database: Sprout,
  new_environment: Ban,
  binding: Link2Off,
};

export function RestoreToNewProjectView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: ViewState }) {
  const [overview, setOverview] = useState<PointInTimeRecoveryOverview | null>(null);
  const [state, setState] = useState<ViewState>(initialState ?? "loading");
  const [message, setMessage] = useState("");
  // Jede Ladung bekommt einen eigenen AbortController; eine abgebrochene
  // Ladung setzt keinen Zustand mehr.
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => (previous === "ready" ? "ready" : "loading"));
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/environments/${environment}/database/backups/point-in-time`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(serverErrorText(payload.error) ?? t("Der Stand der Wiederherstellung ist nicht verfügbar."));
      setOverview(payload.data as PointInTimeRecoveryOverview);
      setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Der Stand der Wiederherstellung ist nicht verfügbar."));
    }
  }, [projectId, environment]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Der Stand der Wiederherstellung wird geladen…")}</h3></div>;
  }
  if (state === "error" || !overview) {
    return <div className="console-card live-module-state"><ArchiveRestore size={26}/><h3>{t("Nicht verfügbar")}</h3><p>{message}</p>
      <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;
  }

  const drill = overview.lastDrill;
  const chain = restoreChain(overview);

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t(RESTORE_QUESTION)}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button></div>
      <p>{t(RESTORE_ANSWER)}</p>
      <p className="muted">{t(RESTORE_HONESTY)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("KETTE")}</span><h3>{t("Vier Glieder, drei davon fehlen oder sind gesperrt")}</h3></div></div>
      {chain.map(({ step, state: linkState }) => {
        const texts = RESTORE_CHAIN_TEXTS[step];
        const verdict = RESTORE_CHAIN_STATE_TEXTS[linkState];
        const Icon = STEP_ICONS[step];
        return <div className="bucket-row" key={step}>
          <span className="bucket-icon"><Icon size={16}/></span>
          <div>
            <strong>{t(texts.title)}</strong> <span className={verdict.tone}>{t(verdict.label)}</span>
            <p className="muted">{t(texts.component)}</p>
            <p>{t(texts.finding)}</p>
          </div>
        </div>;
      })}
    </article>

    <article className={`console-card span-2 ${drill ? "" : "placeholder-state"}`}>
      <div className="card-head"><div><span>{t("WAS QKERN WEISS")}</span>
        <h3>{drill ? t("Der letzte geprüfte Lauf, mit seinen Zahlen") : t("Kein geprüfter Lauf, also keine Zahlen")}</h3></div></div>
      {!drill && <p className="muted">{t("Es liegt keine gültige, signierte Evidenz eines Restore-Drills vor. Damit hat QKERN über einen Backup-Lauf keine einzige Zahl, und diese Seite erfindet keine.")}</p>}
      {drill && <>
        <article className="console-card auth-overview">
          <div><span>{t("GEPRÜFT AM")}</span><strong>{formatMoment(drill.verifiedAt)}</strong><small>{t("Zeitpunkt der Prüfung der Evidenz")}</small></div>
          <div><span>{t("STAND DER DATEN")}</span><strong>{formatMoment(drill.backupSnapshotAt)}</strong><small>{t("Zeitpunkt, den das Basisbackup festhält")}</small></div>
          <div><span>{t("RÜCKSTAND")}</span><strong>{formatNumber(drill.recoveryPointLagSeconds)}</strong><small>{t("Sekunden zwischen diesem Stand und dem Ende des Backups")}</small></div>
          <div><span>{t("DAUER")}</span><strong>{formatNumber(drill.restoreDurationSeconds)}</strong><small>{t("Sekunden, bis der wiederhergestellte Server stand")}</small></div>
        </article>
        <p className="muted">{t(RESTORE_SAME_EVIDENCE)}</p>
      </>}
      {RESTORE_KNOWLEDGE_ITEMS.map((key) => <div className="bucket-row" key={key}>
        <span className="bucket-icon"><ArchiveRestore size={16}/></span>
        <div><strong>{t(RESTORE_KNOWLEDGE_TEXTS[key].label)}</strong><p className="muted">{t(RESTORE_KNOWLEDGE_TEXTS[key].explains)}</p></div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("HEUTE")}</span><h3>{t("Was wirklich geht, und was ausdrücklich nicht")}</h3></div></div>
      {RESTORE_TODAY_ITEMS.map((key) => <p key={key}>{t(RESTORE_TODAY_TEXTS[key])}</p>)}
    </article>
  </div>;
}
