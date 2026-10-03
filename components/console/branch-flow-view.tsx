"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, GitBranch, GitCommitHorizontal, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  APPROVALS_SOURCE_NOTE,
  APPROVAL_STATUS_TEXTS,
  CHANGE_SETS_SOURCE_NOTE,
  CHANGE_STATUS_TEXTS,
  ENVIRONMENT_SET_NOTE,
  ENVIRONMENT_TEXTS,
  MIGRATIONS_SOURCE_NOTE,
  MIGRATION_STATUS_TEXTS,
  MISSING_BRANCHING,
  NO_FREE_BRANCHES,
  NO_QUEUE_NOTE,
  PRESENCE_TEXTS,
  REVIEW_EXISTS_NOTE,
  REVIEW_STEPS,
  SCOPE_NOTE,
  environmentText,
  openChangeCount,
  presence,
  type ApprovalStatusId,
  type ChangeStatusId,
  type MigrationStatusId,
} from "@/lib/console/branch-flow-texts";

/**
 * Branches (2.81), nur lesend.
 *
 * Die Seite ersetzt zwei Platzhalter: "Branches" versprach einen Zweig je
 * Feature mit eigener Datenbank, "Merge-Anfragen" versprach das Prüfen und
 * Übernehmen der Änderungen eines Zweigs. Die eine Hälfte davon gibt es nicht
 * und die andere gibt es anders, und genau das steht im ersten Absatz.
 *
 * Was es nicht gibt: frei benannte Zweige, eine Datenbank je Zweig auf Zuruf,
 * eine Abstammung zwischen Umgebungen, ein automatisches Zusammenführen. Jeder
 * dieser Punkte steht als Zeile mit Grund da und nicht als leere Kachel.
 *
 * Was es gibt: den Prüfschritt. Ein Change Set trägt eine Änderung, eine
 * Freigabe prüft sie, ein Worker wendet sie an. Dazu zeigt die Seite die
 * echten Zahlen der Kontrollebene je Umgebung, gezählt in der Datenbank.
 *
 * Worauf eine Umgebung läuft, steht unter Einstellungen → Infrastruktur und
 * wird hier nicht wiederholt.
 *
 * Kein Eingabefeld, kein Speicherknopf, kein Schreibaufruf.
 */
type Environment = "development" | "staging" | "production";

type Tally<Status extends string> = {
  total: number;
  byStatus: Record<Status, number>;
  latestCreatedAt: string | null;
};

type EnvironmentFlow = {
  environment: Environment;
  present: boolean;
  bound: boolean;
  changeSets: Tally<ChangeStatusId>;
  approvals: Tally<ApprovalStatusId>;
  /** null heisst: keine Warteschlange, nicht eine leere Warteschlange. */
  migrations: (Tally<MigrationStatusId> & { lastFinishedAt: string | null }) | null;
};

type ViewState = "loading" | "ready" | "unavailable" | "error";

async function readJson(url: string, signal: AbortSignal): Promise<{ status: number; payload: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    const body: unknown = (await response.json().catch(() => ({}))) ?? {};
    const payload = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    return { status: response.status, payload };
  } catch (cause) {
    if (signal.aborted) return { status: 0, payload: {} };
    return { status: 0, payload: { error: cause instanceof Error ? cause.message : "" } };
  }
}

/** Ein Zustand mit seiner Zahl, seinem Wortlaut und seiner Erklaerung. */
function StateRow({ label, explains, tone, count }: { label: string; explains: string; tone: string; count: number }) {
  return <div className="log-row">
    <span className={tone}>{t(label)}</span>
    <span>{formatNumber(count)}</span>
    <small className="muted">{t(explains)}</small>
  </div>;
}

export function BranchFlowView(props: { projectId: string; environment: Environment; initialState?: ViewState }) {
  const { projectId, environment } = props;
  const [state, setState] = useState<ViewState>(props.initialState ?? "loading");
  const [flows, setFlows] = useState<EnvironmentFlow[] | null>(null);
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
    const answer = await readJson(`/api/v1/projects/${projectId}/change-flow`, controller.signal);
    if (controller.signal.aborted) return;
    const data = answer.payload.data as { environments?: EnvironmentFlow[] } | undefined;
    if (answer.status === 200 && Array.isArray(data?.environments)) {
      setFlows(data!.environments!);
      setState("ready");
      return;
    }
    setFlows(null);
    setMessage(typeof answer.payload.error === "string" ? (serverErrorText(answer.payload.error) ?? "") : "");
    // Nicht gefunden und Fehler sind zwei verschiedene Auskuenfte; eine leere
    // Seite waere die dritte und hier keine.
    setState(answer.status === 404 ? "unavailable" : "error");
  }, [projectId]);

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); };
  }, [load]);

  const loading = state === "loading";
  const refresh = <button className="secondary-button" onClick={() => void load()} disabled={loading}>
    <RefreshCw size={14}/> <StableLabel current={loading ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
  </button>;

  const open = (flows ?? []).reduce((sum, flow) => sum + openChangeCount(flow.changeSets.byStatus), 0);
  const applied = (flows ?? []).reduce((sum, flow) => sum + flow.changeSets.byStatus.applied, 0);

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("BRANCHES")} · {environment.toUpperCase()}</span><h3>{t("Umgebungen sind keine Zweige")}</h3></div><div>{refresh}</div></div>
      {/* Der erste Absatz sagt, was es nicht gibt. Er steht vor jeder Zahl. */}
      <p><strong>{t(NO_FREE_BRANCHES)}</strong></p>
      <p className="muted">{t(REVIEW_EXISTS_NOTE)}</p>
      <p className="muted">{t(SCOPE_NOTE)}</p>
      {loading && !flows && <p className="muted">{t("Die Kontrollebene wird gefragt…")}</p>}
      {state === "unavailable" && <p><strong>{t("Projekt nicht abrufbar")}</strong> · {t("Die Kontrollebene führt dieses Projekt für diese Organisation nicht.")}</p>}
      {state === "error" && <p><strong>{t("Zahlen nicht verfügbar")}</strong> · {message}</p>}
    </article>

    {flows !== null && <article className="console-card auth-overview">
      <div><span>{t("OFFEN")}</span><strong>{formatNumber(open)}</strong><small>{t("Änderungen über alle drei Umgebungen")}</small></div>
      <div><span>{t("ANGEWANDT")}</span><strong>{formatNumber(applied)}</strong><small>{t("mit Ledger-Eintrag")}</small></div>
      <div><span>{t("UMGEBUNGEN")}</span><strong>{formatNumber(flows.length)}</strong><small>{t("fest, nicht anlegbar")}</small></div>
    </article>}

    {(flows ?? []).map((flow) => {
      const meta = ENVIRONMENT_TEXTS[environmentText(flow.environment)];
      const here = PRESENCE_TEXTS[presence(flow.present)];
      return <article className="console-card span-2" key={flow.environment}>
        <div className="card-head">
          <div>
            <span>{t("UMGEBUNG")}{flow.environment === environment ? ` · ${t("gerade geöffnet")}` : ""}</span>
            <h3>{t(meta.label)}</h3>
          </div>
          <Boxes size={18}/>
        </div>
        <p className="muted">{t(meta.explains)}</p>
        <div className="bucket-row">
          <span className="bucket-icon"><Boxes size={16}/></span>
          <div><strong className={here.tone}>{t(here.label)}</strong><p className="muted">{t(here.explains)}</p></div>
          {flow.present && <span className={flow.bound ? "secure" : "muted"}>{flow.bound ? t("gebunden") : t("wartet")}</span>}
        </div>

        <div className="log-row log-header"><span>{t("CHANGE SETS")}</span><span>{formatNumber(flow.changeSets.total)}</span><small>{flow.changeSets.latestCreatedAt ? `${t("zuletzt eingereicht")} ${formatMoment(flow.changeSets.latestCreatedAt)}` : t("noch keines")}</small></div>
        {(Object.keys(CHANGE_STATUS_TEXTS) as ChangeStatusId[]).map((status) => <StateRow
          key={status}
          label={CHANGE_STATUS_TEXTS[status].label}
          explains={CHANGE_STATUS_TEXTS[status].explains}
          tone={CHANGE_STATUS_TEXTS[status].tone}
          count={flow.changeSets.byStatus[status]}
        />)}
        <p className="muted">{t(CHANGE_SETS_SOURCE_NOTE)}</p>

        <div className="log-row log-header"><span>{t("FREIGABEN")}</span><span>{formatNumber(flow.approvals.total)}</span><small>{flow.approvals.latestCreatedAt ? `${t("zuletzt angefragt")} ${formatMoment(flow.approvals.latestCreatedAt)}` : t("noch keine")}</small></div>
        {(Object.keys(APPROVAL_STATUS_TEXTS) as ApprovalStatusId[]).map((status) => <StateRow
          key={status}
          label={APPROVAL_STATUS_TEXTS[status].label}
          explains={APPROVAL_STATUS_TEXTS[status].explains}
          tone={APPROVAL_STATUS_TEXTS[status].tone}
          count={flow.approvals.byStatus[status]}
        />)}
        <p className="muted">{t(APPROVALS_SOURCE_NOTE)}</p>

        {/* null ist keine Null: Ohne Warteschlange steht hier ein Satz. */}
        {flow.migrations === null && <p className="muted">{t(NO_QUEUE_NOTE)}</p>}
        {flow.migrations !== null && <>
          <div className="log-row log-header"><span>{t("MIGRATIONSSTAND")}</span><span>{formatNumber(flow.migrations.total)}</span><small>{flow.migrations.lastFinishedAt ? `${t("zuletzt angekommen")} ${formatMoment(flow.migrations.lastFinishedAt)}` : t("noch nichts angekommen")}</small></div>
          {(Object.keys(MIGRATION_STATUS_TEXTS) as MigrationStatusId[]).map((status) => <StateRow
            key={status}
            label={MIGRATION_STATUS_TEXTS[status].label}
            explains={MIGRATION_STATUS_TEXTS[status].explains}
            tone={MIGRATION_STATUS_TEXTS[status].tone}
            count={flow.migrations!.byStatus[status]}
          />)}
          <p className="muted">{t(MIGRATIONS_SOURCE_NOTE)}</p>
        </>}
      </article>;
    })}

    {flows !== null && <p className="muted">{t(ENVIRONMENT_SET_NOTE)}</p>}

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("STATT EINER MERGE-ANFRAGE")}</span><h3>{t("Wie QKERN eine Änderung prüft")}</h3></div><ShieldCheck className="secure" size={18}/></div>
      {REVIEW_STEPS.map((entry, index) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon">{index === 0 ? <GitCommitHorizontal size={16}/> : index === 1 ? <ShieldCheck size={16}/> : <Workflow size={16}/>}</span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("NICHT VORHANDEN")}</span><h3>{t("Was QKERN an dieser Stelle nicht kann")}</h3></div><GitBranch size={18}/></div>
      {MISSING_BRANCHING.map((entry) => <div className="bucket-row" key={entry.title}>
        <span className="bucket-icon"><GitBranch size={16}/></span>
        <div><strong>{t(entry.title)}</strong><p className="muted">{t(entry.body)}</p></div>
      </div>)}
    </article>
  </div>;
}
