"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_RETURN_TARGETS_AUDIT,
  AUTH_RETURN_TARGETS_EMPTY,
  AUTH_RETURN_TARGETS_FORM,
  AUTH_RETURN_TARGETS_NARROWING,
  AUTH_RETURN_TARGETS_WARNING,
  AUTH_RETURN_TARGETS_WHAT,
  AUTH_RETURN_TARGETS_WHERE,
  AUTH_RETURN_TARGET_REJECTIONS,
  type AuthReturnTargetRejectionId,
} from "@/lib/console/auth-settings-texts";

/**
 * Auth → URL-Konfiguration (2.54), wie bei Supabase unter Authentication,
 * URL Configuration.
 *
 * Die Seite kann genau eines: die erlaubten Rücksprungziele dieser
 * Projektumgebung setzen. Sie zeigt daneben die äussere Grenze des Betriebs,
 * weil ohne sie nicht verständlich ist, warum ein Eintrag abgelehnt wird —
 * und diese Grenze ist hier nicht änderbar.
 *
 * Vor dem Speichern steht eine vollständige Vorschau: was danach gilt, was
 * wegfällt und was das für eine laufende Anwendung bedeutet. Erst danach gibt
 * es den Knopf, der es wirklich tut. Dieselbe Bauart wie Auth → Mehrfaktor
 * (2.52).
 */
type Environment = "development" | "staging" | "production";

type Targets = {
  targets: string[];
  outerBound: string[];
  effective: string[];
  limit: number;
  updatedAt: string | null;
};

export function AuthReturnTargetsView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/return-targets`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [data, setData] = useState<Targets | null>(null);
  const [draft, setDraft] = useState("");
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
        setMessage(serverErrorText(payload.error) ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setData(null); setState("error");
        setMessage(serverErrorText(payload.error) ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      const loaded = payload.data as Targets;
      setData(loaded); setDraft(loaded.targets.join("\n"));
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

  // Die Eingabe ist eine Zeile je Ziel. Leere Zeilen fallen weg, bevor
  // irgendetwas gesendet wird; der Dienst entscheidet ueber den Rest.
  const entries = draft.split("\n").map((line) => line.trim()).filter(Boolean);

  async function apply() {
    setSaving(true);
    try {
      const response = await fetch(route, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets: entries }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        const reason = payload.reason as AuthReturnTargetRejectionId | undefined;
        const explained = reason && reason in AUTH_RETURN_TARGET_REJECTIONS
          ? `${payload.value ? `${payload.value}: ` : ""}${t(AUTH_RETURN_TARGET_REJECTIONS[reason])}`
          : serverErrorText(payload.error) ?? t("Die Liste konnte nicht gespeichert werden.");
        setMessage(explained);
        return;
      }
      const saved = payload.data as Targets;
      setData(saved); setDraft(saved.targets.join("\n")); setPreview(false); setMessage("");
    } catch { setMessage(t("Die Liste konnte nicht gespeichert werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Rücksprungziele werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Rücksprungziele nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const format = (value: string) => formatMoment(value);
  const removed = data.targets.filter((origin) => !entries.includes(origin));
  const added = entries.filter((origin) => !data.targets.includes(origin));

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("ZIELE DES PROJEKTS")}</span><strong>{data.targets.length}</strong><small>{data.targets.length === 0 ? t("nicht verengt") : t("von höchstens zwanzig")}</small></div>
      <div><span>{t("ÄUSSERE GRENZE")}</span><strong>{data.outerBound.length}</strong><small>{t("aus der Umgebung des Betriebs")}</small></div>
      <div><span>{t("WIRKSAM")}</span><strong>{data.effective.length}</strong><small>{t("Herkünfte, die wirklich gelten")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Rücksprungziele")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_RETURN_TARGETS_WHAT)}</p>
      <p className="muted">{t(AUTH_RETURN_TARGETS_NARROWING)}</p>
      <p className="muted">{t(AUTH_RETURN_TARGETS_EMPTY)}</p>
      <p className="muted">{t(AUTH_RETURN_TARGETS_FORM)}</p>
      <p className="muted">{t(AUTH_RETURN_TARGETS_WHERE)}</p>
      <p className="muted">{t(AUTH_RETURN_TARGETS_AUDIT)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={data.targets.length > 0 ? "secure" : "muted"}>
          {data.targets.length > 0 ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {data.targets.length > 0 ? t("Diese Umgebung verengt die äussere Grenze.") : t("Diese Umgebung verengt nichts.")}
        </span>
        <small>{data.updatedAt ? `${t("Zuletzt geändert:")} ${format(data.updatedAt)}` : t("Nie geändert; die Umgebung steht auf der Vorgabe.")}</small>
      </div>

      <label>{t("Eine Herkunft je Zeile")}<textarea
        rows={6}
        value={draft}
        spellCheck={false}
        disabled={saving}
        aria-label={t("Eine Herkunft je Zeile")}
        onChange={(event) => { setDraft(event.target.value); setPreview(false); }}
        placeholder="https://app.example"
      /></label>

      {!preview && <div className="log-row">
        <button className="secondary-button" onClick={() => { setMessage(""); setPreview(true); }} disabled={saving}>
          <StableLabel current={t("Änderung prüfen")} variants={tAll("Änderung prüfen")}/>
        </button>
      </div>}

      {preview && <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Liste ersetzen")}</h3></div><Link2 size={18}/></div>
        <p className="risk medium">{t(AUTH_RETURN_TARGETS_WARNING)}</p>
        <div className="log-row"><span>{t("Ziele danach")}</span><code>{entries.length}</code></div>
        <div className="log-row"><span>{t("Neu hinzu")}</span><code>{added.length}</code></div>
        <div className="log-row"><span>{t("Fallen weg")}</span><code>{removed.length}</code></div>
        {removed.map((origin) => <div className="log-row" key={`out-${origin}`}><span className="risk medium">{origin}</span><small>{t("springt ab sofort nicht mehr zurück")}</small></div>)}
        {entries.length === 0 && <p className="muted">{t(AUTH_RETURN_TARGETS_EMPTY)}</p>}
        <div className="log-row">
          <button className="secondary-button" onClick={() => void apply()} disabled={saving}>
            <StableLabel current={saving ? t("Wird gespeichert…") : t("Jetzt anwenden")} variants={tAll("Wird gespeichert…", "Jetzt anwenden")}/>
          </button>
          <button className="plain-button" onClick={() => setPreview(false)} disabled={saving}>{t("Abbrechen")}</button>
        </div>
      </div>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("ÄUSSERE GRENZE")}</span><h3>{t("Was der Betrieb erlaubt")}</h3></div></div>
      {data.outerBound.map((origin) => <div className="log-row" key={`bound-${origin}`}>
        <span className={data.effective.includes(origin) ? "secure" : "muted"}>{origin}</span>
        <small>{data.effective.includes(origin) ? t("gilt") : t("durch die Liste des Projekts ausgeschlossen")}</small>
      </div>)}
      <p className="muted">{t("Diese Liste steht in der Umgebung des Prozesses und lässt sich hier nicht ändern.")}</p>
    </article>
  </div>;
}
