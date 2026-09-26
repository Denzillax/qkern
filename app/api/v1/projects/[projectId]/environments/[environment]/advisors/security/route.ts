import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import { isProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import { ProjectStorageError, type ProjectStorageService } from "@/lib/server/project-storage/service";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
  type AuthenticatedRequestContext,
} from "@/lib/server/request-context";
import { evaluateSecurityRules, type SecurityAdvisorInput } from "@/lib/server/advisors/security-rules";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * `GET /advisors/security` — der Sicherheitsberater (2.39), nur lesend.
 *
 * Dieselbe Tuer wie `/schema/policies`: Console-Session mit Leserecht oder
 * scope-gebundener Projekt-Key, `no-store`, keine Query-Parameter. Gelesen
 * wird das Schema `public` ueber die vorhandenen Katalogabfragen; Buckets und
 * API-Keys nur mit Console-Sitzung und der Faehigkeit, die ihre eigenen
 * Routen verlangen. Fehlt eine Quelle, laeuft ihre Regel nicht, und die
 * Antwort sagt das. Ein abgeschalteter Dienst ist kein 500.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const SCHEMA = "public";

export type SecurityAdvisorDependencies = {
  dataPlane?: ProjectDataPlanePort;
  keys?: ProjectApiKeyService;
  projectAuth?: ProjectAuthService;
  storage?: () => ProjectStorageService;
  now?: () => Date;
};

type RouteInput = { params: Promise<{ projectId: string; environment: string }> };

export async function handleSecurityAdvisor(request: NextRequest, input: RouteInput, dependencies: SecurityAdvisorDependencies = {}) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    if (!environment.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Invalid security advisor request" }, { status: 400 });
    }
    const keys = dependencies.keys ?? projectApiKeyService;
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, dependencies.projectAuth);
    const dataContext = { organizationId: context.organizationId, actorRef: context.actorRef };

    const database = await readDatabase(dependencies.dataPlane, dataContext, scope);
    const session = await consoleSession(request);
    const storage = await readStorage(session, dependencies.storage ?? getProjectStorageService, scope);
    const apiKeys = await readApiKeys(session, keys, scope);
    const now = (dependencies.now ?? (() => new Date()))();

    const result = evaluateSecurityRules({ environment: scope.environment, now, database, storage, apiKeys });
    return NextResponse.json(
      { data: { findings: result.findings, checks: result.checks, checkedAt: now.toISOString() } },
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

async function readDatabase(
  port: ProjectDataPlanePort | undefined,
  context: { organizationId: string; actorRef: string },
  scope: { projectId: string; environment: "development" | "staging" | "production" },
): Promise<SecurityAdvisorInput["database"]> {
  try {
    const service = port ?? await getProjectDataPlane();
    const [schema, policies] = await Promise.all([
      service.inspectSchema(context, scope, SCHEMA),
      service.inspectPolicies(context, scope, SCHEMA),
    ]);
    return {
      schema: SCHEMA,
      tables: schema.tables.map((table) => ({ name: table.name, kind: table.kind, rowSecurityEnabled: table.rowSecurityEnabled })),
      tablesTruncated: schema.truncated,
      policies: policies.policies,
      policiesTruncated: policies.truncated,
    };
  } catch (error) {
    if (isProjectDataPlaneError(error, "DATA_PLANE_DISABLED")) return { unavailable: "databaseDisabled" };
    if (isProjectDataPlaneError(error, "DATA_PLANE_NOT_READY")) return { unavailable: "databaseNotReady" };
    if (isProjectDataPlaneError(error) || isConnectionUnavailable(error)) return { unavailable: "databaseUnavailable" };
    throw error;
  }
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

async function readStorage(
  session: AuthenticatedRequestContext | null,
  service: () => ProjectStorageService,
  scope: { projectId: string; environment: "development" | "staging" | "production" },
): Promise<SecurityAdvisorInput["storage"]> {
  if (!session) return { unavailable: "consoleOnly" };
  try { requireCapability(session, "project_storage_admin"); } catch { return { unavailable: "storageForbidden" }; }
  const organizationId = session.membership.organization.id;
  try {
    const buckets = await service().listBuckets(
      { organizationId, actorRef: session.user.email, role: "admin", subject: session.user.id },
      { organizationId, ...scope },
    );
    return { buckets: buckets.map((bucket) => ({
      name: bucket.name, readPolicy: bucket.readPolicy, writePolicy: bucket.writePolicy, allowedMimeTypes: bucket.allowedMimeTypes,
    })) };
  } catch (error) {
    if (error instanceof ProjectStorageError && error.code === "PROJECT_STORAGE_DISABLED") return { unavailable: "storageDisabled" };
    if (!(error instanceof ProjectStorageError) && !isConnectionUnavailable(error)) {
      console.error("[advisors] storage unavailable", error);
    }
    return { unavailable: "storageUnavailable" };
  }
}

async function readApiKeys(
  session: AuthenticatedRequestContext | null,
  keys: ProjectApiKeyService,
  scope: { projectId: string; environment: "development" | "staging" | "production" },
): Promise<SecurityAdvisorInput["apiKeys"]> {
  if (!session) return { unavailable: "consoleOnly" };
  try { requireCapability(session, "project_api_keys"); } catch { return { unavailable: "keysForbidden" }; }
  try {
    const list = await keys.list({
      organizationId: session.membership.organization.id,
      actor: { id: session.user.id, ref: session.user.email },
    }, scope.projectId, scope.environment);
    return { keys: list.map((key) => ({ id: key.id, name: key.name, kind: key.kind, expiresAt: key.expiresAt, revokedAt: key.revokedAt })) };
  } catch (error) {
    if (!isConnectionUnavailable(error)) console.error("[advisors] api keys unavailable", error);
    return { unavailable: "keysUnavailable" };
  }
}

export function GET(request: NextRequest, input: RouteInput) {
  return handleSecurityAdvisor(request, input);
}
