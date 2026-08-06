import type { NextRequest } from "next/server";
import type { Environment } from "@/lib/types";
import type { GeneratedDataContext } from "@/lib/server/data-plane/generated-api";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { admitApiRequest } from "@/lib/server/usage/api-requests";

export type GeneratedDataScope = { projectId: string; environment: Environment };

export type ProjectApplicationPrincipal = {
  organizationId: string;
  actorRef: string;
  role: "authenticated" | "anon" | "service_role";
  subject: string;
  claims: GeneratedDataContext["claims"];
};

export function presentedProjectApiKey(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const rawBearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  const bearer = rawBearer?.startsWith("qk_") ? rawBearer : null;
  const explicit = request.headers.get("x-qkern-key")?.trim() || null;
  if (explicit && !explicit.startsWith("qk_")) throw new RequestAuthenticationError();
  if (bearer && explicit && bearer !== explicit) throw new RequestAuthenticationError();
  const key = bearer ?? explicit;
  return key ?? null;
}

export async function generatedDataContext(
  request: NextRequest,
  scope: GeneratedDataScope,
  write: boolean,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
): Promise<GeneratedDataContext> {
  const application = await projectApplicationPrincipal(request, scope, keys, projectAuth);
  if (application) {
    await admitApiRequest("generated_data_api", { organizationId: application.organizationId, ...scope });
    return {
      organizationId: application.organizationId,
      actorRef: application.actorRef,
      claims: application.claims,
    };
  }

  const principal = await authenticatedContext(request);
  requireCapability(principal, write ? "project_data_mutate" : "read");
  const organizationId = principal.membership.organization.id;
  await admitApiRequest("generated_data_api", { organizationId, ...scope });
  return {
    organizationId,
    actorRef: principal.user.email,
    claims: { role: "authenticated", subject: principal.user.id },
  };
}

export async function projectApplicationPrincipal(
  request: NextRequest,
  scope: GeneratedDataScope,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
): Promise<ProjectApplicationPrincipal | null> {
  const presented = presentedProjectApiKey(request);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  const appAccessToken = bearer && !bearer.startsWith("qk_") ? bearer : null;
  if (appAccessToken) {
    if (!presented) throw new RequestAuthenticationError();
    const keyPrincipal = await keys.authenticate(presented);
    if (!keyPrincipal) throw new RequestAuthenticationError();
    if (keyPrincipal.projectId !== scope.projectId || keyPrincipal.environment !== scope.environment) {
      throw new RequestAuthorizationError();
    }
    const authScope = {
      organizationId: keyPrincipal.organizationId,
      projectId: scope.projectId,
      environment: scope.environment,
    };
    try {
      const principal = await (projectAuth ?? getProjectAuthService()).verifyAccess(authScope, appAccessToken);
      return {
        organizationId: authScope.organizationId,
        actorRef: `project-auth-user:${principal.user.id}`,
        role: "authenticated",
        subject: principal.user.id,
        claims: {
          role: "authenticated", subject: principal.user.id, email: principal.user.email,
          emailVerified: Boolean(principal.user.emailVerifiedAt), assurance: principal.session.assurance,
          sessionId: principal.session.id, userMetadata: principal.user.userMetadata,
          appMetadata: principal.user.appMetadata,
        },
      };
    } catch {
      throw new RequestAuthenticationError();
    }
  }
  if (presented) {
    const principal = await keys.authenticate(presented);
    if (!principal) throw new RequestAuthenticationError();
    if (principal.projectId !== scope.projectId || principal.environment !== scope.environment) {
      throw new RequestAuthorizationError();
    }
    return {
      organizationId: principal.organizationId,
      actorRef: `project-api-key:${principal.id}`,
      role: principal.kind === "service" ? "service_role" : "anon",
      subject: principal.id,
      claims: {
        role: principal.kind === "service" ? "service_role" : "anon",
        subject: principal.id,
        keyId: principal.id,
      },
    };
  }
  return null;
}
