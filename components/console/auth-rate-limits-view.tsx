"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_RATE_LIMITS_AUDIT,
  AUTH_RATE_LIMITS_BOUNDARY,
  AUTH_RATE_LIMITS_FAILURE_MODE,
  AUTH_RATE_LIMITS_HASHED,
  AUTH_RATE_LIMITS_KEY,
  AUTH_RATE_LIMITS_NOT_A_LOCKOUT,
  AUTH_RATE_LIMITS_NOT_DISTRIBUTED,
  AUTH_RATE_LIMITS_REFRESH_SCOPE,
  AUTH_RATE_LIMITS_TELLS_NOTHING,
  AUTH_RATE_LIMITS_WARNING,
  AUTH_RATE_LIMITS_WHAT,
  AUTH_RATE_LIMITS_WHERE,
  AUTH_RATE_LIMITS_WINDOW,
  AUTH_RATE_LIMIT_KIND_NOTES,
  AUTH_RATE_LIMIT_KIND_TEXTS,
  AUTH_RATE_LIMIT_REJECTIONS,
  type AuthRateLimitKindId,
  type AuthRateLimitRejectionId,
} from "@/lib/console/auth-rate-limits-texts";

/**
 * Auth → Rate Limits (2.56), wie bei Supabase unter Authentication, Rate
 * Limits.
 *
 * Die Seite kann genau eines: die drei Grenzen dieser Projektumgebung setzen.
 * Vor dem Speichern steht eine vollständige Vorschau — jede der sechs Zahlen
 * vorher und nachher, und was strenger wird. Erst danach gibt es den Knopf,
 * der es wirklich tut. Dieselbe Bauart wie Auth → Mehrfaktor (2.52) und
 * Auth → URL-Konfiguration (2.54).
 *
 * Die Hälfte der Sätze auf dieser Seite sagt, was eine Grenze **nicht** kann.
 * Das ist der Punkt: Wer hier eine Zahl setzt, soll nicht in dem Glauben
 * weggehen, er sei damit gegen einen verteilten Angriff über viele Konten
 * geschützt.
 */
type Environment = "development" | "staging" | "production";

type Limit = { max: number; windowSeconds: number };
type Limits = Record<AuthRateLimitKindId, Limit>;

type Bounds = {
  max: { min: number; max: number };
  windowSeconds: { min: number; max: number };
};

type RateLimits = {
  limits: Limits;
  defaults: Limits;
  bounds: Bounds;
  kinds: AuthRateLimitKindId[];
  configured: boolean;
  updatedAt: string | null;
};

const KINDS: AuthRateLimitKindId[] = ["sign_in", "mail", "refresh"];

export function AuthRateLimitsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/rate-limits`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [data, setData] = useState<RateLimits | null>(null);
  const [draft, setDraft] = useState<Limits | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (initial: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (initial) setState("loading"); else setRefreshing(true);
    try {
      const response = await fetch(route, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      setRefreshing(false);
      if (response.status === 503) {
        setData(null); setState("unavailable");
        setMessage(payload.error ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setData(null); setState("error");
        setMessage(payload.error ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      const loaded = payload.data as RateLimits;
      setData(loaded); setDraft(cloned(loaded.limits));
      setMessage(""); setPreview(false); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setData(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  async function apply() {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch(route, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limits: draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        const reason = payload.reason as AuthRateLimitRejectionId | undefined;
        const explained = reason && reason in AUTH_RATE_LIMIT_REJECTIONS
          ? `${payload.field ? `${t(AUTH_RATE_LIMIT_KIND_TEXTS[payload.field as AuthRateLimitKindId] ?? payload.field)}: ` : ""}${t(AUTH_RATE_LIMIT_REJECTIONS[reason])}`
          : payload.error ?? t("Die Grenzen konnten nicht gespeichert werden.");
        setMessage(explained);
        return;
      }
      const saved = payload.data as RateLimits;
      setData(saved); setDraft(cloned(saved.limits)); setPreview(false); setMessage("");
    } catch { setMessage(t("Die Grenzen konnten nicht gespeichert werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Grenzen werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data || !draft) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Grenzen nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const format = (value: string) => formatMoment(value);
  const changed = KINDS.filter((kind) =>
    draft[kind].max !== data.limits[kind].max || draft[kind].windowSeconds !== data.limits[kind].windowSeconds);
  // Strenger heisst: weniger Versuche je Zeit. Die Vorschau soll das sagen
  // koennen, ohne dass jemand zwei Zahlen im Kopf dividieren muss.
  const stricter = changed.filter((kind) =>
    draft[kind].max / draft[kind].windowSeconds < data.limits[kind].max / data.limits[kind].windowSeconds);

  function edit(kind: AuthRateLimitKindId, field: "max" | "windowSeconds", raw: string) {
    const value = Number(raw);
    setPreview(false); setMessage("");
    setDraft((previous) => previous ? { ...previous, [kind]: { ...previous[kind], [field]: value } } : previous);
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      {KINDS.map((kind) => <div key={`head-${kind}`}>
        <span>{t(AUTH_RATE_LIMIT_KIND_TEXTS[kind]).toUpperCase()}</span>
        <strong>{data.limits[kind].max}</strong>
        <small>{t("je")} {minutes(data.limits[kind].windowSeconds)} {t("Minuten")}</small>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Grenzen je Zeitfenster")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_RATE_LIMITS_WHAT)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_KEY)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_HASHED)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_WHERE)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_WINDOW)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_BOUNDARY)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_TELLS_NOTHING)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_FAILURE_MODE)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_AUDIT)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={data.configured ? "secure" : "muted"}>
          {data.configured ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {data.configured ? t("Diese Umgebung führt eigene Grenzen.") : t("Diese Umgebung steht auf den Vorgaben.")}
        </span>
        <small>{data.updatedAt ? `${t("Zuletzt geändert:")} ${format(data.updatedAt)}` : t("Nie geändert; es gelten die Vorgaben des Dienstes.")}</small>
      </div>

      {KINDS.map((kind) => <div className="console-card preview-card" key={`edit-${kind}`}>
        <div className="card-head"><div><span>{t(AUTH_RATE_LIMIT_KIND_TEXTS[kind]).toUpperCase()}</span><h3>{t(AUTH_RATE_LIMIT_KIND_TEXTS[kind])}</h3></div><Gauge size={18}/></div>
        <p className="muted">{t(AUTH_RATE_LIMIT_KIND_NOTES[kind])}</p>
        <div className="log-row">
          <label>{t("Versuche je Fenster")}<input
            type="number"
            value={draft[kind].max}
            min={data.bounds.max.min}
            max={data.bounds.max.max}
            step={1}
            disabled={saving}
            aria-label={`${t(AUTH_RATE_LIMIT_KIND_TEXTS[kind])} · ${t("Versuche je Fenster")}`}
            onChange={(event) => edit(kind, "max", event.target.value)}
          /></label>
          <label>{t("Fenster in Sekunden")}<input
            type="number"
            value={draft[kind].windowSeconds}
            min={data.bounds.windowSeconds.min}
            max={data.bounds.windowSeconds.max}
            step={1}
            disabled={saving}
            aria-label={`${t(AUTH_RATE_LIMIT_KIND_TEXTS[kind])} · ${t("Fenster in Sekunden")}`}
            onChange={(event) => edit(kind, "windowSeconds", event.target.value)}
          /></label>
        </div>
        <div className="log-row">
          <small>{t("Vorgabe:")} {data.defaults[kind].max} {t("je")} {minutes(data.defaults[kind].windowSeconds)} {t("Minuten")}</small>
          <small>{t("Erlaubt:")} {data.bounds.max.min}–{data.bounds.max.max} {t("Versuche")}, {data.bounds.windowSeconds.min}–{data.bounds.windowSeconds.max} {t("Sekunden")}</small>
        </div>
      </div>)}

      {!preview && <div className="log-row">
        <button className="secondary-button" onClick={() => { setMessage(""); setPreview(true); }} disabled={saving || changed.length === 0}>
          <StableLabel current={t("Änderung prüfen")} variants={tAll("Änderung prüfen")}/>
        </button>
        {changed.length === 0 && <small>{t("Nichts geändert.")}</small>}
      </div>}

      {preview && <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Grenzen ersetzen")}</h3></div><ShieldAlert size={18}/></div>
        <p className="risk medium">{t(AUTH_RATE_LIMITS_WARNING)}</p>
        {KINDS.map((kind) => <div className="log-row" key={`preview-${kind}`}>
          <span className={changed.includes(kind) ? "risk medium" : "muted"}>{t(AUTH_RATE_LIMIT_KIND_TEXTS[kind])}</span>
          <code>{data.limits[kind].max}/{data.limits[kind].windowSeconds}s → {draft[kind].max}/{draft[kind].windowSeconds}s</code>
        </div>)}
        <div className="log-row"><span>{t("Arten, die sich ändern")}</span><code>{changed.length}</code></div>
        <div className="log-row"><span>{t("Davon strenger als bisher")}</span><code>{stricter.length}</code></div>
        <div className="log-row">
          <button className="secondary-button" onClick={() => void apply()} disabled={saving}>
            <StableLabel current={saving ? t("Wird gespeichert…") : t("Jetzt anwenden")} variants={tAll("Wird gespeichert…", "Jetzt anwenden")}/>
          </button>
          <button className="plain-button" onClick={() => setPreview(false)} disabled={saving}>{t("Abbrechen")}</button>
        </div>
      </div>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("GRENZEN")}</span><h3>{t("Wogegen das nicht hilft")}</h3></div><ShieldAlert size={18}/></div>
      <p className="risk medium">{t(AUTH_RATE_LIMITS_NOT_DISTRIBUTED)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_NOT_A_LOCKOUT)}</p>
      <p className="muted">{t(AUTH_RATE_LIMITS_REFRESH_SCOPE)}</p>
    </article>
  </div>;
}

function cloned(limits: Limits): Limits {
  return { sign_in: { ...limits.sign_in }, mail: { ...limits.mail }, refresh: { ...limits.refresh } };
}

/** Sekunden als Minuten, gerundet — die Karte soll eine Zahl zeigen, keine Rechnung. */
function minutes(seconds: number): number {
  return Math.round(seconds / 60);
}
