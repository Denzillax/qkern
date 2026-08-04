import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { asControlPlaneContext, authenticatedContext, RequestAuthenticationError, RequestAuthorizationError, requireCapability } from "@/lib/server/request-context";

const schema = z.object({
  projectId: z.string().min(3).max(80),
  environment: z.enum(["development", "staging", "production"]),
  title: z.string().min(3).max(120),
  statement: z.string().min(5).max(10_000),
}).strict();

export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const parsed = schema.safeParse(await safeJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid change set", details: parsed.error.flatten() }, { status: 400 });
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "change_preview");
    const change = await controlPlaneService.createChangeSet(asControlPlaneContext(context), parsed.data);
    return NextResponse.json({ data: change }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    const code = domainErrorCode(error);
    if (error instanceof Error && error.message.includes("INVALID_SQL:")) {
      return NextResponse.json({ error: "Invalid SQL statement", message: error.message.split("INVALID_SQL:")[1] }, { status: 400 });
    }
    if (code === "RESOURCE_NOT_FOUND") {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    if (code === "MIGRATION_NOT_READY") {
      return NextResponse.json({ error: "Project environment is not provisioned" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create change set" }, { status: 500 });
  }
}
