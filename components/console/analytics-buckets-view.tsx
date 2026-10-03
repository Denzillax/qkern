"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, HardDrive, KeyRound, Layers, Puzzle, RefreshCw, Send } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatNumber } from "@/components/console/console-display";
import {
  ANALYTICS_BUCKET_TEXTS,
  ANALYTICS_FACTS,
  ANALYTICS_NEXT_STEPS,
  ANALYTICS_VERDICTS,
  analyticsVerdict,
} from "@/lib/console/analytics-buckets-texts";

/**
 * Storage -> Analytics-Buckets (2.99): die ehrliche Antwort auf den letzten
 * Platzhalter der Console, der eine "spaltenorientierte Ablage fuer grosse
 * Auswertungen (Iceberg)" versprochen hat.
 *
 * Bei Supabase ist das eine Ablage fuer Iceberg-Tabellen: Parquet-Dateien im
 * Storage, ein Katalog nach der Iceberg-REST-Schnittstelle, Zugang mit
 * S3-Schluesseln, Abfragen ueber eine Engine ausserhalb der Datenbank. QKERN
 * hat davon den S3-Zugang (2.96, 2.99) und Buckets fuer Bytes. Es fehlt der
 * Katalog (keine Tabelle, keine Route, kein Dienst), es fehlt Multipart am
 * S3-Endpunkt, und es fehlt eine Engine, die eine Parquet-Datei als Tabelle
 * liest.
 *
 * Den letzten Punkt behauptet die Seite nicht aus dem Quelltext heraus,
 * sondern fragt bei jedem Oeffnen den Katalog dieser einen Projektdatenbank:
 * `/schema/extensions`, dieselbe Route wie unter Datenbank -> Erweiterungen,
 * und sucht darin nach den Erweiterungen, die Parquet oder Iceberg lesen
 * wuerden. Bietet ein Server eine davon an, dreht sich das Urteil von selbst.
 *
 * Dazu liest sie die Buckets, die es wirklich gibt, damit die Seite nicht nur
 * sagt, was fehlt, sondern auch, was da ist.
 *
 * Nur lesend: zwei GETs, kein Schreibverb.
 */
type Environment = "development" | "staging" | "production";
type Extension = { name: string; defaultVersion: string; installedVersion: string | null; schema: string | null; comment: string | null };
type Bucket = { id: string; name: string; usedBytes: number; quotaBytes: number };
type CatalogState = "loading" | "ready" | "unavailable" | "error";

export function AnalyticsBucketsView({ projectId, environment, initialState }: {
  projectId: string;
  environment: Environment;
  /** Nur fuer den Render-Vertrag: der erste Zustand, ohne dass ein Effekt laeuft. */
  initialState?: CatalogState;
}) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketsKnown, setBucketsKnown] = useState(false);
  const [state, setState] = useState<CatalogState>(initialState ?? "loading");
  const [message, setMessage] = useState("");

  const base = `/api/v1/projects/${projectId}/environments/${environment}`;

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch(`${base}/schema/extensions`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { data?: { extensions?: Extension[] }; error?: string };
      if (response.status === 503 || response.status === 409) {
        setExtensions([]);
        setState("unavailable");
        setMessage(serverErrorText(payload.error) ?? t("Die Projektdatenbank ist noch nicht bereit."));
      } else if (!response.ok) {
        throw new Error(serverErrorText(payload.error) ?? t("Der Katalog ist nicht verfügbar."));
      } else {
        setExtensions(payload.data?.extensions ?? []);
        setState("ready");
      }
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : t("Der Katalog ist nicht verfügbar."));
    }
    // Die Buckets sind die zweite Karte und duerfen fehlen. Ein Fehlschlag
    // laesst die Liste weg, statt einen Bucket zu erfinden.
    try {
      const response = await fetch(`${base}/storage/buckets`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { data?: Bucket[] };
      if (response.ok && Array.isArray(payload.data)) {
        setBuckets(payload.data);
        setBucketsKnown(true);
      } else {
        setBuckets([]);
        setBucketsKnown(false);
      }
    } catch {
      setBuckets([]);
      setBucketsKnown(false);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>{t("Der Katalog dieser Datenbank wird gelesen…")}</h3></div>;
  }

  const verdict = analyticsVerdict(extensions);
  const spoken = ANALYTICS_VERDICTS[verdict.id];
  const unknown = state !== "ready";
  const byName = new Map(extensions.map((entry) => [entry.name, entry] as const));

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(ANALYTICS_BUCKET_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(ANALYTICS_BUCKET_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={() => void load()}>
          <RefreshCw size={14}/> {t("Neu laden")}
        </button>
      </div></div>
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.opening)}</p>
      {unknown
        ? <p className="risk medium">{message || t("Der Katalog ist nicht verfügbar.")}</p>
        : <>
          <p className={spoken.tone}>{t(spoken.label)}</p>
          <p className="muted">{t(spoken.explains)}</p>
        </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(ANALYTICS_BUCKET_TEXTS.serverTitle)}</h3></div><Puzzle size={18}/></div>
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.serverMeaning)}</p>
      {!unknown && <div className="auth-overview">
        <div><span>{t("VERFÜGBAR")}</span><strong>{formatNumber(extensions.length)}</strong><small>{t("Erweiterungen auf diesem Server")}</small></div>
        <div><span>{t("INSTALLIERT")}</span><strong>{formatNumber(extensions.filter((entry) => entry.installedVersion !== null).length)}</strong><small>{t("in dieser Datenbank")}</small></div>
        <div><span>{t("GESUCHT")}</span><strong>{formatNumber(verdict.found.length)} / {formatNumber(ANALYTICS_FACTS.extensions.length)}</strong><small>{t("Erweiterungen für Parquet oder Iceberg, die dieser Server anbietet")}</small></div>
      </div>}
      {!unknown && ANALYTICS_FACTS.extensions.map((name) => {
        const entry = byName.get(name);
        return <div className="log-row" key={name}><span>{name}</span><code>{entry === undefined ? t("fehlt") : entry.installedVersion ?? `${entry.defaultVersion} · ${t("nicht angelegt")}`}</code></div>;
      })}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(ANALYTICS_BUCKET_TEXTS.s3Title)}</h3></div><KeyRound size={18}/></div>
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.s3Meaning)}</p>
      <div className="log-row"><span>{t("Endpunkt")}</span><code>{ANALYTICS_FACTS.s3EndpointPath}</code></div>
      <div className="log-row"><span>{t("Grösstes Objekt je PutObject")}</span><code>{formatNumber(ANALYTICS_FACTS.s3MaxPutMiB)} MiB</code></div>
      <div className="log-row"><span>{t("Multipart über S3")}</span><code>501</code></div>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(ANALYTICS_BUCKET_TEXTS.bucketsTitle)}</h3></div><HardDrive size={18}/></div>
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.bucketsMeaning)}</p>
      {!bucketsKnown && <p className="muted">{t("Die Buckets dieser Umgebung sind gerade nicht zu lesen; die Liste bleibt darum leer.")}</p>}
      {bucketsKnown && buckets.length === 0 && <p className="muted">{t("In dieser Umgebung gibt es noch keinen Bucket.")}</p>}
      {bucketsKnown && buckets.map((bucket) => <div className="bucket-row" key={bucket.id}>
        <span className="bucket-icon"><Boxes size={16}/></span>
        <div><strong>{bucket.name}</strong><small>{t("hält Bytes, keine Tabellen")}</small></div>
        <span className="muted">{formatNumber(bucket.usedBytes)} B</span>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS FEHLT")}</span><h3>{t(ANALYTICS_BUCKET_TEXTS.catalogTitle)}</h3></div><Layers size={18}/></div>
      <p className="risk medium">{t(ANALYTICS_BUCKET_TEXTS.catalogMeaning)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(ANALYTICS_BUCKET_TEXTS.nextTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.nextLead)}</p>
      {ANALYTICS_NEXT_STEPS.map((step) => <div className="log-row" key={step.title}>
        <span>{t(step.title)}</span><span className="muted">{t(step.body)}</span>
      </div>)}
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.readOnly)}</p>
      <p className="muted">{t(ANALYTICS_BUCKET_TEXTS.noNumbers)}</p>
    </article>
  </div>;
}
