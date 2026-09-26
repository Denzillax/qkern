import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import { isProjectDataPlaneError, type ProjectDataPlanePort } from "@/lib/server/data-plane/service";
import { generatedDataContext } from "@/lib/server/data-plane/generated-http";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { evaluatePerformanceRules, type PerformanceAdvisorInput } from "@/lib/server/advisors/performance-rules";
import { dataPlaneRouteError } from "@/app/api/v1/projects/[projectId]/environments/[environment]/schema/route";

/**
 * `GET /advisors/performance` — der Leistungsberater (2.40), nur lesend.
 *
 * Dieselbe Tuer wie `/advisors/security` und `/schema/policies`:
 * Console-Session mit Leserecht oder scope-gebundener Projekt-Key, `no-store`,
 * keine Query-Parameter. Gelesen wird die Statistik des Schemas `public` ueber
 * eine Katalogabfrage in derselben READ-ONLY-Transaktion wie jeder andere
 * Inspektor. Fehlt die Quelle, laeuft ihre Regel nicht, und die Antwort sagt
 * das. Ein abgeschalteter Dienst ist kein 500.
 *
 * `pg_stat_statements` liest diese Route seit 2.57 — aber nur den sicheren
 * Teilausschnitt. 2.40 hat die Sicht ganz liegen gelassen, weil sie fuer
 * den ganzen Cluster gilt und der Text eines Utility-Befehls seine Literale
 * behaelt (normalisiert wird nur eine Abfrage). Beide Gruende treffen die
 * Spalte `query` und die Zeilen fremder Datenbanken, nicht die Zaehler:
 * `inspectStatements` grenzt auf `dbid` der eigenen Datenbank ein und
 * waehlt `query` nicht aus. Uebrig bleiben normalisierte Kennung, Aufrufe
 * und Gesamtzeit — und `PerformanceAdvisorStatement` hat kein Feld mehr,
 * in das ein Text passen wuerde. Fehlt die Erweiterung, laeuft die Regel
 * nicht, und die Antwort sagt genau das.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const SCHEMA = "public";

export type PerformanceAdvisorDependencies = {
  dataPlane?: ProjectDataPlanePort;
  keys?: ProjectApiKeyService;
  projectAuth?: ProjectAuthService;
  now?: () => Date;
};

type RouteInput = { params: Promise<{ projectId: string; environment: string }> };

export async function handlePerformanceAdvisor(request: NextRequest, input: RouteInput, dependencies: PerformanceAdvisorDependencies = {}) {
  try {
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    if (!environment.success || !params.projectId || params.projectId.length > 128 ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Invalid performance advisor request" }, { status: 400 });
    }
    const keys = dependencies.keys ?? projectApiKeyService;
    const scope = { projectId: params.projectId, environment: environment.data };
    const context = await generatedDataContext(request, scope, false, keys, dependencies.projectAuth);
    const dataContext = { organizationId: context.organizationId, actorRef: context.actorRef };

    const [statistics, statements] = await Promise.all([
      readStatistics(dependencies.dataPlane, dataContext, scope),
      readStatements(dependencies.dataPlane, dataContext, scope),
    ]);
    const now = (dependencies.now ?? (() => new Date()))();

    const result = evaluatePerformanceRules({ statistics, statements });
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

async function readStatistics(
  port: ProjectDataPlanePort | undefined,
  context: { organizationId: string; actorRef: string },
  scope: { projectId: string; environment: "development" | "staging" | "production" },
): Promise<PerformanceAdvisorInput["statistics"]> {
  try {
    const service = port ?? await getProjectDataPlane();
    const statistics = await service.inspectStatistics(context, scope, SCHEMA);
    return {
      schema: SCHEMA,
      tables: statistics.tables.map((table) => ({
        name: table.table, seqScan: table.seqScan, seqTupRead: table.seqTupRead, idxScan: table.idxScan,
        liveTuples: table.liveTuples, deadTuples: table.deadTuples,
        lastAutovacuum: table.lastAutovacuum, lastAnalyze: table.lastAnalyze,
      })),
      indexes: statistics.indexes.map((index) => ({
        name: index.name, table: index.table, scans: index.scans, sizeBytes: index.sizeBytes,
        isUnique: index.isUnique, isPrimary: index.isPrimary,
      })),
      truncated: statistics.truncated,
    };
  } catch (error) {
    if (isProjectDataPlaneError(error, "DATA_PLANE_DISABLED")) return { unavailable: "databaseDisabled" };
    if (isProjectDataPlaneError(error, "DATA_PLANE_NOT_READY")) return { unavailable: "databaseNotReady" };
    if (isProjectDataPlaneError(error) || isConnectionUnavailable(error)) return { unavailable: "databaseUnavailable" };
    throw error;
  }
}

/**
 * Die Statement-Kennungen der eigenen Datenbank (2.57).
 *
 * Was hier ankommt, hat die Grenze der Data Plane schon passiert: eine
 * Kennung aus Ziffern und zwei Zaehler. Diese Funktion reicht genau das
 * weiter und legt nichts dazu. Fehlt die Erweiterung, wird daraus kein
 * Fehler, sondern der Grund, den die Karte zeigt.
 */
async function readStatements(
  port: ProjectDataPlanePort | undefined,
  context: { organizationId: string; actorRef: string },
  scope: { projectId: string; environment: "development" | "staging" | "production" },
): Promise<PerformanceAdvisorInput["statements"]> {
  try {
    const service = port ?? await getProjectDataPlane();
    const result = await service.inspectStatements(context, scope);
    if (!result.installed) return { unavailable: "statementsUnavailable" };
    return { entries: result.statements.map((entry) => ({
      id: entry.id, calls: entry.calls, totalTimeMs: entry.totalTimeMs,
    })) };
  } catch (error) {
    if (isProjectDataPlaneError(error, "DATA_PLANE_DISABLED")) return { unavailable: "databaseDisabled" };
    if (isProjectDataPlaneError(error, "DATA_PLANE_NOT_READY")) return { unavailable: "databaseNotReady" };
    if (isProjectDataPlaneError(error) || isConnectionUnavailable(error)) return { unavailable: "databaseUnavailable" };
    throw error;
  }
}

export function GET(request: NextRequest, input: RouteInput) {
  return handlePerformanceAdvisor(request, input);
}
