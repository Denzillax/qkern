"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, HardDrive, Puzzle, RefreshCw, Ruler, Send } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { serverErrorText } from "@/components/console/server-errors";
import { formatNumber } from "@/components/console/console-display";
import {
  VECTOR_BUCKET_TEXTS,
  VECTOR_FACTS,
  VECTOR_NEXT_STEPS,
  VECTOR_VERDICTS,
  vectorVerdict,
} from "@/lib/console/vector-buckets-texts";

/**
 * Storage -> Vektor-Buckets (2.93): die ehrliche Antwort auf einen
 * Platzhalter, der eine „Ablage fuer Embeddings mit Aehnlichkeitssuche"
 * versprochen hat.
 *
 * Es gibt sie nicht, und es fehlt nicht bloss die Oberflaeche. Der Server
 * dieses Stacks bringt die Erweiterung `vector` gar nicht mit: `postgres:17-
 * alpine` hat 59 Erweiterungen, und keine davon legt einen Vektortyp an.
 * Alpines Paket `postgresql-pgvector` ist gegen PostgreSQL 18 gebaut und
 * hilft dem selbst gebauten PostgreSQL 17 im Image nicht. Ohne Typ gibt es
 * keine Spalte, in der eine Einbettung stehen koennte, und ohne Operator
 * keinen Abstand, nach dem sich sortieren liesse.
 *
 * Die Seite behauptet das aber nicht aus dem Quelltext heraus, sondern fragt
 * bei jedem Oeffnen den Katalog dieser einen Projektdatenbank:
 * `/schema/extensions`, dieselbe Route wie unter Datenbank -> Erweiterungen.
 * Bietet ein Server die Erweiterung eines Tages an, dreht sich das Urteil von
 * selbst, ohne dass jemand einen Satz umschreibt.
 *
 * Dazu liest sie die Buckets, die es wirklich gibt, damit die Seite nicht nur
 * sagt, was fehlt, sondern auch, was ein Bucket bei QKERN ist: eine Ablage
 * fuer Bytes, gefunden ueber den Schluessel eines Objekts und nicht ueber
 * seinen Inhalt.
 *
 * Nur lesend: zwei GETs, kein Schreibverb.
 */
type Environment = "development" | "staging" | "production";
type Extension = { name: string; defaultVersion: string; installedVersion: string | null; schema: string | null; comment: string | null };
type Bucket = { id: string; name: string; usedBytes: number; quotaBytes: number };
type CatalogState = "loading" | "ready" | "unavailable" | "error";

export function VectorBucketsView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketsKnown, setBucketsKnown] = useState(false);
  const [state, setState] = useState<CatalogState>("loading");
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

  const vector = extensions.find((entry) => entry.name === VECTOR_FACTS.extension) ?? null;
  const fallback = extensions.find((entry) => entry.name === VECTOR_FACTS.fallbackExtension) ?? null;
  const verdict = VECTOR_VERDICTS[vectorVerdict(vector?.installedVersion ?? null, vector !== null)];
  const unknown = state !== "ready";

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div><span>{t(VECTOR_BUCKET_TEXTS.kicker)} · {environment.toUpperCase()}</span><h3>{t(VECTOR_BUCKET_TEXTS.title)}</h3></div><div>
        <button className="secondary-button" onClick={() => void load()}>
          <RefreshCw size={14}/> {t("Neu laden")}
        </button>
      </div></div>
      <p className="muted">{t(VECTOR_BUCKET_TEXTS.opening)}</p>
      {unknown
        ? <p className="risk medium">{message || t("Der Katalog ist nicht verfügbar.")}</p>
        : <>
          <p className={verdict.tone}>{t(verdict.label)}</p>
          <p className="muted">{t(verdict.explains)}</p>
        </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(VECTOR_BUCKET_TEXTS.serverTitle)}</h3></div><Puzzle size={18}/></div>
      <p className="muted">{t(VECTOR_BUCKET_TEXTS.serverMeaning)}</p>
      {!unknown && <div className="auth-overview">
        <div><span>{t("VERFÜGBAR")}</span><strong>{formatNumber(extensions.length)}</strong><small>{t("Erweiterungen auf diesem Server")}</small></div>
        <div><span>{t("INSTALLIERT")}</span><strong>{formatNumber(extensions.filter((entry) => entry.installedVersion !== null).length)}</strong><small>{t("in dieser Datenbank")}</small></div>
        <div><span>{VECTOR_FACTS.extension}</span><strong>{vector === null ? t("fehlt") : vector.installedVersion ?? vector.defaultVersion}</strong><small>{t("die Erweiterung, die einen Vektortyp mitbrächte")}</small></div>
      </div>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES STATTDESSEN GIBT")}</span><h3>{t(VECTOR_BUCKET_TEXTS.fallbackTitle)}</h3></div><Ruler size={18}/></div>
      {!unknown && fallback === null
        ? <p className="risk medium">{t(VECTOR_BUCKET_TEXTS.fallbackAbsent)}</p>
        : <>
          <p className="muted">{t(VECTOR_BUCKET_TEXTS.fallbackMeaning)}</p>
          <div className="log-row"><span>{VECTOR_FACTS.fallbackExtension}</span><code>{fallback === null ? t("unbekannt") : fallback.installedVersion ?? fallback.defaultVersion}</code></div>
          <div className="log-row"><span>{t("Höchste Zahl der Dimensionen")}</span><code>{formatNumber(VECTOR_FACTS.fallbackMaxDimensions)}</code></div>
        </>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("WAS ES GIBT")}</span><h3>{t(VECTOR_BUCKET_TEXTS.bucketsTitle)}</h3></div><HardDrive size={18}/></div>
      <p className="muted">{t(VECTOR_BUCKET_TEXTS.bucketsMeaning)}</p>
      <p className="risk medium">{t(VECTOR_BUCKET_TEXTS.bucketsLimit)}</p>
      {!bucketsKnown && <p className="muted">{t("Die Buckets dieser Umgebung sind gerade nicht zu lesen; die Liste bleibt darum leer.")}</p>}
      {bucketsKnown && buckets.length === 0 && <p className="muted">{t("In dieser Umgebung gibt es noch keinen Bucket.")}</p>}
      {bucketsKnown && buckets.map((bucket) => <div className="bucket-row" key={bucket.id}>
        <span className="bucket-icon"><Boxes size={16}/></span>
        <div><strong>{bucket.name}</strong><small>{t("hält Bytes, keine Einbettungen")}</small></div>
        <span className="muted">{formatNumber(bucket.usedBytes)} B</span>
      </div>)}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div><span>{t("FÜR BETREIBER")}</span><h3>{t(VECTOR_BUCKET_TEXTS.nextTitle)}</h3></div><Send size={18}/></div>
      <p className="muted">{t(VECTOR_BUCKET_TEXTS.nextLead)}</p>
      {VECTOR_NEXT_STEPS.map((step) => <div className="log-row" key={step.title}>
        <span>{t(step.title)}</span><span className="muted">{t(step.body)}</span>
      </div>)}
      <p className="muted">{t(VECTOR_BUCKET_TEXTS.readOnly)}</p>
      <p className="muted">{t(VECTOR_BUCKET_TEXTS.noNumbers)}</p>
    </article>
  </div>;
}
