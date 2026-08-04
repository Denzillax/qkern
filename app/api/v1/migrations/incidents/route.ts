import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { MigrationIncidentService } from "@/lib/server/migrations/incident-service";
import { migrationIncidentService } from "@/lib/server/migrations/incident-runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const querySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(["open", "acknowledged", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createListMigrationIncidentsHandler(service: MigrationIncidentService) {
  return async function GET(request: NextRequest) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_incident_read");
      const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
      if (!parsed.success) return NextResponse.json({ error: "Invalid incident query" }, { status: 400 });
      const incidents = await service.listIncidents(asControlPlaneContext(principal), parsed.data);
      return NextResponse.json({ data: { incidents } }, {
        headers: { "cache-control": "private, no-store" },
      });
    } catch (error) {
      if (error instanceof RequestAuthenticationError) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (error instanceof RequestAuthorizationError) return notFound();
      const code = domainErrorCode(error);
      if (code === "RESOURCE_NOT_FOUND" || code === "INVALID_REFERENCE") return notFound();
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration incident service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not list migration incidents" }, { status: 500 });
    }
  };
}

export const GET = createListMigrationIncidentsHandler(migrationIncidentService);
