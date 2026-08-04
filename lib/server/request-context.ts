import type { NextRequest } from "next/server";
import { authRuntime } from "@/lib/server/auth/runtime";
import { sessionToken } from "@/lib/server/auth/http";
import { AuthError } from "@/lib/server/auth/service";
import { type Membership, type OrganizationRole } from "@/lib/server/tenancy";
import { tenancyService } from "@/lib/server/tenancy-service";
import type { PublicAuthUser } from "@/lib/server/auth/model";
import type { ControlPlaneContext } from "@/lib/server/control-plane/model";

export type AuthenticatedRequestContext = { user: PublicAuthUser; membership: Membership };

export class RequestAuthenticationError extends Error {
  constructor() { super("AUTHENTICATION_REQUIRED"); this.name = "RequestAuthenticationError"; }
}

export class RequestAuthorizationError extends Error {
  constructor() { super("RESOURCE_NOT_FOUND"); this.name = "RequestAuthorizationError"; }
}

export async function authenticatedContext(request: NextRequest): Promise<AuthenticatedRequestContext> {
  const token = sessionToken(request);
  if (!token) throw new RequestAuthenticationError();
  try {
    const { user } = await authRuntime.service.getSession(token);
    const requestedOrganization = request.headers.get("x-qkern-organization");
    return { user, membership: await tenancyService.resolve(user, requestedOrganization) };
  } catch (error) {
    if (error instanceof AuthError && error.code === "INVALID_SESSION") throw new RequestAuthenticationError();
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
  | "automation_policy"
  | "project_api_keys"
  | "project_auth_admin"
  | "project_storage_admin"
  | "project_queues_admin"
  | "project_data_mutate";

const ROLE_CAPABILITIES: Record<OrganizationRole, ReadonlySet<RequestCapability>> = {
  owner: new Set(["read", "change_preview", "approve", "apply", "migration_review", "migration_apply_delivery_read", "migration_apply_delivery_retry", "migration_incident_read", "migration_incident_ack", "migration_incident_resolve", "migration_incident_delivery_retry", "project_provisioning_read", "project_provisioning_request", "automation_policy", "project_api_keys", "project_auth_admin", "project_storage_admin", "project_queues_admin", "project_data_mutate"]),
  administrator: new Set(["read", "change_preview", "approve", "apply", "migration_review", "migration_apply_delivery_read", "migration_apply_delivery_retry", "migration_incident_read", "migration_incident_ack", "migration_incident_resolve", "migration_incident_delivery_retry", "project_provisioning_read", "project_provisioning_request", "automation_policy", "project_api_keys", "project_auth_admin", "project_storage_admin", "project_queues_admin", "project_data_mutate"]),
  developer: new Set(["read", "change_preview", "project_data_mutate"]),
  deployer: new Set(["read", "change_preview", "apply", "migration_apply_delivery_read", "project_provisioning_read"]),
  analyst: new Set(["read"]), support: new Set(["read", "migration_apply_delivery_read", "migration_incident_read", "project_provisioning_read"]), read_only: new Set(["read"]),
};

export function requireCapability(context: AuthenticatedRequestContext, capability: RequestCapability) {
  if (!ROLE_CAPABILITIES[context.membership.role].has(capability)) throw new RequestAuthorizationError();
}

export function asControlPlaneContext(context: AuthenticatedRequestContext): ControlPlaneContext {
  return { organizationId: context.membership.organization.id, actor: { id: context.user.id, ref: context.user.email, type: "user" } };
}
