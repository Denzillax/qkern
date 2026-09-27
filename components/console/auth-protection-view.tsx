"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileWarning, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_PROTECTION_AUDIT,
  AUTH_PROTECTION_BUILT_IN,
  AUTH_PROTECTION_BUILT_IN_HONESTY,
  AUTH_PROTECTION_DIGESTS,
  AUTH_PROTECTION_FAILURE_MODE,
  AUTH_PROTECTION_LIST_FAILURE,
  AUTH_PROTECTION_LIST_FILE,
  AUTH_PROTECTION_LIST_SOURCE_TEXTS,
  AUTH_PROTECTION_MIN_LENGTH,
  AUTH_PROTECTION_NEVER_LOGGED,
  AUTH_PROTECTION_NOTICE_NOTES,
  AUTH_PROTECTION_NOTICE_TEXTS,
  AUTH_PROTECTION_NOT_DISTRIBUTED,
  AUTH_PROTECTION_NO_BOT_DEFENCE,
  AUTH_PROTECTION_NO_CAPTCHA,
  AUTH_PROTECTION_NO_THIRD_PARTY,
  AUTH_PROTECTION_REJECTIONS,
  AUTH_PROTECTION_REVEALS,
  AUTH_PROTECTION_WARNING,
  AUTH_PROTECTION_WHAT,
  AUTH_PROTECTION_WHERE,
  AUTH_PROTECTION_WHY_NAMED,
  type AuthProtectionListSourceId,
  type AuthProtectionNoticeId,
  type AuthProtectionRejectionId,
} from "@/lib/console/auth-protection-texts";

/**
 * Auth → Passwortschutz (2.53), an der Stelle, an der bis hierher der
 * Platzhalter „Angriffsschutz" stand.
 *
 * Der Platzhalter nannte drei Dinge: Captcha, Passwortprüfung gegen bekannte
 * Lecks, Bot-Abwehr. Gebaut ist eines davon — dasjenige, das ohne fremden
 * Dienst und ohne Browser-Herausforderung auskommt. Die Seite sagt das
 * ausdrücklich und sagt in eigenen Karten, was die beiden anderen bräuchten.
 *
 * Die Seite kann genau eines: den Passwortschutz dieser Projektumgebung
 * setzen. Vor dem Speichern steht eine vollständige Vorschau — jeder der drei
 * Werte vorher und nachher. Erst danach gibt es den Knopf, der es wirklich
 * tut. Dieselbe Bauart wie Auth → Rate Limits (2.56) und Auth → Mehrfaktor
 * (2.52).
 */
type Environment = "development" | "staging" | "production";

type Protection = {
  leakedPasswordCheck: boolean;
  minLength: number;
  notice: AuthProtectionNoticeId;
};

type LeakList = {
  source: AuthProtectionListSourceId;
  algorithm: "sha1" | "sha256";
  prefixLength: number;
  entries: number;
  builtInEntries: number;
  builtInSource: string;
};

type PasswordProtection = {
  protection: Protection;
  defaults: Protection;
  bounds: { minLength: { min: number; max: number } };
  notices: AuthProtectionNoticeId[];
  list: LeakList;
  configured: boolean;
  updatedAt: string | null;
};

export function AuthProtectionView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/password-protection`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [data, setData] = useState<PasswordProtection | null>(null);
  const [draft, setDraft] = useState<Protection | null>(null);
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
      const loaded = payload.data as PasswordProtection;
      setData(loaded); setDraft({ ...loaded.protection });
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
        body: JSON.stringify({ protection: draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.data) {
        const reason = payload.reason as AuthProtectionRejectionId | undefined;
        const explained = reason && reason in AUTH_PROTECTION_REJECTIONS
          ? t(AUTH_PROTECTION_REJECTIONS[reason])
          : payload.error ?? t("Der Passwortschutz konnte nicht gespeichert werden.");
        setMessage(explained);
        return;
      }
      const saved = payload.data as PasswordProtection;
      setData(saved); setDraft({ ...saved.protection }); setPreview(false); setMessage("");
    } catch { setMessage(t("Der Passwortschutz konnte nicht gespeichert werden.")); }
    finally { setSaving(false); }
  }

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Passwortschutz wird geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !data || !draft) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Passwortschutz nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  const format = (value: string) => new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  const changed = draft.leakedPasswordCheck !== data.protection.leakedPasswordCheck ||
    draft.minLength !== data.protection.minLength ||
    draft.notice !== data.protection.notice;
  // Die eingebaute Liste ist kuerzer als die Mindestlaenge und lehnt darum
  // nichts ab, was die Laengenregel nicht schon ablehnt. Die Seite soll das
  // genau dann besonders deutlich sagen, wenn der Schalter an ist.
  const toothless = data.list.source === "built_in" && draft.leakedPasswordCheck;

  function edit(patch: Partial<Protection>) {
    setPreview(false); setMessage("");
    setDraft((previous) => previous ? { ...previous, ...patch } : previous);
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div>
        <span>{t("LECKPRÜFUNG")}</span>
        <strong>{data.protection.leakedPasswordCheck ? t("Ein") : t("Aus")}</strong>
        <small>{t(AUTH_PROTECTION_LIST_SOURCE_TEXTS[data.list.source])}</small>
      </div>
      <div>
        <span>{t("EINTRÄGE IN DER LISTE")}</span>
        <strong>{data.list.entries}</strong>
        <small>{data.list.algorithm.toUpperCase()} · {data.list.prefixLength} {t("Hexzeichen")}</small>
      </div>
      <div>
        <span>{t("MINDESTLÄNGE")}</span>
        <strong>{data.protection.minLength}</strong>
        <small>{t("Zeichen")}</small>
      </div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("Passwörter gegen bekannte Lecks")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing || saving}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_PROTECTION_WHAT)}</p>
      <p className="muted">{t(AUTH_PROTECTION_NO_THIRD_PARTY)}</p>
      <p className="muted">{t(AUTH_PROTECTION_WHERE)}</p>
      <p className="muted">{t(AUTH_PROTECTION_DIGESTS)}</p>
      <p className="muted">{t(AUTH_PROTECTION_REVEALS)}</p>
      <p className="muted">{t(AUTH_PROTECTION_WHY_NAMED)}</p>
      <p className="muted">{t(AUTH_PROTECTION_NEVER_LOGGED)}</p>
      <p className="muted">{t(AUTH_PROTECTION_FAILURE_MODE)}</p>
      <p className="muted">{t(AUTH_PROTECTION_AUDIT)}</p>
      {message && <p className="risk medium">{message}</p>}

      <div className="log-row">
        <span className={data.configured ? "secure" : "muted"}>
          {data.configured ? <ShieldCheck size={15}/> : <ShieldOff size={15}/>} {data.configured ? t("Diese Umgebung führt eigene Regeln.") : t("Diese Umgebung steht auf den Vorgaben.")}
        </span>
        <small>{data.updatedAt ? `${t("Zuletzt geändert:")} ${format(data.updatedAt)}` : t("Nie geändert; es gelten die Vorgaben des Dienstes.")}</small>
      </div>

      <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("PRÜFUNG")}</span><h3>{t("Gegen bekannte Lecks prüfen")}</h3></div><KeyRound size={18}/></div>
        <div className="log-row">
          <label>{t("Neu gesetzte Passwörter gegen die Liste prüfen")}<input
            type="checkbox"
            checked={draft.leakedPasswordCheck}
            disabled={saving}
            aria-label={t("Neu gesetzte Passwörter gegen die Liste prüfen")}
            onChange={(event) => edit({ leakedPasswordCheck: event.target.checked })}
          /></label>
          <small>{t("Vorgabe:")} {data.defaults.leakedPasswordCheck ? t("Ein") : t("Aus")}</small>
        </div>
        <div className="log-row">
          <label>{t("Mindestlänge in Zeichen")}<input
            type="number"
            value={draft.minLength}
            min={data.bounds.minLength.min}
            max={data.bounds.minLength.max}
            step={1}
            disabled={saving}
            aria-label={t("Mindestlänge in Zeichen")}
            onChange={(event) => edit({ minLength: Number(event.target.value) })}
          /></label>
          <small>{t("Erlaubt:")} {data.bounds.minLength.min}–{data.bounds.minLength.max} {t("Zeichen")}</small>
        </div>
        <p className="muted">{t(AUTH_PROTECTION_MIN_LENGTH)}</p>
        <div className="log-row">
          <label>{t("Was eine Ablehnung sagt")}<select
            value={draft.notice}
            disabled={saving}
            aria-label={t("Was eine Ablehnung sagt")}
            onChange={(event) => edit({ notice: event.target.value as AuthProtectionNoticeId })}
          >{data.notices.map((notice) => <option key={notice} value={notice}>{t(AUTH_PROTECTION_NOTICE_TEXTS[notice])}</option>)}</select></label>
          <small>{t(AUTH_PROTECTION_NOTICE_NOTES[draft.notice])}</small>
        </div>
      </div>

      {!preview && <div className="log-row">
        <button className="secondary-button" onClick={() => { setMessage(""); setPreview(true); }} disabled={saving || !changed}>
          <StableLabel current={t("Änderung prüfen")} variants={tAll("Änderung prüfen")}/>
        </button>
        {!changed && <small>{t("Nichts geändert.")}</small>}
      </div>}

      {preview && <div className="console-card preview-card">
        <div className="card-head"><div><span>{t("VORSCHAU")}</span><h3>{t("Passwortschutz ersetzen")}</h3></div><ShieldAlert size={18}/></div>
        <p className="risk medium">{t(AUTH_PROTECTION_WARNING)}</p>
        <div className="log-row">
          <span className={draft.leakedPasswordCheck !== data.protection.leakedPasswordCheck ? "risk medium" : "muted"}>{t("Gegen bekannte Lecks prüfen")}</span>
          <code>{data.protection.leakedPasswordCheck ? t("Ein") : t("Aus")} → {draft.leakedPasswordCheck ? t("Ein") : t("Aus")}</code>
        </div>
        <div className="log-row">
          <span className={draft.minLength !== data.protection.minLength ? "risk medium" : "muted"}>{t("Mindestlänge in Zeichen")}</span>
          <code>{data.protection.minLength} → {draft.minLength}</code>
        </div>
        <div className="log-row">
          <span className={draft.notice !== data.protection.notice ? "risk medium" : "muted"}>{t("Was eine Ablehnung sagt")}</span>
          <code>{t(AUTH_PROTECTION_NOTICE_TEXTS[data.protection.notice])} → {t(AUTH_PROTECTION_NOTICE_TEXTS[draft.notice])}</code>
        </div>
        <div className="log-row"><span>{t("Geltende Liste")}</span><code>{t(AUTH_PROTECTION_LIST_SOURCE_TEXTS[data.list.source])} · {data.list.entries}</code></div>
        {toothless && <p className="risk medium">{t(AUTH_PROTECTION_BUILT_IN_HONESTY)}</p>}
        <div className="log-row">
          <button className="secondary-button" onClick={() => void apply()} disabled={saving}>
            <StableLabel current={saving ? t("Wird gespeichert…") : t("Jetzt anwenden")} variants={tAll("Wird gespeichert…", "Jetzt anwenden")}/>
          </button>
          <button className="plain-button" onClick={() => setPreview(false)} disabled={saving}>{t("Abbrechen")}</button>
        </div>
      </div>}
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("LISTE")}</span><h3>{t("Woher die Liste kommt")}</h3></div><FileWarning size={18}/></div>
      <div className="log-row">
        <span>{t(AUTH_PROTECTION_LIST_SOURCE_TEXTS[data.list.source])}</span>
        <code>{data.list.entries} {t("Einträge")}</code>
      </div>
      <div className="log-row">
        <span>{t("Quelle der eingebauten Liste")}</span>
        <code>{data.list.builtInSource} · {data.list.builtInEntries}</code>
      </div>
      <p className="muted">{t(AUTH_PROTECTION_LIST_FILE)}</p>
      <p className="muted">{t(AUTH_PROTECTION_LIST_FAILURE)}</p>
      <p className="muted">{t(AUTH_PROTECTION_BUILT_IN)}</p>
      <p className="risk medium">{t(AUTH_PROTECTION_BUILT_IN_HONESTY)}</p>
    </article>

    <article className="console-card">
      <div className="card-head"><div><span>{t("NICHT GEBAUT")}</span><h3>{t("Was dieser Slice nicht baut")}</h3></div><ShieldAlert size={18}/></div>
      <p className="risk medium">{t(AUTH_PROTECTION_NO_CAPTCHA)}</p>
      <p className="risk medium">{t(AUTH_PROTECTION_NO_BOT_DEFENCE)}</p>
      <p className="muted">{t(AUTH_PROTECTION_NOT_DISTRIBUTED)}</p>
    </article>
  </div>;
}
