import { randomUUID } from "node:crypto";
import type { PublicAuthUser } from "@/lib/server/auth/model";
import { createProjectForOrganization } from "@/lib/server/store";

export type OrganizationRole = "owner" | "administrator" | "developer" | "deployer" | "analyst" | "support" | "read_only";
export type OrganizationSummary = { id: string; name: string; slug: string };
export type Membership = { organization: OrganizationSummary; userId: string; role: OrganizationRole };

class TenancyRuntime {
  private readonly membershipsByUser = new Map<string, Membership[]>();

  ensureWorkspace(user: PublicAuthUser): Membership {
    const existing = this.membershipsByUser.get(user.id)?.[0];
    if (existing) return existing;
    const localPart = user.email.split("@")[0] || "workspace";
    const organization: OrganizationSummary = {
      id: randomUUID(),
      name: `${localPart.charAt(0).toUpperCase()}${localPart.slice(1)} Workspace`,
      slug: `${localPart.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${randomUUID().slice(0, 6)}`,
    };
    const membership: Membership = { organization, userId: user.id, role: "owner" };
    this.membershipsByUser.set(user.id, [membership]);
    createProjectForOrganization({
      id: randomUUID(), organizationId: organization.id, name: "First Project", slug: "first-project",
      region: "unassigned", environment: "development", status: "provisioning",
    });
    return membership;
  }

  list(user: PublicAuthUser): Membership[] {
    if (!this.membershipsByUser.has(user.id)) this.ensureWorkspace(user);
    return [...(this.membershipsByUser.get(user.id) ?? [])];
  }

  resolve(user: PublicAuthUser, requestedOrganizationId?: string | null): Membership {
    const memberships = this.list(user);
    const membership = requestedOrganizationId
      ? memberships.find((item) => item.organization.id === requestedOrganizationId)
      : memberships[0];
    if (!membership) throw new Error("RESOURCE_NOT_FOUND");
    return membership;
  }
}

const globalTenancy = globalThis as typeof globalThis & { __qkernTenancyRuntime?: TenancyRuntime };
export const tenancyRuntime = globalTenancy.__qkernTenancyRuntime ?? new TenancyRuntime();
if (process.env.NODE_ENV !== "production") globalTenancy.__qkernTenancyRuntime = tenancyRuntime;
