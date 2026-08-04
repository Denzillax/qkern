import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { ChangeSetApplyService } from "@/lib/server/migrations/apply-service";
import { changeSetApplyService } from "@/lib/server/migrations/apply-runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const emptyBody = z.object({}).strict();
const changeSetIdSchema = z.string().min(3).max(80);
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createApplyChangeSetHandler(service: ChangeSetApplyService) {
  return async function POST(
    request: NextRequest,
    routeContext: { params: Promise<{ changeSetId: string }> },
  ) {
    if (!hasTrustedOrigin(request)) return csrfRejected();

    try {
      // Authenticate and authorize before parsing attacker-controlled input.
      const principal = await authenticatedContext(request);
      requireCapability(principal, "apply");

      const parsedBody = emptyBody.safeParse(await safeJson(request));
      if (!parsedBody.success) {
        return NextResponse.json({ error: "Invalid apply request" }, { status: 400 });
      }
      const parsedId = changeSetIdSchema.safeParse((await routeContext.params).changeSetId);
      if (!parsedId.success) return notFound();

      const result = await service.queueApprovedChangeSet(asControlPlaneContext(principal), {
        changeSetId: parsedId.data,
      });
      const idempotent = result.outcome !== "queued";
      return NextResponse.json(
        { data: { ...result, idempotent } },
        { status: idempotent ? 200 : 202 },
      );
    } catch (error) {
      if (error instanceof RequestAuthenticationError) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (error instanceof RequestAuthorizationError) return notFound();
      const code = domainErrorCode(error);
      if (code === "RESOURCE_NOT_FOUND" || code === "INVALID_REFERENCE" || code === "INVALID_RECORD") return notFound();
      if (code === "CHANGE_SET_NOT_APPROVED" || code === "MIGRATION_NOT_READY") {
        return NextResponse.json({ error: "Change Set is not approved" }, { status: 409 });
      }
      if (code === "PRODUCTION_APPLY_BLOCKED") {
        return NextResponse.json({ error: "Production apply is not authorized" }, { status: 409 });
      }
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration queue unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not queue Change Set" }, { status: 500 });
    }
  };
}

export const POST = createApplyChangeSetHandler(changeSetApplyService);
