import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { domainErrorCode } from "@/lib/server/domain-errors";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

/**
 * `GET /v1/projects/{projectId}/change-flow`: was je Umgebung unterwegs und
 * was angekommen ist (2.81).
 *
 * Die Antwort traegt immer alle drei Umgebungen, auch die ohne eine einzige
 * Zeile. Das ist die Aussage: QKERN hat je Projekt drei feste Umgebungen und
 * keine frei benannten Zweige, also kann diese Liste auch nicht laenger oder
 * kuerzer werden. `present` sagt, ob die Kontrollebene fuer eine Umgebung
 * schon eine Zeile fuehrt, `bound`, ob deren Referenz die Form einer Bindung
 * hat. Eine Datenbankreferenz steht hier nicht: Wer sie braucht, nimmt
 * `/v1/projects/{projectId}/environments`, und auch dort ist sie keine
 * Adresse.
 *
 * Gezaehlt wird in der Datenbank, nicht an einer abgeschnittenen Liste.
 * `migrations` ist null, wo die Installation keine Warteschlange fuehrt; das
 * ist nicht dasselbe wie eine leere Warteschlange.
 *
 * Nur lesend, `private, no-store`, kein Query-Parameter.
 */
const projectIdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  input: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    const params = await input.params;
    const projectId = projectIdSchema.safeParse(params.projectId);
    // Ein Query-Parameter waere eine Zusage, die diese Route nicht hat; sie
    // antwortet wie auf ein unbekanntes Projekt und verraet damit auch nicht,
    // ob es das Projekt gibt.
    if (!projectId.success || [...request.nextUrl.searchParams.keys()].length > 0) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    const flow = await controlPlaneService.summariseChangeFlow(
      asControlPlaneContext(context),
      projectId.data,
    );
    return NextResponse.json({ data: flow }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    if (domainErrorCode(error) === "RESOURCE_NOT_FOUND") {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Project change flow unavailable" }, { status: 500 });
  }
}
