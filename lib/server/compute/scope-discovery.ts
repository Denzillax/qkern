import { ConfigurationError } from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { Environment } from "@/lib/types";

/**
 * Woher der Compute-Prozess seine Bereiche nimmt (2.107).
 *
 * ## Was vorher war
 *
 * `QKERN_COMPUTE_SCOPES_JSON` und sonst nichts. Ein neu angelegtes Projekt
 * wurde erst bedient, wenn jemand die Variable nachzog und den Prozess neu
 * startete, und solange das nicht geschah, sah ein untaetiger Prozess genauso
 * aus wie ein vollstaendiger: Cron lief nicht, Zustellungen blieben liegen,
 * Drains sammelten nicht, und nichts sagte es.
 *
 * ## Die Rollengrenze, und was sie zulaesst
 *
 * `project_environments` steht der Laufzeitrolle offen: `0002` erteilt
 * `qkern_runtime` SELECT, und die Policy `project_environments_select`
 * begrenzt die Sicht auf `qkern_current_organization_id()`. Eine Entdeckung
 * **innerhalb einer Organisation** braucht damit kein einziges zusaetzliches
 * Recht; sie liest dieselbe Tabelle, auf die die Console schon schaut.
 *
 * Was sie nicht kann, ist die Suche ueber alle Organisationen, und die Grenze
 * liegt genau an einer Stelle: bei der **Aufzaehlung**. Der Fall "(2.107)" hat
 * das gegen die echte Datenbank nachgemessen, und das Ergebnis war ein anderes
 * als die Annahme, mit der er geschrieben wurde:
 *
 * * `qkern_current_organization_id()` liest
 *   `current_setting('qkern.organization_id')`, und diese Variable setzt der
 *   Prozess selbst. Wer die Id einer Organisation nennt, liest deren Zeilen.
 *   RLS trennt hier keine Rollen, sondern begrenzt eine Sitzung auf die
 *   Organisation, die sie angibt.
 * * `organizations_select` haengt an derselben Variablen. In einer Sitzung
 *   sieht diese Rolle deshalb genau eine Organisation: die genannte. Es gibt
 *   keine Abfrage, mit der dieser Prozess erfaehrt, welche Organisationen
 *   ueberhaupt existieren.
 *
 * Damit ist eine organisationsuebergreifende Entdeckung nicht moeglich, und sie
 * waere es erst mit einer Rolle, die RLS umgeht, oder mit einem Leserecht auf
 * `organizations` ohne diese Policy. Dieser Schnitt legt beides nicht an.
 * Derselbe Satz steht seit `2.68.0` am Katalog der Projektdatenbanken
 * (`connection-catalog-runtime.ts`: die Bindungen der Control Plane gehoeren
 * der Worker-Rolle) und am Aufraeumer der Realtime-Runtime
 * (`workers/realtime-runtime.mts`: RLS gibt keine organisationsuebergreifende
 * Suche her). Der Schnitt nennt die Grenze und bleibt darunter:
 *
 * * Eine Organisation je Prozess, genannt in `QKERN_COMPUTE_ORGANIZATION_ID`.
 * * Wer mehrere Organisationen in einem Prozess bedienen will, traegt die
 *   Liste weiter von Hand ein. Das ist die ausdrueckliche Ueberschreibung, und
 *   sie bleibt der einzige Weg dorthin.
 *
 * ## Die Meldung, damit niemand es mehr uebersieht
 *
 * Die Entdeckung findet beim Start statt. Eine Umgebung, die spaeter entsteht,
 * bekommt keine Schleife, denn jede Schleife dieses Prozesses haengt an einem
 * Bereich, der beim Start gebaut wird. Genau deshalb gibt es die Zaehlung:
 * `ComputeScopeCensusRuntime` sieht im Takt nach, wie viele Umgebungen der
 * Organisation dieser Prozess **nicht** bedient, und meldet die Zahl. Damit ist
 * das Vergessen nicht mehr still -- der Betrieb sieht eine Zeile, statt eine
 * Woche spaeter ein Projekt ohne Cron zu finden.
 *
 * Gemeldet werden zwei Zahlen und keine Kennung: `unserved` sind Umgebungen der
 * Control Plane ohne Bereich in diesem Prozess, `stale` sind Bereiche dieses
 * Prozesses ohne Umgebung in der Control Plane. Ein Projekt-Name, eine Id oder
 * eine Umgebungsbezeichnung gehoert nicht in dieses Log, aus demselben Grund
 * wie bei jeder anderen Meldung dieses Prozesses.
 */

export type ComputeScopeConfig = Readonly<{
  organizationId: string;
  projectId: string;
  environment: Environment;
}>;

/**
 * Wie viele Bereiche ein Prozess hoechstens bedient.
 *
 * Die Zahl stand seit Release 1.19 an der festen Liste und gilt fuer die
 * Entdeckung genauso: Sie begrenzt, wie viele Schleifen dieser Prozess
 * gleichzeitig unterhaelt, und daran aendert die Herkunft der Liste nichts.
 */
export const MAX_COMPUTE_SCOPES = 32;

const ENVIRONMENTS = new Set<Environment>(["development", "staging", "production"]);

/**
 * Welche Projekte dieser Prozess bedient, ausdruecklich genannt.
 *
 * **Die Ueberschreibung.** Seit 2.107 kann der Prozess seine Bereiche selbst
 * finden (`resolveComputeScopes`), und diese Liste ist der Weg daran vorbei:
 * fuer einen Prozess, der mehrere Organisationen bedienen soll, und fuer einen,
 * der eine Organisation aufteilt. Die Entdeckung kann beides nicht, weil die
 * Laufzeitrolle durch RLS nur eine Organisation sieht.
 */
export function computeScopesFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ComputeScopeConfig[] {
  const raw = env.QKERN_COMPUTE_SCOPES_JSON?.trim();
  if (!raw) throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_COMPUTE_SCOPES) {
    throw new ConfigurationError(
      `QKERN_COMPUTE_SCOPES_JSON must list 1 to ${MAX_COMPUTE_SCOPES} scopes.`);
  }

  const seen = new Set<string>();
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON contains an invalid scope.");
    }
    const { organizationId, projectId, environment } = entry as Record<string, unknown>;
    if (typeof organizationId !== "string" || !UUID.test(organizationId) ||
        typeof projectId !== "string" || !UUID.test(projectId) ||
        typeof environment !== "string" || !ENVIRONMENTS.has(environment as Environment)) {
      throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON contains an invalid scope.");
    }
    const scopeKey = `${organizationId}:${projectId}:${environment}`;
    if (seen.has(scopeKey)) {
      throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON contains a duplicate scope.");
    }
    seen.add(scopeKey);
    return Object.freeze({
      organizationId, projectId, environment: environment as Environment,
    });
  });
}

export type ComputeScopeSource = "static-env" | "control-plane";

/** Die Umgebungen einer Organisation, wie die Control Plane sie fuehrt. */
export interface ComputeScopeCatalog {
  environments(organizationId: string): Promise<readonly ComputeScopeConfig[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Welche Quelle die Umgebung nennt.
 *
 * Ohne Angabe bleibt es bei `static-env`, also bei dem Verhalten, das jeder
 * bestehende Betrieb heute hat. Eine Entdeckung, die sich von selbst
 * einschaltet, waere eine Verhaltensaenderung ohne Entscheidung.
 */
export function computeScopeSourceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ComputeScopeSource {
  const raw = env.QKERN_COMPUTE_SCOPE_SOURCE?.trim();
  if (raw === undefined || raw === "" || raw === "static-env") return "static-env";
  if (raw === "control-plane") return "control-plane";
  throw new ConfigurationError(
    "QKERN_COMPUTE_SCOPE_SOURCE must be static-env or control-plane.");
}

/**
 * Die eine Organisation dieses Prozesses, oder `undefined`.
 *
 * Sie ist fuer die Entdeckung Pflicht und sonst freiwillig. Freiwillig, weil
 * sie auch am festen Weg etwas wert ist: Mit ihr zaehlt der Prozess seine
 * Bereiche gegen die Control Plane und merkt eine vergessene Umgebung, auch
 * wenn die Liste von Hand kommt.
 */
export function computeScopeOrganizationFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const raw = env.QKERN_COMPUTE_ORGANIZATION_ID?.trim();
  if (raw === undefined || raw === "") return undefined;
  if (!UUID.test(raw)) {
    throw new ConfigurationError("QKERN_COMPUTE_ORGANIZATION_ID must be a UUID.");
  }
  return raw;
}

export type ResolvedComputeScopes = Readonly<{
  source: ComputeScopeSource;
  scopes: readonly ComputeScopeConfig[];
  /** Umgebungen der Organisation, die dieser Prozess nicht bedient. */
  unserved: number;
  /** Bereiche dieses Prozesses, zu denen die Control Plane keine Umgebung fuehrt. */
  stale: number;
}>;

/**
 * Was dieser Prozess bedienen wird, und was daneben liegen bleibt.
 *
 * Der feste Weg bleibt unveraendert: `computeScopesFromEnv` entscheidet, und
 * die Zaehlung kommt nur dazu, wenn die Organisation genannt ist.
 *
 * Der entdeckte Weg verlangt die Organisation und **verbietet** die Liste.
 * Beides zusammen waeren zwei Wahrheiten ueber denselben Prozess, und die
 * stille Variante davon -- eine Liste, die neben einer Entdeckung wirkungslos
 * dasteht -- ist genau der Zustand, den dieser Schnitt beseitigt. Dasselbe
 * Argument steht seit `2.68.0` am Katalog der Projektdatenbanken.
 */
export async function resolveComputeScopes(options: {
  source: ComputeScopeSource;
  organizationId?: string;
  /** Die Liste des festen Weges, schon geprueft. */
  configured?: readonly ComputeScopeConfig[];
  catalog?: ComputeScopeCatalog;
}): Promise<ResolvedComputeScopes> {
  if (options.source === "static-env") {
    const scopes = options.configured ?? [];
    if (scopes.length === 0) {
      throw new ConfigurationError("QKERN_COMPUTE_SCOPES_JSON is required.");
    }
    if (!options.organizationId || !options.catalog) {
      return frozen("static-env", scopes, 0, 0);
    }
    const known = await options.catalog.environments(options.organizationId);
    const counted = countAgainst(scopes, known, options.organizationId);
    return frozen("static-env", scopes, counted.unserved, counted.stale);
  }

  if (!options.organizationId) {
    throw new ConfigurationError(
      "Scope discovery needs QKERN_COMPUTE_ORGANIZATION_ID, because the runtime role sees only "
      + "one organization.");
  }
  if (options.configured && options.configured.length > 0) {
    throw new ConfigurationError(
      "QKERN_COMPUTE_SCOPES_JSON cannot be mixed with control-plane scope discovery.");
  }
  if (!options.catalog) {
    throw new ConfigurationError("Scope discovery needs a control-plane scope catalog.");
  }
  const discovered = await options.catalog.environments(options.organizationId);
  if (discovered.length === 0) {
    // Ein Prozess ohne Bereich laeuft und tut nichts. Bis 2.106 war das ein
    // moeglicher Zustand, und von aussen sah er aus wie Betrieb.
    throw new ConfigurationError(
      "Scope discovery found no environment for this organization.");
  }
  if (discovered.length > MAX_COMPUTE_SCOPES) {
    // Die ersten 32 zu nehmen waere die Wiederholung des Fehlers: Der Prozess
    // bediente einen Teil und saehe von aussen vollstaendig aus. Wer mehr
    // Umgebungen hat, teilt sie auf -- mit der ausdruecklichen Liste.
    throw new ConfigurationError(
      `Scope discovery found more than ${MAX_COMPUTE_SCOPES} environments; `
      + "split them across processes with QKERN_COMPUTE_SCOPES_JSON.");
  }
  return frozen("control-plane", discovered, 0, 0);
}

function frozen(
  source: ComputeScopeSource,
  scopes: readonly ComputeScopeConfig[],
  unserved: number,
  stale: number,
): ResolvedComputeScopes {
  return Object.freeze({ source, scopes: Object.freeze([...scopes]), unserved, stale });
}

function key(scope: ComputeScopeConfig): string {
  return `${scope.organizationId}:${scope.projectId}:${scope.environment}`;
}

/**
 * Zaehlt in beide Richtungen.
 *
 * Bereiche fremder Organisationen bleiben aus beiden Zahlen heraus: Diese
 * Sicht kennt sie nicht, und sie als veraltet zu zaehlen waere eine Aussage
 * ueber etwas, das der Prozess nicht sehen darf.
 */
export function countAgainst(
  served: readonly ComputeScopeConfig[],
  known: readonly ComputeScopeConfig[],
  organizationId: string,
): Readonly<{ unserved: number; stale: number }> {
  const servedKeys = new Set(served.map(key));
  const knownKeys = new Set(known.map(key));
  let unserved = 0;
  for (const candidate of knownKeys) if (!servedKeys.has(candidate)) unserved += 1;
  let stale = 0;
  for (const scope of served) {
    if (scope.organizationId !== organizationId) continue;
    if (!knownKeys.has(key(scope))) stale += 1;
  }
  return Object.freeze({ unserved, stale });
}

/**
 * Liest die Umgebungen einer Organisation aus der Control Plane.
 *
 * Der Join auf `projects` ist die Aussage, nicht die Verzierung: Ein geloeschtes
 * Projekt behaelt seine Zeilen in `project_environments` (0001 loescht nur
 * ueber die Kaskade der Organisation), und ein Prozess, der dafuer Schleifen
 * baute, arbeitete an einem Projekt, das es nicht mehr gibt. `status` bleibt
 * dagegen aussen vor: Eine Umgebung in `provisioning` bekommt ihre Schleifen
 * gern schon, denn die Arbeit dieses Prozesses entsteht erst mit einer
 * Definition, und eine Schleife ohne Definition kostet eine Abfrage.
 */
export class PostgresComputeScopeCatalog implements ComputeScopeCatalog {
  constructor(
    private readonly database: Pick<PostgresControlPlane, "withTenant">,
    private readonly actorRef = "service-role:compute-scopes",
  ) {}

  async environments(organizationId: string): Promise<readonly ComputeScopeConfig[]> {
    return await this.database.withTenant({
      organizationId, actorRef: this.actorRef, readOnly: true,
    }, async (repositories) => {
      const result = await repositories.transaction.query<{
        project_id: string; environment: Environment;
      }>(
        `SELECT e.project_id, e.environment
           FROM project_environments e
           JOIN projects p
             ON p.organization_id = e.organization_id AND p.id = e.project_id
          WHERE e.organization_id = $1 AND p.deleted_at IS NULL
          ORDER BY e.created_at ASC, e.project_id ASC, e.environment ASC`,
        [organizationId],
      );
      return Object.freeze(result.rows.map((row) => Object.freeze({
        organizationId, projectId: row.project_id, environment: row.environment,
      })));
    });
  }
}

export type ComputeScopeCensusOptions = {
  catalog: ComputeScopeCatalog;
  organizationId: string;
  /** Die Bereiche, die dieser Prozess wirklich bedient. */
  scopes: readonly ComputeScopeConfig[];
  intervalMs?: number;
  /**
   * Nimmt die beiden Zahlen entgegen. Wird nur gerufen, wenn mindestens eine
   * von null verschieden ist: Eine Runde ohne Abweichung zu melden hiesse, den
   * Takt zu protokollieren statt die Lage.
   */
  onCensus?: (counted: Readonly<{ unserved: number; stale: number }>) => void;
  /** Nimmt einen Fehlschlag entgegen, ohne Datenbankmeldung. */
  onFailure?: () => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Sieht im Takt nach, ob dieser Prozess noch alle Umgebungen bedient.
 *
 * Sie zaehlt und greift nicht ein. Eine Schleife, die sich zur Laufzeit einen
 * Bereich hinzunimmt, muesste Cron, Zustellung, Bruecke und drei Sammler
 * darunter neu aufbauen; das waere ein eigener Schnitt. Dieser hier macht das
 * Fehlende sichtbar, und ein Neustart bedient es dann.
 */
export class ComputeScopeCensusRuntime {
  private readonly intervalMs: number;
  private stopped = false;
  private wake: (() => void) | undefined;

  constructor(private readonly options: ComputeScopeCensusOptions) {
    const interval = options.intervalMs ?? 300_000;
    if (!Number.isSafeInteger(interval) || interval < 1_000 || interval > 86_400_000) {
      throw new ConfigurationError(
        "The compute scope census interval must be between 1000 and 86400000 ms.");
    }
    this.intervalMs = interval;
  }

  /** Eine Runde. Gibt zurueck, was gezaehlt wurde. */
  async count(): Promise<Readonly<{ unserved: number; stale: number }>> {
    const known = await this.options.catalog.environments(this.options.organizationId);
    return countAgainst(this.options.scopes, known, this.options.organizationId);
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const counted = await this.count();
        if (counted.unserved > 0 || counted.stale > 0) this.options.onCensus?.(counted);
      } catch {
        // Die Zaehlung ist Beobachtung. Ein Fehlschlag darf den Prozess nicht
        // beenden, und die Meldung der Datenbank gehoert nicht in sein Log.
        this.options.onFailure?.();
      }
      if (this.stopped) return;
      await this.pause();
    }
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  private async pause(): Promise<void> {
    if (this.options.sleep) {
      await this.options.sleep(this.intervalMs);
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, this.intervalMs);
      const self = this;
      function finish() {
        clearTimeout(timer);
        self.wake = undefined;
        resolve();
      }
      this.wake = finish;
    });
  }
}
