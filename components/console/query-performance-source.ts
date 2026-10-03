"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { serverErrorText } from "@/components/console/server-errors";

/**
 * Die Quelle der Seite Berichte -> Abfrage-Leistung (2.67).
 *
 * Gebaut wie `database-activity-source` (2.46): Der Hook kennt keinen Text
 * und keine Sprache, er meldet einen Zustand, und die Ansicht sagt, was er
 * bedeutet. Deshalb steht er in einer .ts-Datei und ruft nie `t(...)` auf.
 *
 * Nur lesend: ein GET auf `database/statements`, kein Schreibverb, kein
 * Parameter.
 *
 * `installed` ist Teil der Antwort und kein Fehler. Fehlt die Erweiterung,
 * ist der Zustand `ready` mit `installed: false`, und die Ansicht sagt den
 * Satz dazu. Ein eigener Fehlerzustand waere die falsche Auskunft: Die
 * Datenbank antwortet, sie zaehlt nur nicht mit.
 */
export type Environment = "development" | "staging" | "production";

export type StatementDigest = {
  id: string;
  calls: number;
  totalTimeMs: number;
  meanTimeUs: number;
  rows: number;
};

export type Statements = {
  source: string;
  installed: boolean;
  statements: StatementDigest[];
  truncated: boolean;
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
export type StatementsState = "loading" | "ready" | "disabled" | "unavailable" | "error";

export type StatementsSource = {
  state: StatementsState;
  statements: Statements | null;
  /** Die Meldung der Route, unuebersetzt; die Ansicht zeigt sie nur im Fehlerfall. */
  message: string;
  refreshing: boolean;
  reload: (initial?: boolean) => void;
};

export function useQueryPerformance(projectId: string, environment: Environment): StatementsSource {
  const [state, setState] = useState<StatementsState>("loading");
  const [statements, setStatements] = useState<Statements | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  // Jede Ladung hat einen eigenen AbortController; eine abgebrochene setzt keinen Zustand mehr.
  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    let status = 0;
    let payload: Record<string, unknown> = {};
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/database/statements`, {
        cache: "no-store", signal: controller.signal,
      });
      status = response.status;
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      if (body !== null && typeof body === "object" && !Array.isArray(body)) payload = body as Record<string, unknown>;
    } catch (cause) {
      if (controller.signal.aborted) return;
      payload = { error: cause instanceof Error ? cause.message : "" };
    }
    if (controller.signal.aborted) return;
    setRefreshing(false);
    const error = typeof payload.error === "string" ? (serverErrorText(payload.error) ?? "") : "";
    const code = typeof payload.code === "string" ? payload.code : "";
    const data = payload.data as Statements | undefined;
    if (status === 200 && data && typeof data.installed === "boolean" && Array.isArray(data.statements)) {
      setStatements(data);
      setMessage("");
      setState("ready");
      return;
    }
    setStatements(null);
    setMessage(error);
    // Abgeschaltet, nicht bereit und nicht erreichbar sind drei verschiedene
    // Auskuenfte. Ein 500 waere eine vierte und heisst hier schlicht Fehler.
    if (code === "DATA_PLANE_DISABLED") setState("disabled");
    else if (status === 503 || status === 409) setState("unavailable");
    else setState("error");
  }, [projectId, environment]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  return { state, statements, message, refreshing, reload: (initial = false) => void load(initial) };
}
