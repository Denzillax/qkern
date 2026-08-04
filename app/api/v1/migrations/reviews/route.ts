import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { domainErrorCode } from "@/lib/server/domain-errors";
import type { MigrationReviewService } from "@/lib/server/migrations/review-service";
import { migrationReviewService } from "@/lib/server/migrations/review-runtime";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";

const querySchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
const notFound = () => NextResponse.json({ error: "Resource not found" }, { status: 404 });

export function createListMigrationReviewsHandler(service: MigrationReviewService) {
  return async function GET(request: NextRequest) {
    try {
      const principal = await authenticatedContext(request);
      requireCapability(principal, "migration_review");
      const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
      if (!parsed.success) return NextResponse.json({ error: "Invalid review query" }, { status: 400 });
      const reviews = await service.listReviews(asControlPlaneContext(principal), parsed.data);
      return NextResponse.json({ data: { reviews } });
    } catch (error) {
      if (error instanceof RequestAuthenticationError) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (error instanceof RequestAuthorizationError) return notFound();
      const code = domainErrorCode(error);
      if (code === "RESOURCE_NOT_FOUND" || code === "INVALID_REFERENCE") return notFound();
      if (code === "DEPENDENCY_UNAVAILABLE") {
        return NextResponse.json({ error: "Migration review service unavailable" }, { status: 503 });
      }
      return NextResponse.json({ error: "Could not list migration reviews" }, { status: 500 });
    }
  };
}

export const GET = createListMigrationReviewsHandler(migrationReviewService);
