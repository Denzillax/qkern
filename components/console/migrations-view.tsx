"use client";

import { useCallback, useEffect, useState } from "react";
import { GitCommitHorizontal, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { changeSetRiskLabel, changeSetStatusLabel } from "@/lib/console/change-set-labels";
import { formatMoment } from "@/components/console/console-display";
import type { ChangeSet, Environment } from "@/lib/types";

/**
 * Migrationen in der Console (2.7). Drei Quellen, alle vorhanden: die
 * Change Sets des Projekts aus dem Console-Snapshot (Entwurf bis
 * angewendet), die Migrations-Reviews (Läufe, deren Ausgang die Maschine
 * nicht selbst klären konnte) und die Vorfälle mit ihrer Zustellung. Der
 * Migrationsprozess selbst ist seit 1.49 zertifiziert; hier fehlte nur die
 * Liste.
 */
type ReviewItem = {
  jobId: string; projectId: string; environment: Environment; changeSetId: string; state: "review_required";
  reconciliationAttempt: number; maxReconciliationAttempts: number; reviewCycle: number; maxReviewCycles: number;
  errorCode?: string; finishedAt: string; updatedAt: string;
};
type IncidentItem = {
  incidentId: string; jobId: string; projectId: string; environment: Environment; changeSetId: string;
  kind: string; severity: string; status: "open" | "acknowledged" | "resolved";
  delivery: { status: "pending" | "published" | "dead_lettered"; attemptCount: number; failureCount: number; maxFailures: number };
};

const when = (iso: string) => formatMoment(iso);

export function MigrationsView({ projectId, environment, changeSets, initialState }: { projectId: string; environment: Environment; changeSets: ChangeSet[]; initialState?: "loading" | "ready" | "error" }) {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const [reviewResponse, incidentResponse] = await Promise.all([
        fetch(`/api/v1/migrations/reviews?projectId=${projectId}&limit=100`, { cache: "no-store" }),
        fetch(`/api/v1/migrations/incidents?projectId=${projectId}&limit=100`, { cache: "no-store" }),
      ]);
      const reviewPayload = await reviewResponse.json().catch(() => ({}));
      const incidentPayload = await incidentResponse.json().catch(() => ({}));
      if (!reviewResponse.ok) throw new Error(serverErrorText(reviewPayload.error) ?? t("Reviews nicht verfügbar"));
      if (!incidentResponse.ok) throw new Error(serverErrorText(incidentPayload.error) ?? t("Vorfälle nicht verfügbar"));
      setReviews((reviewPayload.data.reviews as ReviewItem[]).filter((item) => item.environment === environment));
      setIncidents((incidentPayload.data.incidents as IncidentItem[]).filter((item) => item.environment === environment));
      setState("ready");
    } catch (cause) { setState("error"); setMessage(cause instanceof Error ? cause.message : t("Migrationen nicht verfügbar")); }
  }, [projectId, environment]);
  useEffect(() => { void load(); }, [load]);

  const scoped = changeSets.filter((set) => set.projectId === projectId && set.environment === environment)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const applied = scoped.filter((set) => set.status === "applied").length;
  // Die Tabelle lag hier und nirgends sonst, und der Verlauf des SQL-Editors
  // zeigte denselben Zustand darum roh als `pending_approval`. Jetzt holen beide
  // dasselbe Wort aus demselben Modul (2.145).

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("CHANGE SETS")}</span><strong>{scoped.length}</strong><small>{t("In dieser Umgebung")}</small></div>
      <div><span>{t("ANGEWENDET")}</span><strong>{applied}</strong><small>{t("mit Ledger-Eintrag")}</small></div>
      <div><span>{t("OFFENE REVIEWS")}</span><strong>{reviews.length}</strong><small>{incidents.filter((item) => item.status !== "resolved").length} {t("offene Vorfälle")}</small></div>
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("MIGRATIONEN")} · {environment.toUpperCase()}</span><h3>{t("Change Sets des Projekts")}</h3></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14}/> {t("Neu laden")}</button></div>
      {scoped.length === 0 && <p className="muted">{t("Noch keine Change Sets. Eine schreibende SQL aus dem SQL Editor oder ein Agent über die AI Bridge legt das erste an; angewendet wird es erst nach Freigabe, transaktional und mit Ledger-Eintrag.")}</p>}
      {scoped.map((set) => <div className="bucket-row" key={set.id}><span className="bucket-icon"><GitCommitHorizontal size={16}/></span>
        <div><strong>{set.title}</strong><small>{set.agent} · {when(set.createdAt)} · {set.diff.length} {t("Zeilen Diff")}{set.rollback ? ` · ${t("Rollback vorhanden")}` : ""}</small></div>
        <span className={`risk ${set.risk}`}>{t("Risiko")} {t(changeSetRiskLabel(set.risk))}</span>
        <span className={set.status === "applied" ? "secure" : set.status === "failed" || set.status === "rejected" ? "risk high" : "muted"}>{t(changeSetStatusLabel(set.status))}</span>
      </div>)}
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("REVIEWS")}</span><h3>{t("Läufe, die eine Entscheidung brauchen")}</h3></div><ShieldCheck className="secure" size={21}/></div>
      {state === "loading" && <p className="muted">{t("Reviews werden geladen…")}</p>}
      {state === "error" && <p className="muted">{message}</p>}
      {state === "ready" && reviews.length === 0 && <p className="muted">{t("Kein Lauf wartet auf ein Review. Ein Review entsteht, wenn der Worker den Ausgang eines Laufs nicht selbst klären konnte.")}</p>}
      {reviews.map((review) => <div className="bucket-row" key={review.jobId}><span className="bucket-icon"><TriangleAlert size={16}/></span>
        <div><strong>{t("Lauf")} {review.jobId.slice(0, 8)}</strong><small>{t("Change Set")} {review.changeSetId.slice(0, 8)} · {t("Abgleich")} {review.reconciliationAttempt}/{review.maxReconciliationAttempts} · {t("Zyklus")} {review.reviewCycle}/{review.maxReviewCycles}{review.errorCode ? ` · ${review.errorCode}` : ""}</small></div>
        <span className="muted">{when(review.finishedAt)}</span>
      </div>)}
    </article>
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("VORFÄLLE")}</span><h3>{t("Unklare Ausgänge und ihre Zustellung")}</h3></div></div>
      {state === "ready" && incidents.length === 0 && <p className="muted">{t("Kein Vorfall. Einer entsteht, wenn auch das letzte Review den Ausgang nicht klärt; er wird als Ereignis zugestellt, bis der Empfänger bestätigt.")}</p>}
      {incidents.map((incident) => <div className="bucket-row" key={incident.incidentId}><span className="bucket-icon"><TriangleAlert size={16}/></span>
        <div><strong>{t("Vorfall")} {incident.incidentId.slice(0, 8)}</strong><small>{t("Lauf")} {incident.jobId.slice(0, 8)} · {t("Zustellung")} {incident.delivery.status} · {incident.delivery.attemptCount} {t("Versuche")}, {incident.delivery.failureCount}/{incident.delivery.maxFailures} {t("Fehler")}</small></div>
        <span className={incident.status === "resolved" ? "secure" : "risk high"}>{incident.status === "open" ? t("offen") : incident.status === "acknowledged" ? t("bestätigt") : t("gelöst")}</span>
      </div>)}
    </article>
  </div>;
}
