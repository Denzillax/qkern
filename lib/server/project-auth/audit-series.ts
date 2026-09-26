/**
 * Die Zeitreihe des Auth-Audits (2.47): der reine Teil.
 *
 * Aggregiert wird in der Datenbank (`date_trunc`, `GROUP BY`, `ORDER BY`
 * ueber `audit_logs`, siehe `audit-postgres`). Hier entsteht nur, was ohne
 * Datenbank pruefbar ist: das Fenster, die leeren Eimer, die Aufteilung nach
 * Handlung und der Ausgang. Gleiche Begruendung wie bei der Nutzungsreihe aus
 * 2.45: Die Datenbank liest dann nur, was wirklich da ist, und Fenster wie
 * Eimerzahl rechnet ohnehin der Dienst.
 *
 * Gezaehlt wird, was der Anmeldedienst protokolliert hat. Ein Audit-Eintrag
 * traegt eine Handlung, einen Ausgang und eine Referenz ohne "@" und ohne
 * `qk_`; mehr steht nicht darin, und mehr kann diese Reihe deshalb auch nicht
 * sagen. Wer sich angemeldet hat, steht hier nicht.
 *
 * Kein React, keine Farbe, keine Sprache, keine Datenbank.
 */

import {
  PROJECT_AUTH_AUDIT_ACTION_IDS,
  PROJECT_AUTH_AUDIT_ACTIONS,
  type ProjectAuthAuditAction,
  type ProjectAuthAuditActionId,
} from "@/lib/console/auth-observability-texts";

const KNOWN = new Set<string>(PROJECT_AUTH_AUDIT_ACTIONS);

/**
 * Das Fenster haengt an der Eimergroesse, nicht am Aufruf: Wer die Groesse
 * waehlt, waehlt damit auch, wie weit zurueck gelesen wird. Dieselben Werte
 * wie bei der Nutzungsreihe, damit beide Berichte dieselbe Zeit meinen.
 */
export const PROJECT_AUTH_SERIES_BUCKETS = {
  hour: { seconds: 3600, maxBuckets: 48 },
  day: { seconds: 86_400, maxBuckets: 90 },
} as const;

export type ProjectAuthSeriesBucket = keyof typeof PROJECT_AUTH_SERIES_BUCKETS;

export function isProjectAuthSeriesBucket(value: unknown): value is ProjectAuthSeriesBucket {
  return typeof value === "string" && Object.hasOwn(PROJECT_AUTH_SERIES_BUCKETS, value);
}

/** Eine Gruppe, wie die Datenbank sie liefert: Eimer, Handlung, zwei Zahlen. */
export type ProjectAuthAuditSeriesRecord = {
  bucketStart: Date;
  action: string;
  total: number;
  failed: number;
};

export type ProjectAuthAuditSeriesQuery = {
  bucket: ProjectAuthSeriesBucket;
  from: Date;
  to: Date;
  limit: number;
};

export type ProjectAuthAuditCounts = {
  total: number;
  succeeded: number;
  failed: number;
  actions: Record<ProjectAuthAuditActionId, number>;
};

export type ProjectAuthAuditSeriesBucketView = ProjectAuthAuditCounts & {
  /** ISO-8601, Beginn des Eimers. */
  start: string;
};

export type PublicProjectAuthAuditSeries = {
  bucket: ProjectAuthSeriesBucket;
  windowStart: string;
  windowEnd: string;
  bucketCount: number;
  /** Die Datenbank hat an der Zeilengrenze abgeschnitten. */
  truncated: boolean;
  actions: ReadonlyArray<ProjectAuthAuditActionId>;
  buckets: ProjectAuthAuditSeriesBucketView[];
  totals: ProjectAuthAuditCounts;
};

/**
 * Das Fenster einer Reihe: es endet mit dem Ende des laufenden Eimers und
 * reicht so viele Eimer zurueck, wie die Groesse erlaubt. Gerechnet wird in
 * UTC-Millisekunden, weil Stunde und Tag dort eine feste Laenge haben.
 */
export function projectAuthSeriesWindow(bucket: ProjectAuthSeriesBucket, now: Date) {
  const size = PROJECT_AUTH_SERIES_BUCKETS[bucket];
  const step = size.seconds * 1000;
  const end = new Date(Math.floor(now.getTime() / step) * step + step);
  return { start: new Date(end.getTime() - size.maxBuckets * step), end };
}

/**
 * Wie viele Gruppen das Fenster hoechstens tragen kann: je Eimer eine Zeile
 * je Handlung, dazu eine Reserve fuer eine Handlung, die diese Fassung noch
 * nicht kennt. Der Dienst fragt eine Zeile mehr ab; kommt sie, war die
 * Antwort abgeschnitten, und die Ansicht sagt das.
 */
export function projectAuthSeriesRowLimit(bucket: ProjectAuthSeriesBucket): number {
  return PROJECT_AUTH_SERIES_BUCKETS[bucket].maxBuckets * (PROJECT_AUTH_AUDIT_ACTIONS.length + 1);
}

function emptyCounts(): ProjectAuthAuditCounts {
  const actions = {} as Record<ProjectAuthAuditActionId, number>;
  for (const id of PROJECT_AUTH_AUDIT_ACTION_IDS) actions[id] = 0;
  return { total: 0, succeeded: 0, failed: 0, actions };
}

function add(counts: ProjectAuthAuditCounts, action: string, total: number, failed: number): void {
  const id: ProjectAuthAuditActionId = KNOWN.has(action) ? action as ProjectAuthAuditAction : "other";
  counts.actions[id] += total;
  counts.total += total;
  counts.failed += failed;
  counts.succeeded += total - failed;
}

/**
 * Aus den Gruppen der Datenbank wird die Reihe, die die Console sieht: jeder
 * Eimer des Fensters, auch die leeren.
 *
 * Eine Gruppe ausserhalb des Fensters wird weggelassen statt an den Rand
 * gerechnet. Sie duerfte gar nicht kommen; kaeme sie doch, waere ein Eimer am
 * Rand stillschweigend zu hoch, und das faellt niemandem auf.
 */
export function buildProjectAuthAuditSeries(input: {
  bucket: ProjectAuthSeriesBucket;
  now: Date;
  records: ReadonlyArray<ProjectAuthAuditSeriesRecord>;
}): PublicProjectAuthAuditSeries {
  const size = PROJECT_AUTH_SERIES_BUCKETS[input.bucket];
  const window = projectAuthSeriesWindow(input.bucket, input.now);
  const rowLimit = projectAuthSeriesRowLimit(input.bucket);
  const truncated = input.records.length > rowLimit;
  const step = size.seconds * 1000;

  const buckets: ProjectAuthAuditSeriesBucketView[] = [];
  const index = new Map<number, ProjectAuthAuditSeriesBucketView>();
  for (let position = 0; position < size.maxBuckets; position += 1) {
    const start = window.start.getTime() + position * step;
    const view = { start: new Date(start).toISOString(), ...emptyCounts() };
    buckets.push(view);
    index.set(start, view);
  }

  const totals = emptyCounts();
  for (const record of input.records.slice(0, rowLimit)) {
    const view = index.get(record.bucketStart.getTime());
    if (!view || !Number.isFinite(record.total) || record.total < 0) continue;
    const failed = Math.min(Math.max(record.failed, 0), record.total);
    add(view, record.action, record.total, failed);
    add(totals, record.action, record.total, failed);
  }

  return {
    bucket: input.bucket,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    bucketCount: size.maxBuckets,
    truncated,
    actions: PROJECT_AUTH_AUDIT_ACTION_IDS,
    buckets,
    totals,
  };
}
