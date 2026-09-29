"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, ClipboardList, RefreshCw, Wrench } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  BACKUPS_ANSWER,
  BACKUPS_ARCHIVE_UNKNOWN,
  BACKUPS_FINDING_ITEMS,
  BACKUPS_FINDING_TEXTS,
  BACKUPS_FINDING_VERDICT_TEXTS,
  BACKUPS_HONESTY,
  BACKUPS_OPERATOR_STEPS,
  BACKUPS_OPERATOR_STEP_TEXTS,
  BACKUPS_QUESTION,
  BACKUPS_SAME_EVIDENCE,
  BACKUPS_STANDPOINT_TEXTS,
  backupsStandpoint,
} from "@/lib/console/backups-texts";
import type { PointInTimeRecoveryOverview } from "@/lib/server/backup/point-in-time";

/**
 * Datenbank → Backups (2.90), nur lesend.
 *
 * Die Seite trug bis hierher einen abgeschalteten Knopf „Backup erstellen“.
 * Nachgesehen gibt es nichts, was er haette aufrufen koennen: Im
 * Produktquelltext ruft niemand ein Backup-Werkzeug auf, und unter den
 * Backup-Routen einer Umgebung steht genau ein Pfad, der nur GET kennt. Der
 * Knopf ist darum weg. An seiner Stelle steht, warum es ihn nicht gibt, was
 * es stattdessen wirklich gibt (einen Pruefweg, der die Kontrollebene
 * sichert) und was ein Betreiber am Server selbst tut.
 *
 * Sie liest nichts Neues. Die einzigen echten Angaben sind die Erklaerung des
 * Betreibers ueber sein WAL-Archiv und die Evidenz des letzten Drills, und
 * beide holt schon `/database/backups/point-in-time`. Die Seite fragt
 * dieselbe Route und stellt eine andere Frage an dieselbe Antwort; das steht
 * auch so auf ihr.
 *
 * Kein Knopf ausser „Neu laden“: Es gibt nichts auszuloesen, und ein
 * abgeschalteter Knopf waere wieder ein Versprechen.
 */
type Environment = "development" | "staging" | "production";

type ViewState = "loading" | "ready" | "error";

export function BackupsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: ViewState }) {
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
      if (!response.ok) throw new Error(payload.error ?? t("Der Stand der Sicherung ist nicht verfügbar."));
      setOverview(payload.data as PointInTimeRecoveryOverview);
      setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Der Stand der Sicherung ist nicht verfügbar."));
    }
  }, [projectId, environment]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Der Stand der Sicherung wird geladen…")}</h3></div>;
  }
  if (state === "error" || !overview) {
    return <div className="console-card live-module-state"><ArchiveRestore size={26}/><h3>{t("Nicht verfügbar")}</h3><p>{message}</p>
      <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Noch einmal")}</button></div>;
  }

  const standpoint = BACKUPS_STANDPOINT_TEXTS[backupsStandpoint(overview)];

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("DATENBANK")} · {environment.toUpperCase()}</span><h3>{t(BACKUPS_QUESTION)}</h3></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> <StableLabel current={t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button></div>
      <p>{t(BACKUPS_ANSWER)}</p>
      <p className="muted">{t(BACKUPS_HONESTY)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BEFUND")}</span><h3>{t("Was es gibt, und was nicht")}</h3></div></div>
      {BACKUPS_FINDING_ITEMS.map((key) => {
        const finding = BACKUPS_FINDING_TEXTS[key];
        const verdict = BACKUPS_FINDING_VERDICT_TEXTS[finding.verdict];
        return <div className="bucket-row" key={key}>
          <span className="bucket-icon"><ClipboardList size={16}/></span>
          <div>
            <strong>{t(finding.label)}</strong> <span className={verdict.tone}>{t(verdict.label)}</span>
            <p className="muted">{t(finding.explains)}</p>
          </div>
        </div>;
      })}
    </article>

    <article className={`console-card span-2 ${overview.archive.declared ? "" : "placeholder-state"}`}>
      <div className="card-head"><div><span>{t("ERKLÄRTES ARCHIV")}</span><h3>{t(standpoint.label)}</h3></div></div>
      <p>{t(standpoint.explains)}</p>
      <div className="bucket-row"><span className="bucket-icon"><Archive size={16}/></span>
        <div><strong>{overview.archive.retentionDays === null ? t("nicht erklärt") : formatNumber(overview.archive.retentionDays)}</strong>
          <small>{t("Erklärte Aufbewahrung in Tagen")}</small></div>
      </div>
      <div className="bucket-row"><span className="bucket-icon"><Archive size={16}/></span>
        <div><strong>{overview.archive.archivingSince === null ? t("nicht erklärt") : formatMoment(overview.archive.archivingSince)}</strong>
          <small>{t("Erklärter Beginn der Archivierung")}</small></div>
      </div>
      {overview.archive.invalid.length > 0 &&
        <p className="muted">{t("Unbrauchbar gesetzt und darum übergangen:")} {overview.archive.invalid.join(", ")}</p>}
      <p className="muted">{t(BACKUPS_ARCHIVE_UNKNOWN)}</p>
      <p className="muted">{t(BACKUPS_SAME_EVIDENCE)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("STATTDESSEN")}</span><h3>{t("Was ein Betreiber tut, in dieser Reihenfolge")}</h3></div></div>
      {BACKUPS_OPERATOR_STEPS.map((key, index) => <div className="bucket-row" key={key}>
        <span className="bucket-icon"><Wrench size={16}/></span>
        <div><strong>{index + 1}. {t(BACKUPS_OPERATOR_STEP_TEXTS[key].title)}</strong>
          <p className="muted">{t(BACKUPS_OPERATOR_STEP_TEXTS[key].explains)}</p></div>
      </div>)}
      <p className="muted">{t("Diese Seite führt nichts davon aus. Sie hat dafür keinen Zugriff auf den Server, und ein Knopf, der so täte, wäre eine Behauptung.")}</p>
    </article>
  </div>;
}
