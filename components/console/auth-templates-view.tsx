"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, ShieldOff } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { StableLabel } from "@/components/stable-label";
import {
  AUTH_TEMPLATES_HONESTY,
  AUTH_TEMPLATES_HOW_TO_CHANGE,
  AUTH_TEMPLATES_ONE_LANGUAGE,
  AUTH_TEMPLATES_WHAT_VARIES,
  AUTH_TEMPLATE_PURPOSE_TEXTS,
  type AuthTemplatePurposeId,
} from "@/lib/console/auth-settings-texts";

/**
 * Auth → E-Mail-Vorlagen (2.54), wie bei Supabase unter Authentication,
 * Emails, Templates — nur eben ohne Editor.
 *
 * Der Platzhalter sagte: „Mails gehen heute mit festem Text." Das stimmt, und
 * daran ändert diese Seite nichts. Sie macht etwas anderes: Sie zeigt den
 * Text, der wirklich hinausgeht, aus derselben Funktion, die ihn versendet —
 * und sie sagt, dass Ändern eine Auslieferung braucht.
 *
 * Kein Eingabefeld, kein Speichern-Knopf, kein ausgegrauter Editor: Ein
 * Editor, der in nichts schreibt, wäre ein Versprechen, das die Seite nicht
 * halten kann.
 */
type Environment = "development" | "staging" | "production";

type Template = {
  purpose: AuthTemplatePurposeId;
  subject: string;
  intro: string;
  body: string;
};

type Settings = {
  templatesEditable: boolean;
  languages: string[];
  templates: Template[];
};

export function AuthTemplatesView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: "loading" | "ready" | "unavailable" | "error" }) {
  const route = `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/mail`;
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(initialState ?? "loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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
        setSettings(null); setState("unavailable");
        setMessage(payload.error ?? t("Project Auth ist für diese Umgebung deaktiviert."));
        return;
      }
      if (!response.ok || !payload.data) {
        setSettings(null); setState("error");
        setMessage(payload.error ?? t("Die Route hat nicht geantwortet."));
        return;
      }
      setSettings(payload.data as Settings); setMessage(""); setState("ready");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRefreshing(false); setSettings(null); setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Die Route hat nicht geantwortet."));
    }
  }, [route]);

  useEffect(() => {
    void load(true);
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Mailtexte werden geladen…")}</h3></div>;
  }
  if (state === "unavailable" || state === "error" || !settings) {
    return <div className="console-card live-module-state"><ShieldOff size={26}/>
      <h3>{state === "unavailable" ? t("Project Auth nicht aktiviert") : t("Mailtexte nicht verfügbar")}</h3>
      <p>{message}</p>
      <button className="secondary-button" onClick={() => void load(true)}><RefreshCw size={14}/> {t("Noch einmal")}</button>
    </div>;
  }

  return <div className="module-grid">
    <article className="console-card auth-overview">
      <div><span>{t("VORLAGEN")}</span><strong>{settings.templates.length}</strong><small>{t("fest im Quelltext")}</small></div>
      <div><span>{t("BEARBEITBAR")}</span><strong>{t("nein")}</strong><small>{t("Ändern braucht eine Auslieferung")}</small></div>
      <div><span>{t("SPRACHEN")}</span><strong>{settings.languages.join(", ").toUpperCase()}</strong><small>{t("keine Sprachvarianten je Nutzer")}</small></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head">
        <div><span>{t("PROJECT AUTH")} · {environment.toUpperCase()}</span><h3>{t("E-Mail-Vorlagen")}</h3></div>
        <div>
          <button className="secondary-button" onClick={() => void load(false)} disabled={refreshing}><RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/></button>
        </div>
      </div>

      <p className="muted">{t(AUTH_TEMPLATES_HONESTY)}</p>
      <p className="muted">{t(AUTH_TEMPLATES_HOW_TO_CHANGE)}</p>
      <p className="muted">{t(AUTH_TEMPLATES_ONE_LANGUAGE)}</p>
      <p className="muted">{t(AUTH_TEMPLATES_WHAT_VARIES)}</p>
    </article>

    {settings.templates.map((template) => <article className="console-card span-2" key={template.purpose}>
      <div className="card-head">
        <div><span>{t("VORLAGE")}</span><h3>{t(AUTH_TEMPLATE_PURPOSE_TEXTS[template.purpose] ?? template.purpose)}</h3></div>
        <FileText size={18}/>
      </div>
      <div className="log-row"><span>{t("Betreff")}</span><code>{template.subject}</code></div>
      <pre>{template.body}</pre>
    </article>)}
  </div>;
}
