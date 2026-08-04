import { randomUUID } from "node:crypto";
import type { PublicAuthUser } from "@/lib/server/auth/model";
import { ConfigurationError, ConflictError } from "@/lib/server/db/errors";
import { getAuthPostgresPool, getPostgresPool } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import { PostgresTenancyRepository } from "@/lib/server/tenancy-postgres";
import { tenancyRuntime, type Membership, type OrganizationSummary } from "@/lib/server/tenancy";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export interface TenancyService {
  ensureWorkspace(user: PublicAuthUser): Promise<Membership>;
  list(user: PublicAuthUser): Promise<Membership[]>;
  resolve(user: PublicAuthUser, requestedOrganizationId?: string | null): Promise<Membership>;
}

export class MemoryTenancyService implements TenancyService {
  async ensureWorkspace(user: PublicAuthUser) { return tenancyRuntime.ensureWorkspace(user); }
  async list(user: PublicAuthUser) { return tenancyRuntime.list(user); }
  async resolve(user: PublicAuthUser, requestedOrganizationId?: string | null) { return tenancyRuntime.resolve(user, requestedOrganizationId); }
}

function workspaceIdentity(user: PublicAuthUser): { organization: OrganizationSummary; project: { id: string; name: string; slug: string; region: string; status: "provisioning" } } {
  const localPart = user.email.split("@")[0] || "workspace";
  const base = localPart.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  return {
    organization: {
      id: randomUUID(),
      name: `${localPart.charAt(0).toUpperCase()}${localPart.slice(1)} Workspace`,
      slug: `${base}-${randomUUID().slice(0, 6)}`,
    },
    project: { id: randomUUID(), name: "First Project", slug: "first-project", region: "unassigned", status: "provisioning" },
  };
}

export class PersistentTenancyService implements TenancyService {
  constructor(private readonly repository: PostgresTenancyRepository) {}

  async ensureWorkspace(user: PublicAuthUser): Promise<Membership> {
    const existing = (await this.repository.listMemberships(user.id))[0];
    if (existing) return existing;
    const identity = workspaceIdentity(user);
    try {
      return await this.repository.createWorkspace({ ...identity, userId: user.id });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = (await this.repository.listMemberships(user.id))[0];
      if (!raced) throw error;
      return raced;
    }
  }

  async list(user: PublicAuthUser): Promise<Membership[]> {
    const memberships = await this.repository.listMemberships(user.id);
    return memberships.length ? memberships : [await this.ensureWorkspace(user)];
  }

  async resolve(user: PublicAuthUser, requestedOrganizationId?: string | null): Promise<Membership> {
    if (requestedOrganizationId) {
      const membership = await this.repository.getMembership(user.id, requestedOrganizationId);
      if (!membership) throw new Error("RESOURCE_NOT_FOUND");
      return membership;
    }
    const membership = (await this.list(user))[0];
    if (!membership) throw new Error("RESOURCE_NOT_FOUND");
    return membership;
  }
}

export function tenancyAdapterFromEnv(env: Record<string, string | undefined> = process.env): "memory" | "postgres" {
  return runtimeModeFromEnv(env);
}

export function createTenancyService(env: Record<string, string | undefined> = process.env, dependencies: { pool?: SqlPool; authPool?: SqlPool } = {}): TenancyService {
  if (tenancyAdapterFromEnv(env) === "memory") return new MemoryTenancyService();
  const pool = dependencies.pool ?? getPostgresPool(env);
  const authPool = dependencies.authPool ?? getAuthPostgresPool(env);
  return new PersistentTenancyService(new PostgresTenancyRepository(pool, authPool));
}

type GlobalTenancyService = typeof globalThis & { __qkernTenancyService?: TenancyService };
const globalTenancyService = globalThis as GlobalTenancyService;
export const tenancyService = globalTenancyService.__qkernTenancyService ?? createTenancyService();
if (process.env.NODE_ENV !== "production") globalTenancyService.__qkernTenancyService = tenancyService;
