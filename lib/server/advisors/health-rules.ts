import { nextCronOccurrence } from "@/lib/server/compute/cron";
import {
  HEALTH_DETAILS,
  HEALTH_MEASURES,
  HEALTH_STATE_RANK,
  HEALTH_SUBSYSTEM_IDS,
  type HealthDetailId,
  type HealthMeasureId,
  type HealthReasonId,
  type HealthState,
  type HealthSubsystemId,
} from "@/lib/console/health-advisor-texts";

/**
 * Die Regeln der Projekt-Gesundheit (2.44), rein und ohne Ein- und Ausgabe.
 *
 * Eingabe sind die Ergebnisse der Proben als flache Daten: eine Zahl je Mass,
 * oder ein Grund, warum die Probe nicht laufen konnte. Ausgabe ist je Teil ein
 * Zustand, ein Satz dazu und der Beleg. Nichts hier schreibt, nichts
 * repariert, nichts raet: Eine fehlende Probe wird `unknown` mit Grund und
 * nicht stillschweigend `ok`.
 *
 * Gleiche Eingabe gibt gleiche Ausgabe, auch in derselben Reihenfolge: Die
 * Teile kommen immer in der Reihenfolge von `HEALTH_SUBSYSTEM_IDS`, und der
 * Beleg eines Teils steht in der Reihenfolge, in der die Regel ihn bildet.
 *
 * Was diese Seite nicht sagt, steht auch in der Ansicht: Gesund heisst
 * erreichbar und eingerichtet. Ob die Anwendung eines Kunden funktioniert,
 * folgt daraus nicht.
 */

export type HealthEvidence = { measure: HealthMeasureId; label: string; count: number | null };

export type HealthSubsystemReport = {
  id: HealthSubsystemId;
  state: HealthState;
  detail: string;
  evidence: HealthEvidence[];
};

export type HealthAdvisorResult = {
  overall: HealthState;
  counts: Record<HealthState, number>;
  subsystems: HealthSubsystemReport[];
};

type Unavailable = { unavailable: HealthReasonId };

/** Eine Cron-Definition, so weit die Regel sie braucht. Nutzlast und Queue bleiben draussen. */
export type HealthCronDefinition = {
  expression: string;
  /** IANA-Zeitzone des Plans; fehlt sie, UTC. */
  timeZone?: string;
  enabled: boolean;
  createdAt: string;
  lastDispatchedAt: string | null;
};

export type HealthAdvisorInput = {
  now: Date;
  database: Unavailable | { tables: number };
  dataApi: Unavailable | { exposedTables: number };
  auth: Unavailable | { providers: number; signingKeys: number };
  storage: Unavailable | { buckets: number };
  compute: Unavailable | { functions: number; sandboxConfigured: boolean };
  queuesCron: Unavailable | { queues: number; cronDefinitions: number; cronStale: number };
  realtime: Unavailable | { configured: boolean };
  vault: Unavailable | { connected: boolean };
};

/** Welcher Grund welchen Zustand ergibt. Eine Tabelle, damit nichts davon im Code verstreut liegt. */
export const HEALTH_REASON_STATES: Record<HealthReasonId, HealthState> = {
  disabled: "off",
  notReady: "unconfigured",
  notConfigured: "unconfigured",
  unavailable: "degraded",
  forbidden: "unknown",
  consoleOnly: "unknown",
  noProbe: "unknown",
};

/** Die Fehlerklasse als Beleg: je Grund genau ein Mass, ohne Zahl. */
const REASON_MEASURES: Record<HealthReasonId, HealthMeasureId> = {
  disabled: "errorDisabled",
  notReady: "errorNotReady",
  notConfigured: "errorNotConfigured",
  unavailable: "errorUnavailable",
  forbidden: "errorForbidden",
  consoleOnly: "errorConsoleOnly",
  noProbe: "errorNoProbe",
};

function evidence(measure: HealthMeasureId, count: number | null = null): HealthEvidence {
  return { measure, label: HEALTH_MEASURES[measure], count };
}

function report(
  id: HealthSubsystemId,
  state: HealthState,
  detail: HealthDetailId,
  items: HealthEvidence[],
): HealthSubsystemReport {
  return { id, state, detail: HEALTH_DETAILS[detail], evidence: items };
}

function blocked(id: HealthSubsystemId, reason: HealthReasonId): HealthSubsystemReport {
  return report(id, HEALTH_REASON_STATES[reason], reason, [evidence(REASON_MEASURES[reason])]);
}

/**
 * Wie viele aktive Cron-Definitionen noch nie ausgeloest haben, obwohl ihr
 * eigenes Intervall laengst vergangen ist.
 *
 * Gemessen am Ausdruck selbst statt an einer festen Frist: Das erste Vorkommen
 * nach dem Anlegen und das zweite danach spannen genau ein Intervall auf. Ist
 * auch das zweite vorbei und nichts ausgeloest, ist das keine Frage des
 * Zeitpunkts mehr. Ein Ausdruck, den der Parser nicht annimmt, zaehlt nicht
 * mit; dieser Fall ist ein Fehler der Definition und nicht der Gesundheit.
 */
export function countStaleCron(definitions: readonly HealthCronDefinition[], now: Date): number {
  let stale = 0;
  for (const definition of definitions) {
    if (!definition.enabled || definition.lastDispatchedAt !== null) continue;
    const created = new Date(definition.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    try {
      const first = nextCronOccurrence(definition.expression, created, definition.timeZone);
      const second = nextCronOccurrence(definition.expression, first, definition.timeZone);
      if (second.getTime() <= now.getTime()) stale += 1;
    } catch {
      continue;
    }
  }
  return stale;
}

export function evaluateHealthRules(input: HealthAdvisorInput): HealthAdvisorResult {
  const subsystems: HealthSubsystemReport[] = [];

  // Datenbank: der Katalog antwortet, und wie viele Tabellen er nennt.
  subsystems.push("unavailable" in input.database
    ? blocked("database", input.database.unavailable)
    : report("database", "ok", "databaseCatalogRead", [evidence("tables", input.database.tables)]));

  // Data API: freigegeben heisst hier, dass das Dokument Tabellen nennt.
  if ("unavailable" in input.dataApi) {
    subsystems.push(blocked("data_api", input.dataApi.unavailable));
  } else {
    const tables = input.dataApi.exposedTables;
    subsystems.push(report("data_api", tables > 0 ? "ok" : "unconfigured",
      tables > 0 ? "dataApiExposed" : "dataApiNoTables", [evidence("exposedTables", tables)]));
  }

  // Auth: ohne Signaturschluessel kann der Dienst kein Token ausstellen; das
  // ist ein Defekt und keine fehlende Einrichtung.
  if ("unavailable" in input.auth) {
    subsystems.push(blocked("auth", input.auth.unavailable));
  } else {
    const items = [evidence("providers", input.auth.providers), evidence("signingKeys", input.auth.signingKeys)];
    subsystems.push(input.auth.signingKeys === 0
      ? report("auth", "degraded", "authNoSigningKeys", items)
      : input.auth.providers === 0
        ? report("auth", "unconfigured", "authNoProviders", items)
        : report("auth", "ok", "reachable", items));
  }

  // Storage: ein Bucket ist die Einrichtung; ohne ihn laeuft der Dienst leer.
  if ("unavailable" in input.storage) {
    subsystems.push(blocked("storage", input.storage.unavailable));
  } else {
    const items = [evidence("buckets", input.storage.buckets)];
    subsystems.push(input.storage.buckets > 0
      ? report("storage", "ok", "reachable", items)
      : report("storage", "unconfigured", "storageNoBuckets", items));
  }

  // Compute: die Verwaltungsflaeche und die Sandbox sind getrennt
  // freigeschaltet, und getrennt gemeldet.
  if ("unavailable" in input.compute) {
    subsystems.push(blocked("compute", input.compute.unavailable));
  } else {
    const items = [
      evidence("functions", input.compute.functions),
      evidence(input.compute.sandboxConfigured ? "sandboxReady" : "sandboxMissing"),
    ];
    subsystems.push(!input.compute.sandboxConfigured
      ? report("compute", "unconfigured", "computeSandboxOff", items)
      : input.compute.functions === 0
        ? report("compute", "unconfigured", "computeNoFunctions", items)
        : report("compute", "ok", "reachable", items));
  }

  // Queues und Cron: ein Zeitplan, der nie ausgeloest hat, ist der einzige
  // Befund dieser Seite, der auf etwas Laufendes zeigt.
  if ("unavailable" in input.queuesCron) {
    subsystems.push(blocked("queues_cron", input.queuesCron.unavailable));
  } else {
    const source = input.queuesCron;
    const items = [
      evidence("queues", source.queues),
      evidence("cronDefinitions", source.cronDefinitions),
      evidence("cronStale", source.cronStale),
    ];
    subsystems.push(source.cronStale > 0
      ? report("queues_cron", "degraded", "cronNeverDispatched", items)
      : source.queues === 0 && source.cronDefinitions === 0
        ? report("queues_cron", "unconfigured", "queuesCronEmpty", items)
        : report("queues_cron", "ok", "reachable", items));
  }

  // Realtime: nur die Konfiguration. Eine Verbindung baut diese Seite nicht
  // auf — darum `configured` und nicht `ok` (2.57). Bis 2.56 stand hier
  // "erreichbar", obwohl niemand gefragt worden war; 2.44 hat das selbst als
  // offenen Punkt notiert.
  if ("unavailable" in input.realtime) {
    subsystems.push(blocked("realtime", input.realtime.unavailable));
  } else {
    subsystems.push(input.realtime.configured
      ? report("realtime", "configured", "realtimeConfigured", [evidence("transportConfigured")])
      : blocked("realtime", "notConfigured"));
  }

  // Vault: nur ob einer eingerichtet ist. Kein Pfad, kein Secret, keine
  // Anfrage — und darum ebenfalls `configured`.
  if ("unavailable" in input.vault) {
    subsystems.push(blocked("vault", input.vault.unavailable));
  } else {
    subsystems.push(input.vault.connected
      ? report("vault", "configured", "vaultConnected", [evidence("vaultConnected")])
      : blocked("vault", "notConfigured"));
  }

  const order = new Map(HEALTH_SUBSYSTEM_IDS.map((id, index) => [id, index] as const));
  subsystems.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const counts: Record<HealthState, number> = { ok: 0, configured: 0, off: 0, unconfigured: 0, unknown: 0, degraded: 0 };
  let overall: HealthState = "ok";
  for (const subsystem of subsystems) {
    counts[subsystem.state] += 1;
    if (HEALTH_STATE_RANK[subsystem.state] > HEALTH_STATE_RANK[overall]) overall = subsystem.state;
  }
  return { overall, counts, subsystems };
}
