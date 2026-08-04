import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Environment } from "@/lib/types";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import { InvalidRecordError, ResourceNotFoundError } from "@/lib/server/db/errors";
import type { SqlPool } from "@/lib/server/db/sql";

const TOKEN = /^qk_(public|service)_[A-Za-z0-9_-]{43}$/;
const MAX_TTL_MS = 366 * 24 * 60 * 60 * 1_000;
const MIN_TTL_MS = 5 * 60 * 1_000;

export type ProjectApiKeyKind = "public" | "service";

export type ProjectApiKey = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  name: string;
  kind: ProjectApiKeyKind;
  prefix: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type ProjectApiKeyPrincipal = Pick<ProjectApiKey,
  "id" | "organizationId" | "projectId" | "environment" | "kind" | "expiresAt">;

export type ProjectApiKeyContext = {
  organizationId: string;
  actor: { id: string; ref: string };
};

type StoredProjectApiKey = ProjectApiKey & { tokenHash: string; createdBy: string };

export interface ProjectApiKeyStore {
  list(context: ProjectApiKeyContext, projectId: string, environment: Environment): Promise<ProjectApiKey[]>;
  create(context: ProjectApiKeyContext, input: StoredProjectApiKey): Promise<ProjectApiKey>;
  revoke(context: ProjectApiKeyContext, projectId: string, environment: Environment, keyId: string): Promise<ProjectApiKey>;
}

export interface ProjectApiKeyVerifier {
  authenticate(tokenHash: string): Promise<ProjectApiKeyPrincipal | null>;
}

export class ProjectApiKeyService {
  constructor(
    private readonly controlPlane: ControlPlaneService,
    private readonly store: ProjectApiKeyStore,
    private readonly verifier: ProjectApiKeyVerifier,
    private readonly token: (kind: ProjectApiKeyKind) => string = projectApiKeyToken,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = () => randomUUID(),
  ) {}

  async list(context: ProjectApiKeyContext, projectId: string, environment: Environment): Promise<ProjectApiKey[]> {
    await this.assertScope(context, projectId, environment);
    return this.store.list(context, projectId, environment);
  }

  async create(context: ProjectApiKeyContext, input: {
    projectId: string;
    environment: Environment;
    name: string;
    kind: ProjectApiKeyKind;
    expiresAt: string;
  }): Promise<{ key: ProjectApiKey; secret: string }> {
    await this.assertScope(context, input.projectId, input.environment);
    const name = input.name.trim();
    const expiresAt = new Date(input.expiresAt);
    const now = this.now();
    const ttl = expiresAt.getTime() - now.getTime();
    if (!name || name.length > 80 || !["public", "service"].includes(input.kind) ||
        !Number.isFinite(expiresAt.getTime()) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
      throw new InvalidRecordError("Invalid project API key request.");
    }
    const secret = this.token(input.kind);
    if (!TOKEN.test(secret) || !secret.startsWith(`qk_${input.kind}_`)) {
      throw new InvalidRecordError("Project API key generation failed.");
    }
    const stored: StoredProjectApiKey = {
      id: this.id(),
      organizationId: context.organizationId,
      projectId: input.projectId,
      environment: input.environment,
      name,
      kind: input.kind,
      prefix: secret.slice(0, 22),
      tokenHash: hashProjectApiKey(secret),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      createdBy: context.actor.id,
      createdAt: now.toISOString(),
    };
    return { key: await this.store.create(context, stored), secret };
  }

  async revoke(
    context: ProjectApiKeyContext,
    projectId: string,
    environment: Environment,
    keyId: string,
  ): Promise<ProjectApiKey> {
    await this.assertScope(context, projectId, environment);
    if (!keyId || keyId.length > 128) throw new ResourceNotFoundError("Project API key");
    return this.store.revoke(context, projectId, environment, keyId);
  }

  async authenticate(secret: string): Promise<ProjectApiKeyPrincipal | null> {
    if (!TOKEN.test(secret)) return null;
    const principal = await this.verifier.authenticate(hashProjectApiKey(secret));
    if (!principal || Date.parse(principal.expiresAt) <= this.now().getTime()) return null;
    return principal;
  }

  private async assertScope(context: ProjectApiKeyContext, projectId: string, environment: Environment) {
    if (!context.organizationId || !context.actor.id || !context.actor.ref ||
        !projectId || projectId.length > 128 || !["development", "staging", "production"].includes(environment)) {
      throw new ResourceNotFoundError("Project");
    }
    await this.controlPlane.getProjectEnvironment({
      organizationId: context.organizationId,
      actor: { id: context.actor.id, ref: context.actor.ref, type: "user" },
    }, projectId, environment);
  }
}

export class MemoryProjectApiKeyStore implements ProjectApiKeyStore, ProjectApiKeyVerifier {
  private readonly records = new Map<string, StoredProjectApiKey>();

  async list(context: ProjectApiKeyContext, projectId: string, environment: Environment): Promise<ProjectApiKey[]> {
    return [...this.records.values()]
      .filter((record) => record.organizationId === context.organizationId &&
        record.projectId === projectId && record.environment === environment)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicKey);
  }

  async create(context: ProjectApiKeyContext, input: StoredProjectApiKey): Promise<ProjectApiKey> {
    if (context.organizationId !== input.organizationId || this.records.has(input.id) ||
        [...this.records.values()].some((record) => record.tokenHash === input.tokenHash)) {
      throw new InvalidRecordError("Project API key could not be created.");
    }
    this.records.set(input.id, { ...input });
    return publicKey(input);
  }

  async revoke(
    context: ProjectApiKeyContext,
    projectId: string,
    environment: Environment,
    keyId: string,
  ): Promise<ProjectApiKey> {
    const record = this.records.get(keyId);
    if (!record || record.organizationId !== context.organizationId ||
        record.projectId !== projectId || record.environment !== environment) {
      throw new ResourceNotFoundError("Project API key");
    }
    record.revokedAt ??= new Date().toISOString();
    return publicKey(record);
  }

  async authenticate(tokenHash: string): Promise<ProjectApiKeyPrincipal | null> {
    const record = [...this.records.values()].find((candidate) =>
      candidate.tokenHash === tokenHash && !candidate.revokedAt);
    return record ? principal(record) : null;
  }
}

export class PostgresProjectApiKeyStore implements ProjectApiKeyStore {
  constructor(private readonly database: Pick<PostgresControlPlane, "withTenant">) {}

  list(context: ProjectApiKeyContext, projectId: string, environment: Environment): Promise<ProjectApiKey[]> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const result = await repositories.transaction.query(
        `SELECT id, organization_id, project_id, environment, name, kind, token_prefix,
                expires_at, revoked_at, created_at
         FROM project_api_keys
         WHERE organization_id = $1 AND project_id = $2 AND environment = $3
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [context.organizationId, projectId, environment],
      );
      return result.rows.map(projectApiKeyFromRow);
    });
  }

  create(context: ProjectApiKeyContext, input: StoredProjectApiKey): Promise<ProjectApiKey> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      const result = await repositories.transaction.query(
        `INSERT INTO project_api_keys
           (id, organization_id, project_id, environment, name, kind, token_prefix,
            token_hash, expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, organization_id, project_id, environment, name, kind, token_prefix,
                   expires_at, revoked_at, created_at`,
        [input.id, input.organizationId, input.projectId, input.environment, input.name, input.kind,
          input.prefix, input.tokenHash, new Date(input.expiresAt), input.createdBy, new Date(input.createdAt)],
      );
      const created = projectApiKeyFromRow(result.rows[0]);
      await repositories.audit.append({
        projectId: input.projectId,
        environment: input.environment,
        actorType: "user",
        actorRef: context.actor.ref,
        action: "project.api_key.created",
        resourceRef: created.id,
        status: "success",
        metadata: { kind: created.kind, prefix: created.prefix, expiresAt: created.expiresAt },
      });
      return created;
    });
  }

  revoke(
    context: ProjectApiKeyContext,
    projectId: string,
    environment: Environment,
    keyId: string,
  ): Promise<ProjectApiKey> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      const result = await repositories.transaction.query(
        `UPDATE project_api_keys SET revoked_at = coalesce(revoked_at, now())
         WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
         RETURNING id, organization_id, project_id, environment, name, kind, token_prefix,
                   expires_at, revoked_at, created_at`,
        [context.organizationId, projectId, environment, keyId],
      );
      if (!result.rows[0]) throw new ResourceNotFoundError("Project API key");
      const revoked = projectApiKeyFromRow(result.rows[0]);
      await repositories.audit.append({
        projectId,
        environment,
        actorType: "user",
        actorRef: context.actor.ref,
        action: "project.api_key.revoked",
        resourceRef: revoked.id,
        status: "success",
        metadata: { kind: revoked.kind, prefix: revoked.prefix },
      });
      return revoked;
    });
  }
}

export class PostgresProjectApiKeyVerifier implements ProjectApiKeyVerifier {
  constructor(private readonly pool: SqlPool) {}

  async authenticate(tokenHash: string): Promise<ProjectApiKeyPrincipal | null> {
    const result = await this.pool.query(
      `SELECT key_id, organization_id, project_id, environment, kind, expires_at
       FROM qkern_authenticate_project_api_key($1)`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.key_id),
      organizationId: String(row.organization_id),
      projectId: String(row.project_id),
      environment: row.environment as Environment,
      kind: row.kind as ProjectApiKeyKind,
      expiresAt: new Date(row.expires_at as string | Date).toISOString(),
    };
  }
}

export function hashProjectApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

export function projectApiKeyToken(kind: ProjectApiKeyKind): string {
  return `qk_${kind}_${randomBytes(32).toString("base64url")}`;
}

function projectApiKeyFromRow(row: Record<string, unknown>): ProjectApiKey {
  if (!row) throw new InvalidRecordError("Invalid project API key record.");
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    name: String(row.name),
    kind: row.kind as ProjectApiKeyKind,
    prefix: String(row.token_prefix),
    expiresAt: new Date(row.expires_at as string | Date).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string | Date).toISOString() : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

function publicKey(record: StoredProjectApiKey): ProjectApiKey {
  const { tokenHash: _tokenHash, createdBy: _createdBy, ...key } = record;
  return { ...key };
}

function principal(record: StoredProjectApiKey): ProjectApiKeyPrincipal {
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    kind: record.kind,
    expiresAt: record.expiresAt,
  };
}
