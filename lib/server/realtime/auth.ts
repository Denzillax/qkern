import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import type { RealtimePrincipal, RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";

export type RealtimeCredentials = { projectKey: string; accessToken?: string };

export interface RealtimeAuthenticator {
  authenticate(scope: Omit<RealtimeScope, "organizationId">, credentials: RealtimeCredentials): Promise<{
    scope: RealtimeScope;
    principal: RealtimePrincipal;
  }>;
}

export class ProjectRealtimeAuthenticator implements RealtimeAuthenticator {
  constructor(
    private readonly keys: Pick<ProjectApiKeyService, "authenticate">,
    private readonly projectAuth: () => Pick<ProjectAuthService, "verifyAccess">,
  ) {}

  async authenticate(scope: Omit<RealtimeScope, "organizationId">, credentials: RealtimeCredentials) {
    try {
      const key = await this.keys.authenticate(credentials.projectKey);
      if (!key || key.projectId !== scope.projectId || key.environment !== scope.environment) {
        throw new Error("invalid");
      }
      const realtimeScope: RealtimeScope = { organizationId: key.organizationId, ...scope };
      if (credentials.accessToken) {
        const verified = await this.projectAuth().verifyAccess(realtimeScope, credentials.accessToken);
        return {
          scope: realtimeScope,
          principal: {
            organizationId: key.organizationId,
            actorRef: `project-auth-user:${verified.user.id}`,
            role: "authenticated" as const,
            subject: verified.user.id,
          },
        };
      }
      return {
        scope: realtimeScope,
        principal: {
          organizationId: key.organizationId,
          actorRef: `project-api-key:${key.id}`,
          role: key.kind === "service" ? "service_role" as const : "anon" as const,
          subject: key.id,
        },
      };
    } catch {
      throw new RealtimeError("REALTIME_AUTH_FAILED");
    }
  }
}
