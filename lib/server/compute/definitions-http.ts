import { NextRequest, NextResponse } from "next/server";
import { isConnectionUnavailable } from "@/lib/server/db/errors";
import { ConfigurationError } from "@/lib/server/db/errors";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import { projectApplicationPrincipal } from "@/lib/server/data-plane/generated-http";
import {
  asControlPlaneContext,
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import type { Environment } from "@/lib/types";

export type ComputeDefinitionRouteContext = {
  params: Promise<{
    projectId: string; environment: string;
    cronId?: string; webhookId?: string; functionId?: string; name?: string;
    databaseWebhookId?: string;
    logDrainId?: string;
    dashboardWebhookId?: string;
    invocationId?: string;
  }>;
};

/**
 * Administratorkontext für die Definitionsfläche.
 *
 * Die Organisation kommt aus der Session, nie aus dem Pfad, und die
 * Projektumgebung wird über die Control Plane aufgelöst — ein Pfad, den der
 * Aufrufer nicht besitzt, endet deshalb in 404 statt in 403. Wer nicht darf,
 * soll nicht erfahren, dass es die Ressource gibt.
 */
export async function adminComputeContext(
  request: NextRequest,
  routeContext: ComputeDefinitionRouteContext,
) {
  const raw = await routeContext.params;
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(raw.projectId) ||
      !["development", "staging", "production"].includes(raw.environment)) {
    throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  }
  const authenticated = await authenticatedContext(request);
  requireCapability(authenticated, "project_compute_admin");
  await controlPlaneService.getProjectEnvironment(
    asControlPlaneContext(authenticated), raw.projectId, raw.environment as Environment,
  );
  const organizationId = authenticated.membership.organization.id;
  return {
    principal: {
      organizationId,
      actorRef: authenticated.user.email,
      role: "admin" as const,
      subject: authenticated.user.id,
    },
    scope: { organizationId, projectId: raw.projectId, environment: raw.environment as Environment },
    raw,
  };
}

/**
 * Aufrufkontext einer Function.
 *
 * Zwei Wege, bewusst nur zwei: ein **Service**-Projektschlüssel für einen
 * vertrauenswürdigen Backend-Aufrufer, oder eine Administratorsitzung für den
 * Testlauf aus der Console. Kein anonymer und kein Endnutzer-Aufruf — eine
 * Function läuft mit der Autorität des Projekts, nicht mit der ihres Aufrufers,
 * und eine Policy je Function, die das sicher unterscheiden könnte, gibt es
 * noch nicht.
 */
export async function functionInvocationContext(
  request: NextRequest,
  routeContext: ComputeDefinitionRouteContext,
) {
  const raw = await routeContext.params;
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(raw.projectId) ||
      !["development", "staging", "production"].includes(raw.environment)) {
    throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  }
  const scope = {
    projectId: raw.projectId, environment: raw.environment as Environment,
  };

  const application = await projectApplicationPrincipal(request, scope);
  if (application) {
    if (application.role !== "service_role") throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return {
      principal: {
        organizationId: application.organizationId,
        actorRef: application.actorRef,
        role: "service_role" as const,
        subject: application.subject,
      },
      scope: { organizationId: application.organizationId, ...scope },
      raw,
    };
  }
  return await adminComputeContext(request, routeContext);
}

export function computeNoStore(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status, headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}

export function computeRouteError(error: unknown) {
  // Ein erschoepfter Verbindungspool ist weder ein Fehler der Anfrage noch
  // einer der Datenbank: 503 und wiederholbar. Diese Regel steht an jeder
  // Grenze gleich, und der Vertrag in tests/route-unavailable-contract prueft,
  // dass keine sie vergisst.
  if (isConnectionUnavailable(error)) {
    return computeNoStore({ error: "Compute contracts unavailable" }, 503);
  }
  if (error instanceof RequestAuthenticationError) {
    return computeNoStore({ error: "Authentication required" }, 401);
  }
  if (error instanceof RequestAuthorizationError) {
    return computeNoStore({ error: "Resource not found" }, 404);
  }
  if (error instanceof ComputeDefinitionError) {
    switch (error.code) {
      case "COMPUTE_INVALID_INPUT": return computeNoStore({ error: "Invalid compute definition" }, 400);
      case "COMPUTE_NOT_FOUND": return computeNoStore({ error: "Resource not found" }, 404);
      case "COMPUTE_CONFLICT": return computeNoStore({ error: "Compute definition conflict" }, 409);
      case "COMPUTE_PRECONDITION_FAILED":
        return computeNoStore({ error: "Disable the webhook before deleting it" }, 409);
      case "COMPUTE_AT_CAPACITY":
        return computeNoStore({ error: "The function is at its concurrency limit" }, 429);
      case "COMPUTE_QUOTA_EXCEEDED":
        return computeNoStore({ error: "The usage quota for function invocations is exhausted" }, 429);
    }
  }
  if (error instanceof ConfigurationError) {
    return computeNoStore({ error: "Compute definitions are disabled" }, 503);
  }
  // Datenbankmeldungen, Ziel-URLs und Geheimnisreferenzen bleiben draussen.
  return computeNoStore({ error: "Compute definitions unavailable" }, 500);
}
