import { recognisedByName } from "@/lib/server/errors/identity";
import type { NextRequest } from "next/server";
import { authRuntime } from "@/lib/server/auth/runtime";
import { sessionToken } from "@/lib/server/auth/http";
import { isAuthError } from "@/lib/server/auth/service";
import { type Membership, type OrganizationRole } from "@/lib/server/tenancy";
import { tenancyService } from "@/lib/server/tenancy-service";
import type { PublicAuthUser } from "@/lib/server/auth/model";
import type { ControlPlaneContext } from "@/lib/server/control-plane/model";

export type AuthenticatedRequestContext = { user: PublicAuthUser; membership: Membership };

export class RequestAuthenticationError extends Error {
  constructor() { super("AUTHENTICATION_REQUIRED"); this.name = "RequestAuthenticationError"; }
}
recognisedByName(RequestAuthenticationError, "RequestAuthenticationError");

export class RequestAuthorizationError extends Error {
  constructor() { super("RESOURCE_NOT_FOUND"); this.name = "RequestAuthorizationError"; }
}
recognisedByName(RequestAuthorizationError, "RequestAuthorizationError");

export async function authenticatedContext(request: NextRequest): Promise<AuthenticatedRequestContext> {
  const token = sessionToken(request);
  if (!token) throw new RequestAuthenticationError();
  try {
    const { user } = await authRuntime.service.getSession(token);
    const requestedOrganization = request.headers.get("x-qkern-organization");
    return { user, membership: await tenancyService.resolve(user, requestedOrganization) };
  } catch (error) {
    if (isAuthError(error, "INVALID_SESSION")) throw new RequestAuthenticationError();
    if (error instanceof Error && error.message === "RESOURCE_NOT_FOUND") throw new RequestAuthorizationError();
    throw error;
  }
}

export type RequestCapability =
  | "read"
  | "change_preview"
  | "approve"
  | "apply"
  | "migration_review"
  | "migration_apply_delivery_read"
  | "migration_apply_delivery_retry"
  | "migration_incident_read"
  | "migration_incident_ack"
  | "migration_incident_resolve"
  | "migration_incident_delivery_retry"
  | "project_provisioning_read"
  | "project_provisioning_request"
  /**
   * Ein Projekt anlegen (2.147). Eigenes Recht und nicht `change_preview`:
   * Das Anlegen wirkt auf die Organisation und nicht in einem Projekt, es
   * belegt einen Slug dauerhaft (die Eindeutigkeit traegt `deleted_at` nicht),
   * und ein Entwickler soll Aenderungen vorschlagen duerfen, ohne der
   * Organisation Projekte hinzuzufuegen.
   */
  | "project_create"
  /**
   * Die drei Rechte am Backup einer Projektdatenbank (2.129). Drei und nicht
   * eines, weil die Handlungen nicht dasselbe sind; die Begruendung je Recht
   * steht in `app/api/v1/.../database/backups/route.ts`.
   */
  | "project_backup_read"
  | "project_backup_request"
  | "project_backup_restore"
  | "automation_policy"
  | "project_api_keys"
  | "project_auth_admin"
  | "project_storage_admin"
  | "project_queues_admin"
  | "project_compute_admin"
  | "project_data_mutate";

const ROLE_CAPABILITIES: Record<OrganizationRole, ReadonlySet<RequestCapability>> = {
  // `project_backup_restore` steht **nur** hier: eine Wiederherstellung legt eine
  // neue Datenbank an, bringt geloeschte Daten zurueck und ist nicht
  // wiederholbar. Ein Administrator darf ein Backup bestellen und den Katalog
  // lesen; die Datenbank zurueckholen darf der, der fuer die Organisation haftet.
  owner: new Set(["read", "change_preview", "approve", "apply", "migration_review", "migration_apply_delivery_read", "migration_apply_delivery_retry", "migration_incident_read", "migration_incident_ack", "migration_incident_resolve", "migration_incident_delivery_retry", "project_provisioning_read", "project_provisioning_request", "project_backup_read", "project_backup_request", "automation_policy", "project_api_keys", "project_auth_admin", "project_storage_admin", "project_queues_admin", "project_compute_admin", "project_data_mutate", "project_create", "project_backup_restore"]),
  administrator: new Set(["read", "change_preview", "approve", "apply", "migration_review", "migration_apply_delivery_read", "migration_apply_delivery_retry", "migration_incident_read", "migration_incident_ack", "migration_incident_resolve", "migration_incident_delivery_retry", "project_provisioning_read", "project_provisioning_request", "project_backup_read", "project_backup_request", "automation_policy", "project_api_keys", "project_auth_admin", "project_storage_admin", "project_queues_admin", "project_compute_admin", "project_data_mutate", "project_create"]),
  developer: new Set(["read", "change_preview", "project_data_mutate"]),
  deployer: new Set(["read", "change_preview", "apply", "migration_apply_delivery_read", "project_provisioning_read", "project_backup_read"]),
  analyst: new Set(["read"]), support: new Set(["read", "migration_apply_delivery_read", "migration_incident_read", "project_provisioning_read", "project_backup_read"]), read_only: new Set(["read"]),
};

export function requireCapability(context: AuthenticatedRequestContext, capability: RequestCapability) {
  if (!ROLE_CAPABILITIES[context.membership.role].has(capability)) throw new RequestAuthorizationError();
}

export function asControlPlaneContext(context: AuthenticatedRequestContext): ControlPlaneContext {
  return { organizationId: context.membership.organization.id, actor: { id: context.user.id, ref: context.user.email, type: "user" } };
}
