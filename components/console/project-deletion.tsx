"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { DangerousAction } from "@/components/console/dangerous-action";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment } from "@/components/console/console-display";

/**
 * Ein Projekt loeschen und zurueckholen (2.173).
 *
 * Entschieden von Denzil am 7. Oktober 2026: Das Projekt ist sofort gesperrt
 * und ausgeblendet, laesst sich sieben Tage lang zurueckholen und wird danach
 * mit Datenbank, Backups und Buckets abgeraeumt. Nur die Owner-Rolle darf es;
 * fuer jede andere antwortet die Route 403, und die Meldung sagt das.
 *
 * Geloescht wird mit abgetipptem Projektnamen, wie jedes andere Zerstoerende
 * dieser Console, und der Dienst prueft denselben Namen noch einmal: Ein
 * direkter Aufruf soll nicht mit weniger loeschen als ein Druck auf den Knopf.
 *
 * Darunter stehen die geloeschten Projekte dieser Organisation, die noch
 * nicht abgeraeumt sind. Solange die Frist laeuft, mit dem Zeitpunkt, bis zu
 * dem es zurueckzuholen ist. Danach (2.177) ohne Knopf und mit dem Satz, der
 * sagt, worauf das Abraeumen wartet: Die Datenbank bleibt gesperrt stehen, bis
 * der Broker ihren Abbau bestaetigt.
 */
type DeletedProject = {
  id: string; name: string; slug: string; deletedAt: string; deleteAfter: string;
  state: "restorable" | "purging";
  databaseTeardown: "none" | "pending" | "requested" | "confirmed";
};

function purgingText(entry: DeletedProject): string {
  if (entry.databaseTeardown === "pending" || entry.databaseTeardown === "requested") {
    return t("Wird abgeräumt. Die Datenbank bleibt gesperrt, bis der Broker ihren Abbau bestätigt.");
  }
  return t("Wird abgeräumt. Backups und Dateien werden entfernt.");
}

export function ProjectDeletion({ project, onChanged }: {
  project: { id: string; name: string };
  /** Nach Loeschen und Zurueckholen: Die Schale laedt die Projekte neu. */
  onChanged?: () => void;
}) {
  const [deleted, setDeleted] = useState<DeletedProject[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/projects/deleted", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setDeleted((payload.data?.projects ?? []) as DeletedProject[]);
    } catch { /* Ohne Liste bleibt sie leer; das Loeschen selbst haengt nicht daran. */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove() {
    setMessage("");
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: project.name }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMessage(serverErrorText(payload.error) ?? t("Das Projekt konnte nicht gelöscht werden."));
      return;
    }
    await load();
    onChanged?.();
  }

  async function restore(entry: DeletedProject) {
    setMessage("");
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(entry.id)}/restore`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMessage(serverErrorText(payload.error) ?? t("Das Projekt konnte nicht zurückgeholt werden."));
      return;
    }
    await load();
    onChanged?.();
  }

  return <div className="project-deletion">
    <DangerousAction label={t("Projekt löschen")} title={`${t("Projekt löschen")}: ${project.name}`}
      consequence={t("Das Projekt ist sofort gesperrt: Es verschwindet aus der Console, und jeder seiner Keys wird abgelehnt. Sieben Tage lang lässt es sich zurückholen, danach werden Datenbank, Backups und Buckets endgültig entfernt. Das Audit-Log bleibt.")}
      confirmName={project.name} onConfirm={() => void remove()}/>
    {message && <p className="form-panel-error" role="alert">{message}</p>}
    {deleted.length > 0 && <div className="project-deletion-list">
      <h4>{t("Gelöschte Projekte")}</h4>
      {deleted.map((entry) => <div className="bucket-row" key={entry.id}>
        <span className="bucket-icon"><RotateCcw size={16} aria-hidden/></span>
        <div><strong>{entry.name}</strong><small>{entry.state === "restorable"
          ? `${t("Zurückholbar bis")} ${formatMoment(entry.deleteAfter)}`
          : purgingText(entry)}</small></div>
        <span/>
        {entry.state === "restorable" ? <button type="button" className="secondary-button" onClick={() => void restore(entry)}>
          <RotateCcw size={13} aria-hidden/> {t("Zurückholen")}
        </button> : <span/>}
      </div>)}
    </div>}
  </div>;
}
