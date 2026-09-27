import { NextRequest } from "next/server";
import { csrfRejected, hasTrustedOrigin } from "@/lib/server/auth/http";
import {
  adminProjectStorageContext,
  projectStorageNoStore,
  projectStorageRouteError,
  type ProjectStorageRouteContext,
} from "@/lib/server/project-storage/http";
import type { ProjectStorageS3AccessKeyService } from "@/lib/server/project-storage/s3-access-keys";
import { getProjectStorageS3AccessKeyService } from "@/lib/server/project-storage/s3-access-keys-runtime";

/**
 * Widerruf eines Schluesselpaars (2.78). DELETE als Verb, aber nicht als
 * Wirkung: Die Zeile bleibt mit ihrem Widerrufszeitpunkt stehen, denn wer
 * widerruft, will die Spur behalten. Die Laufzeitrolle hat auf der Tabelle
 * ueberhaupt kein DELETE.
 */
export function createProjectStorageS3AccessKeyRevokeHandlers(
  service: ProjectStorageS3AccessKeyService,
) {
  return {
    DELETE: async (request: NextRequest, routeContext: ProjectStorageRouteContext) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      try {
        const context = await adminProjectStorageContext(request, routeContext);
        const keyId = context.raw.keyId ?? "";
        const data = await service.revoke(context.principal, context.scope, keyId);
        return projectStorageNoStore({ data });
      } catch (error) { return projectStorageRouteError(error); }
    },
  };
}

export const DELETE = (request: NextRequest, routeContext: ProjectStorageRouteContext) =>
  createProjectStorageS3AccessKeyRevokeHandlers(getProjectStorageS3AccessKeyService())
    .DELETE(request, routeContext);
