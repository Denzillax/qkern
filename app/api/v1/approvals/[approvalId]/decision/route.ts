import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { asControlPlaneContext, authenticatedContext, RequestAuthenticationError, RequestAuthorizationError, requireCapability } from "@/lib/server/request-context";

const schema = z.object({ decision: z.enum(["approved", "rejected"]) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ approvalId: string }> }) {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  const parsed = schema.safeParse(await safeJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  const { approvalId } = await context.params;
  try {
    const principal = await authenticatedContext(request);
    requireCapability(principal, "approve");
    return NextResponse.json({ data: await controlPlaneService.decideApproval(asControlPlaneContext(principal), { approvalId, decision: parsed.data.decision }) });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    const code = domainErrorCode(error);
    if (code === "APPROVAL_ALREADY_DECIDED") {
      return NextResponse.json({ error: "Approval was already decided" }, { status: 409 });
    }
    if (code === "APPROVAL_EXPIRED") {
      return NextResponse.json({ error: "Approval expired; create a fresh Change Set" }, { status: 410 });
    }
    if (code === "APPROVAL_INVALIDATED") {
      return NextResponse.json({ error: "Approval no longer matches the reviewed Change Set" }, { status: 409 });
    }
    if (code === "RESOURCE_NOT_FOUND") return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not decide approval" }, { status: 500 });
  }
}
