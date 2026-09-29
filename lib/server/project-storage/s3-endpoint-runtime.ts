import { ProjectStorageS3Endpoint } from "@/lib/server/project-storage/s3-endpoint";
import { getProjectStorageS3AccessKeyService } from "@/lib/server/project-storage/s3-access-keys-runtime";
import { getProjectStorageService } from "@/lib/server/project-storage/runtime";
import { admitApiRequest } from "@/lib/server/usage/api-requests";

type GlobalS3Endpoint = typeof globalThis & { __qkernProjectStorageS3Endpoint?: ProjectStorageS3Endpoint };

/**
 * Der Endpunkt haengt an denselben Diensten wie die REST-Routen (2.96). Ist
 * Storage abgeschaltet, werfen beide erst im Aufruf, und der Endpunkt
 * antwortet mit 503 ServiceUnavailable statt mit einem leeren 500.
 */
export function getProjectStorageS3Endpoint(): ProjectStorageS3Endpoint {
  const runtime = globalThis as GlobalS3Endpoint;
  runtime.__qkernProjectStorageS3Endpoint ??= new ProjectStorageS3Endpoint({
    storage: getProjectStorageService(),
    keys: getProjectStorageS3AccessKeyService(),
    admit: (scope) => admitApiRequest("project_storage", scope),
  });
  return runtime.__qkernProjectStorageS3Endpoint;
}
