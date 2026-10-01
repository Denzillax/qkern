"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  REALTIME_FIGURES_NOTE,
  REALTIME_GROUP_LABELS,
  REALTIME_INVALID_NOTE,
  REALTIME_LIMIT_GROUPS,
  REALTIME_ORIGIN_TEXTS,
  REALTIME_SETTINGS_HONESTY,
  REALTIME_SETTINGS_PROCESS_NOTE,
  REALTIME_UNIT_LABELS,
  realtimeLimitText,
  type RealtimeLimitGroupId,
  type RealtimeOriginId,
  type RealtimeUnitId,
} from "@/lib/console/realtime-texts";

/**
 * Realtime → Einstellungen (2.48): die wirksamen Grenzen des Transports,
 * gelesen über `realtime/settings`.
 *
 * Nur lesend, und zwar endgültig: Die Seite hat kein Eingabefeld, keinen
 * Speicherknopf und keinen Schreibpfad, weil es keinen gibt. Geändert wird in
 * der Umgebung des Realtime-Prozesses. Der Satz dazu steht über der Tabelle.
 *
 * Betriebszahlen fehlen mit Ansage. Verbindungen und Abonnements führt der
 * Realtime-Prozess; diese Console fragt ihn nicht.
 */
type Environment = "development" | "staging" | "production";

type Limit = {
  id: string;
  group: RealtimeLimitGroupId;
  unit: RealtimeUnitId;
  value: number | null;
  origin: RealtimeOriginId;
  variable: string | null;
  minimum: number | null;
  maximum: number | null;
  invalid: boolean;
};

type Settings = {
  limits: Limit[];
  features: { enabled: boolean; changes: boolean; durableLog: boolean; durablePresence: boolean };
  figures: { available: boolean; reason: string };
};


export function RealtimeSettingsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "error" }) {
  const [state, setState] = useState<"loading" | "ready" | "error">(initialState ?? "loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    let status = 0;
    let payload: Record<string, unknown> = {};
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/realtime/settings`, {
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
    const data = payload.data as Settings | undefined;
    if (status === 200 && data && Array.isArray(data.limits)) {
      setSettings(data);
      setMessage("");
      setState("ready");
      return;
    }
    setSettings(null);
    setMessage(typeof payload.error === "string" ? payload.error : "");
    setState("error");
  }, [projectId, environment]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Grenzen werden geladen…")}</h3></div>;
  }
  if (state === "error" || !settings) {
    return <div className="console-card live-module-state"><SlidersHorizontal size={26}/>
      <h3>{t("Grenzen nicht verfügbar")}</h3>
      <p>{message || t("Die Route hat nicht geantwortet.")}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const invalid = settings.limits.filter((limit) => limit.invalid).length;

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("REALTIME")} · {environment.toUpperCase()}</span><h3>{t("Einstellungen")}</h3></div><div>
        <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
      </div></div>

      <p className="muted">{t(REALTIME_SETTINGS_HONESTY)}</p>
      <p className="muted">{t(REALTIME_SETTINGS_PROCESS_NOTE)}</p>
      {invalid > 0 && <p className="risk medium">{t(REALTIME_INVALID_NOTE)}</p>}

      <div className="log-row log-header"><span>{t("Grenze")}</span><span>{t("Wert")}</span><span>{t("Einheit")}</span><span>{t("Ursprung")}</span></div>
      {REALTIME_LIMIT_GROUPS.map((group) => {
        const limits = settings.limits.filter((limit) => limit.group === group);
        if (limits.length === 0) return null;
        return <div key={group}>
          <div className="log-row"><strong>{t(REALTIME_GROUP_LABELS[group])}</strong></div>
          {limits.map((limit) => {
            const text = realtimeLimitText(limit.id);
            const origin = REALTIME_ORIGIN_TEXTS[limit.origin] ?? REALTIME_ORIGIN_TEXTS.code;
            return <div className="log-row" key={limit.id}>
              <span>{t(text.label)}<br/><small>{t(text.explains)}</small></span>
              <code className={limit.invalid ? "risk medium" : undefined}>{limit.value === null ? t("ungültig") : formatNumber(limit.value)}</code>
              <small>{t(REALTIME_UNIT_LABELS[limit.unit] ?? limit.unit)}</small>
              <span className={origin.tone}>{t(origin.label)}<br/><small>{limit.variable ?? t("keine Variable")}</small></span>
            </div>;
          })}
        </div>;
      })}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("SCHALTER")}</span><h3>{t("Was der Transport tut")}</h3></div></div>
      <div className="log-row"><span>{t("Realtime eingeschaltet")}</span><span className={settings.features.enabled ? "secure" : "muted"}>{settings.features.enabled ? t("ja") : t("nein")}</span></div>
      <div className="log-row"><span>{t("Postgres Changes eingeschaltet")}</span><span className={settings.features.changes ? "secure" : "muted"}>{settings.features.changes ? t("ja") : t("nein")}</span></div>
      <div className="log-row"><span>{t("Dauerhafter Ereignis-Log")}</span><span className={settings.features.durableLog ? "secure" : "muted"}>{settings.features.durableLog ? t("ja") : t("nein")}</span></div>
      <div className="log-row"><span>{t("Dauerhafte Presence")}</span><span className={settings.features.durablePresence ? "secure" : "muted"}>{settings.features.durablePresence ? t("ja") : t("nein")}</span></div>
      <p className="muted">{t("Ohne Postgres Changes bleibt ein changes-Abonnement leer. Ohne dauerhaften Log überlebt kein Ereignis einen Neustart und erreicht keine zweite Instanz.")}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NUR LESEND")}</span><h3>{t("Was diese Seite nicht kann")}</h3></div><SlidersHorizontal size={18}/></div>
      <p className="muted">{t(REALTIME_FIGURES_NOTE)}</p>
      <p className="muted">{t("Kein Geheimnis steht hier: Das Cursor-Geheimnis, die Datenbank-Adresse und die erlaubten Origins werden nicht einmal gelesen.")}</p>
    </article>
  </div>;
}
