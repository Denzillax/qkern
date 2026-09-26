import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import { isProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import { GeneratedDataApiError, type GeneratedDataApiPort } from "@/lib/server/data-plane/generated-api";
import { getGeneratedDataApi } from "@/lib/server/data-plane/generated-runtime";
import { exposedTablesFromOpenApi } from "@/lib/console/data-api-exposure";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import { ProjectAuthError, type ProjectAuthService } from "@/lib/server/project-auth/service";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";
import { getComputeDefinitionService } from "@/lib/server/compute/definitions-runtime";
import type { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { getProjectQueueService } from "@/lib/server/project-queues/runtime";
import { ProjectQueueError, type ProjectQueueService } from "@/lib/server/project-queues/service";
import { getFunctionSecretInspector } from "@/lib/server/compute/function-secret-inspector";
import type { FunctionSecretInspector } from "@/lib/server/compute/function-secret-inspector";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
  type AuthenticatedRequestContext,
  type RequestCapability,
} from "@/lib/server/request-context";
import { countStaleCron, evaluateHealthRules, type HealthAdvisorInput } from "@/lib/server/advisors/health-rules";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * `GET /advisors/health` — die Projekt-Gesundheit (2.44), nur lesend.
 *
 * Dieselbe Tuer wie `/advisors/security` und `/advisors/performance`:
 * Console-Session mit Leserecht oder scope-gebundener Projekt-Key,
 * `no-store`, keine Query-Parameter. Die acht Proben laufen nebenlaeufig, und
 * jede faengt ihren eigenen Fehlschlag: Ein abgeschalteter, nicht
 * eingerichteter oder nicht erreichbarer Dienst wird zu einem Zustand, nie zu
 * einem 500, und nie zu einem 403 fuer die ganze Seite.
 *
 * Jede Probe ist eine Leseanfrage mit fester Obergrenze und schreibt nichts.
 * Was in die Antwort geht, steht in `lib/console/health-advisor-texts.ts`:
 * ein Textschluessel und hoechstens eine Zahl. Ein Verbindungsstring, ein
 * Token, ein Pfad oder ein Kundenwert hat dort keine Stelle, an der er
 * stehen koennte.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const SCHEMA = "public";

export type HealthAdvisorDependencies = {
  dataPlane?: ProjectDataPlanePort;
  generated?: () => Promise<GeneratedDataApiPort>;
  keys?: ProjectApiKeyService;
  projectAuth?: ProjectAuthService;
  storage?: () => ProjectStorageService;
  compute?: () => ComputeDefinitionService;
  queues?: () => ProjectQueueService;
  vault?: () => FunctionSecretInspector | null;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
};

type Scope = { projectId: string; environment: "development" | "staging" | "production" };
type RouteInput = { params: Promise<{ projectId: string; environment: string }> };

export async function handleHealthAdvisor(request: NextRequest, input: RouteInput, dependencies: HealthAdvisorDependencies = {}) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    if (!environment.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Invalid health advisor request" }, { status: 400 });
    }
    const keys = dependencies.keys ?? projectApiKeyService;
    const scope: Scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, dependencies.projectAuth);
    const dataContext = { organizationId: context.organizationId, actorRef: context.actorRef };
    const session = await consoleSession(request);
    const env = dependencies.env ?? process.env;
    const now = (dependencies.now ?? (() => new Date()))();

    // Nebenlaeufig, weil acht Proben nacheinander die Seite langsam machen
    // wuerden. Jede Probe faengt ihren Fehlschlag selbst; `Promise.all` sieht
    // deshalb nie eine Ablehnung.
    const [database, dataApi, auth, storage, compute, queuesCron, realtime, vault] = await Promise.all([
      probeDatabaseHealth(dependencies.dataPlane, dataContext, scope),
      probeDataApi(dependencies.generated, context, scope),
      probeAuth(session, dependencies.projectAuth),
      probeStorage(session, dependencies.storage ?? getProjectStorageService, scope),
      probeCompute(session, dependencies.compute ?? getComputeDefinitionService, scope, env),
      probeQueuesCron(session, dependencies.queues ?? getProjectQueueService, dependencies.compute ?? getComputeDefinitionService, scope, now),
      Promise.resolve(probeRealtime(env)),
      Promise.resolve(probeVault(dependencies.vault ?? getFunctionSecretInspector)),
    ]);

    const result = evaluateHealthRules({ now, database, dataApi, auth, storage, compute, queuesCron, realtime, vault });
    return NextResponse.json(
      { data: { overall: result.overall, counts: result.counts, subsystems: result.subsystems, checkedAt: now.toISOString() } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return withNoStore(dataPlaneRouteError(error));
  }
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Die Console-Sitzung, falls der Aufruf eine traegt; ein Projekt-Key hat keine. */
async function consoleSession(request: NextRequest): Promise<AuthenticatedRequestContext | null> {
  try {
    return await authenticatedContext(request);
  } catch (error) {
    if (error instanceof RequestAuthenticationError || error instanceof RequestAuthorizationError) return null;
    throw error;
  }
}

/** Console-Sitzung mit der verlangten Faehigkeit, oder der Grund, warum die Probe nicht laufen kann. */
function admin(session: AuthenticatedRequestContext | null, capability: RequestCapability):
{ unavailable: "consoleOnly" | "forbidden" } | { principal: { organizationId: string; actorRef: string; role: "admin"; subject: string } } {
  if (!session) return { unavailable: "consoleOnly" };
  try { requireCapability(session, capability); } catch { return { unavailable: "forbidden" }; }
  const organizationId = session.membership.organization.id;
  return { principal: { organizationId, actorRef: session.user.email, role: "admin", subject: session.user.id } };
}

/**
 * Exportiert, weil der Zertifizierungsfall (2.44) genau diese Einordnung
 * gegen eine echte Datenbank fahren soll und nicht eine nachgebaute.
 */
export async function probeDatabaseHealth(
  port: ProjectDataPlanePort | undefined,
  context: { organizationId: string; actorRef: string },
  scope: Scope,
  schemaName: string = SCHEMA,
): Promise<HealthAdvisorInput["database"]> {
  try {
    const service = port ?? await getProjectDataPlane();
    const schema = await service.inspectSchema(context, scope, schemaName);
    return { tables: schema.tables.length };
  } catch (error) {
    if (isProjectDataPlaneError(error, "DATA_PLANE_DISABLED")) return { unavailable: "disabled" };
    if (isProjectDataPlaneError(error, "DATA_PLANE_NOT_READY")) return { unavailable: "notReady" };
    if (isProjectDataPlaneError(error) || isConnectionUnavailable(error)) return { unavailable: "unavailable" };
    return unexpected("database", error);
  }
}

async function probeDataApi(
  factory: (() => Promise<GeneratedDataApiPort>) | undefined,
  context: Awaited<ReturnType<typeof generatedDataContext>>,
  scope: Scope,
): Promise<HealthAdvisorInput["dataApi"]> {
  try {
    const service = await (factory ?? getGeneratedDataApi)();
    const document = await service.generateOpenApi(context, scope, SCHEMA);
    const paths = document.paths;
    if (paths === null || typeof paths !== "object" || Array.isArray(paths)) return { unavailable: "unavailable" };
    return { exposedTables: exposedTablesFromOpenApi(paths as Record<string, unknown>).length };
  } catch (error) {
    if (error instanceof GeneratedDataApiError) {
      if (error.code === "GENERATED_DATA_API_DISABLED") return { unavailable: "disabled" };
      if (error.code === "GENERATED_DATA_API_NOT_READY") return { unavailable: "notReady" };
      return { unavailable: "unavailable" };
    }
    if (isProjectDataPlaneError(error) || isConnectionUnavailable(error)) return { unavailable: "unavailable" };
    return unexpected("data-api", error);
  }
}

async function probeAuth(
  session: AuthenticatedRequestContext | null,
  injected: ProjectAuthService | undefined,
): Promise<HealthAdvisorInput["auth"]> {
  const allowed = admin(session, "project_auth_admin");
  if ("unavailable" in allowed) return allowed;
  try {
    const service = injected ?? getProjectAuthService();
    return { providers: service.listOidcProviders().length, signingKeys: service.jwks().keys.length };
  } catch (error) {
    if (error instanceof ProjectAuthError && error.code === "PROJECT_AUTH_DISABLED") return { unavailable: "disabled" };
    if (isConnectionUnavailable(error)) return { unavailable: "unavailable" };
    return unexpected("auth", error);
  }
}

async function probeStorage(
  session: AuthenticatedRequestContext | null,
  factory: () => ProjectStorageService,
  scope: Scope,
): Promise<HealthAdvisorInput["storage"]> {
  const allowed = admin(session, "project_storage_admin");
  if ("unavailable" in allowed) return allowed;
  try {
    const buckets = await factory().listBuckets(allowed.principal, { organizationId: allowed.principal.organizationId, ...scope });
    return { buckets: buckets.length };
  } catch (error) {
    if (error instanceof ProjectStorageError && error.code === "PROJECT_STORAGE_DISABLED") return { unavailable: "disabled" };
    if (error instanceof ProjectStorageError || isConnectionUnavailable(error)) return { unavailable: "unavailable" };
    return unexpected("storage", error);
  }
}

async function probeCompute(
  session: AuthenticatedRequestContext | null,
  factory: () => ComputeDefinitionService,
  scope: Scope,
  env: Readonly<Record<string, string | undefined>>,
): Promise<HealthAdvisorInput["compute"]> {
  const allowed = admin(session, "project_compute_admin");
  if ("unavailable" in allowed) return allowed;
  const sandboxConfigured = env.QKERN_FUNCTIONS_ENABLED === "true";
  try {
    const functions = await factory().listFunctions(allowed.principal, { organizationId: allowed.principal.organizationId, ...scope });
    return { functions: functions.length, sandboxConfigured };
  } catch (error) {
    return { unavailable: computeReason(error, "compute") };
  }
}

async function probeQueuesCron(
  session: AuthenticatedRequestContext | null,
  queueFactory: () => ProjectQueueService,
  computeFactory: () => ComputeDefinitionService,
  scope: Scope,
  now: Date,
): Promise<HealthAdvisorInput["queuesCron"]> {
  const allowed = admin(session, "project_queues_admin");
  if ("unavailable" in allowed) return allowed;
  const inner = { organizationId: allowed.principal.organizationId, ...scope };
  try {
    const [queues, cron] = await Promise.all([
      queueFactory().listQueues(allowed.principal, inner),
      computeFactory().listCron(allowed.principal, inner),
    ]);
    return { queues: queues.length, cronDefinitions: cron.length, cronStale: countStaleCron(cron, now) };
  } catch (error) {
    if (error instanceof ProjectQueueError) {
      return { unavailable: error.code === "PROJECT_QUEUES_DISABLED" ? "disabled" : "unavailable" };
    }
    return { unavailable: computeReason(error, "queues-cron") };
  }
}

/**
 * Realtime hat keine Leseroute, an der sich etwas pruefen liesse. Geprueft
 * wird darum nur, ob die Console ueberhaupt eine Adresse kennt — mehr waere
 * geraten, und die Adresse selbst geht nicht in die Antwort.
 */
function probeRealtime(env: Readonly<Record<string, string | undefined>>): HealthAdvisorInput["realtime"] {
  return { configured: Boolean(env.NEXT_PUBLIC_QKERN_REALTIME_URL?.trim()) };
}

/** Nur die Existenz. Der Inspektor aus 2.38 wird gebaut, aber nichts wird angefragt. */
function probeVault(factory: () => FunctionSecretInspector | null): HealthAdvisorInput["vault"] {
  try {
    return { connected: factory() !== null };
  } catch {
    // Eine halbe Vault-Konfiguration ist ein Fehler der Einrichtung, kein
    // Ausfall: Der Inspektor lehnt sie beim Bauen ab.
    return { unavailable: "unavailable" };
  }
}

/**
 * Ein abgeschalteter Dienst wirft beim Bauen eine `ConfigurationError`, und
 * die traegt keinen Code. Unterschieden wird darum an der Klasse: Was die
 * Datenbank nicht erreichbar macht, ist `unavailable`, alles andere aus dem
 * Aufbau ist `disabled`.
 */
function computeReason(error: unknown, probe: string): "disabled" | "unavailable" {
  if (isConnectionUnavailable(error)) return "unavailable";
  if (error instanceof Error && error.name === "ConfigurationError") return "disabled";
  if (error instanceof Error && (error.name === "ComputeDefinitionError" || error.name === "ProjectQueueError")) return "unavailable";
  console.error(`[advisors] ${probe} probe failed`, error);
  return "unavailable";
}

/** Ein unerwarteter Fehler bleibt ein Zustand, aber er steht im Log. */
function unexpected(probe: string, error: unknown): { unavailable: "unavailable" } {
  console.error(`[advisors] ${probe} probe failed`, error);
  return { unavailable: "unavailable" };
}

export function GET(request: NextRequest, input: RouteInput) {
  return handleHealthAdvisor(request, input);
}
