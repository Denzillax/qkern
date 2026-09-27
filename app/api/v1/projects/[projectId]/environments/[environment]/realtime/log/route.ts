import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConfigurationError, isConnectionUnavailable } from "@/lib/server/db/errors";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { getProjectDataPlane } from "@/lib/server/data-plane/runtime";
import {
  isProjectDataPlaneError,
  type ProjectChangeFeedResult,
  type ProjectDataPlanePort,
} from "@/lib/server/data-plane/service";
import { getRealtimeLogReader } from "@/lib/server/realtime/log-runtime";
import type { PostgresRealtimeLogReader } from "@/lib/server/realtime/log-reader";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import type { Environment } from "@/lib/types";

/**
 * `GET .../realtime/log` — was QKERN vom Realtime-Transport wirklich
 * festhaelt (2.86).
 *
 * Die Platzhalterseite versprach „Verbindungen, Kanaele und Nachrichten ueber
 * die Zeit". Diese Route liefert zwei der drei Dinge und erfindet das dritte
 * nicht:
 *
 * **Kanaele und Nachrichten** stehen in der Kontrollebene, in
 * `realtime_channel_sequences` und `realtime_events`. Sie werden unter der
 * Organisation des Aufrufers gelesen; RLS beantwortet den Rest.
 *
 * **Der Rueckstand des Aenderungs-Feeds** braucht beide Seiten: die
 * gespeicherte Position aus der Kontrollebene und die wartenden Zeilen aus
 * `qkern_internal.change_feed` der Projektdatenbank. Die Position wird zuerst
 * gelesen und dann uebergeben; gezaehlt wird in der Projektdatenbank.
 *
 * **Verbindungen** stehen in keiner Antwort dieser Route, weil sie in keiner
 * Tabelle stehen. Der Realtime-Prozess fuehrt sie in einer Map im eigenen
 * Speicher. Sie zu melden hiesse, ihn ueber das Netz zu fragen — eine Wirkung,
 * die eine Leseroute nicht hat. Die Seite sagt das, statt zu schweigen.
 *
 * Die Antwort trennt darum den Zustand des Feeds vom Feed selbst: Eine fehlende
 * Projektdatenbank ist etwas anderes als ein Feed ohne wartende Zeile, und eine
 * Null koennte die beiden nicht unterscheiden.
 *
 * Nur lesend, `private, no-store`, kein Query-Parameter. Es gibt kein POST und
 * kein DELETE: Der Feed wird von seinen Lesern aufgeraeumt, nicht von einer
 * Oberflaeche.
 */
const environmentSchema = z.enum(["development", "staging", "production"]);
const projectIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]{3,128}$/);

/** Warum der Feed nicht gelesen werden konnte. `read` heisst: Er wurde gelesen. */
export type RealtimeChangeFeedState = "read" | "disabled" | "not_ready" | "unavailable";

export async function handleProjectRealtimeLog(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
  reader?: PostgresRealtimeLogReader,
  dataPlane?: ProjectDataPlanePort,
) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    const params = await input.params;
    const environment = environmentSchema.safeParse(params.environment);
    const projectId = projectIdSchema.safeParse(params.projectId);
    // Ein Query-Parameter waere eine Zusage, die diese Route nicht hat. Sie
    // antwortet wie auf ein unbekanntes Projekt und verraet damit auch nicht,
    // ob es das Projekt gibt.
    if (!environment.success || !projectId.success ||
        [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    // Die Umgebung wird zuerst aufgeloest: Ein Pfad, den der Aufrufer nicht
    // besitzt, endet in 404 und nicht in einer leeren Lesung, die aussaehe, als
    // gaebe es dort nichts.
    await controlPlaneService.getProjectEnvironment(
      asControlPlaneContext(context), projectId.data, environment.data as Environment);

    const organizationId = context.membership.organization.id;
    const scope = {
      organizationId, projectId: projectId.data, environment: environment.data as Environment,
    };
    const principal = { organizationId, actorRef: context.user.email };

    const reading = await (reader ?? getRealtimeLogReader()).read(principal, scope);

    // Die Projektdatenbank ist die zweite Haelfte und darf die erste nicht
    // mitreissen: Antwortet sie nicht, traegt die Antwort den Grund und die
    // Kanaele stehen trotzdem da.
    let feed: ProjectChangeFeedResult | null = null;
    let feedState: RealtimeChangeFeedState = "read";
    try {
      const service = dataPlane ?? await getProjectDataPlane();
      feed = await service.inspectChangeFeed(
        { organizationId, actorRef: context.user.email },
        { projectId: projectId.data, environment: environment.data as Environment },
        reading.cursor?.position ?? 0,
      );
    } catch (error) {
      if (!isProjectDataPlaneError(error) && !(error instanceof ConfigurationError)) throw error;
      feedState = feedStateFor(error);
    }

    return NextResponse.json({ data: { ...reading, feed, feedState } },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return realtimeLogRouteError(error);
  }
}

/**
 * Der Grund, warum der Feed fehlt, und zwar der echte.
 *
 * „Abgeschaltet" und „noch nicht eingerichtet" sind verschiedene Auskuenfte,
 * und keine von beiden heisst „nicht erreichbar".
 */
function feedStateFor(error: unknown): RealtimeChangeFeedState {
  if (error instanceof ConfigurationError) return "disabled";
  if (!isProjectDataPlaneError(error)) return "unavailable";
  if (error.code === "DATA_PLANE_DISABLED") return "disabled";
  if (error.code === "DATA_PLANE_NOT_READY") return "not_ready";
  return "unavailable";
}

export function realtimeLogRouteError(error: unknown) {
  // Ein erschoepfter Verbindungspool ist weder ein Fehler der Anfrage noch
  // einer der Datenbank: 503 und wiederholbar.
  if (isConnectionUnavailable(error)) {
    return NextResponse.json({ error: "Realtime log unavailable" }, { status: 503 });
  }
  if (error instanceof RequestAuthenticationError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (error instanceof RequestAuthorizationError) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }
  if (domainErrorCode(error) === "RESOURCE_NOT_FOUND") {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }
  if (error instanceof ConfigurationError) {
    return NextResponse.json({ error: "Realtime log unavailable" }, { status: 503 });
  }
  // Datenbankmeldungen und Kanalnamen bleiben draussen.
  return NextResponse.json({ error: "Realtime log unavailable" }, { status: 500 });
}

export function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string; environment: string }> },
) {
  return handleProjectRealtimeLog(request, input);
}
