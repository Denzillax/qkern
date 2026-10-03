"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { serverErrorText } from "@/components/console/server-errors";

/**
 * Die eine Quelle der beiden Seiten Datenbank und Verbindungen (2.46).
 *
 * Beide lesen dieselbe Route (`database/activity`) und dieselbe Antwort;
 * getrennte Abrufe waeren zwei Verbindungen fuer dieselbe Auskunft. Der Hook
 * kennt keinen Text und keine Sprache: Er meldet einen Zustand, und die
 * Ansicht sagt, was er bedeutet. Deshalb steht er in einer .ts-Datei und
 * ruft nie `t(...)` auf — Texte gehoeren in die Ansichten und in
 * `database-activity-texts`, sonst faellt einer durch den
 * Uebersetzungsvertrag.
 *
 * Nur lesend: ein GET, kein Schreibverb, kein Parameter.
 */
export type Environment = "development" | "staging" | "production";

export type DatabaseActivity = {
  commits: number;
  rollbacks: number;
  blocksRead: number;
  blocksHit: number;
  deadlocks: number;
  tempFiles: number;
  tempBytes: number;
  backends: number;
  maxConnections: number;
  statsReset: string | null;
};

export type ConnectionGroup = {
  role: string;
  state: string;
  count: number;
  oldestSeconds: number;
};

export type Activity = {
  source: string;
  database: DatabaseActivity;
  connections: ConnectionGroup[];
  truncated: boolean;
};

/** `disabled` heisst: Die Data Plane ist abgeschaltet. Das ist kein Fehler, sondern eine Entscheidung. */
export type ActivityState = "loading" | "ready" | "disabled" | "unavailable" | "error";

export type ActivitySource = {
  state: ActivityState;
  activity: Activity | null;
  /** Die Meldung der Route, unuebersetzt; die Ansicht zeigt sie nur im Fehlerfall. */
  message: string;
  refreshing: boolean;
  reload: (initial?: boolean) => void;
};

export function useDatabaseActivity(projectId: string, environment: Environment): ActivitySource {
  const [state, setState] = useState<ActivityState>("loading");
  const [activity, setActivity] = useState<Activity | null>(null);
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
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/database/activity`, {
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
    const data = payload.data as Activity | undefined;
    if (status === 200 && data && data.database && Array.isArray(data.connections)) {
      setActivity(data);
      setMessage("");
      setState("ready");
      return;
    }
    setActivity(null);
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

  return { state, activity, message, refreshing, reload: (initial = false) => void load(initial) };
}
