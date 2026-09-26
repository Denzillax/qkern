import { recognisedByName } from "@/lib/server/errors/identity";
import type { ProjectAuthScope } from "@/lib/server/project-auth/model";

/**
 * Audit-Ereignisse von Project Auth (2.35), wie bei Supabase unter
 * Authentication, Audit Logs.
 *
 * Die Ereignisse landen in der Hash-Kette der Plattform (`audit_logs`), nicht
 * in einer eigenen Tabelle: dieselbe Append-only-Garantie, dieselbe Pruefung
 * der Kette. Was hineingeht, ist bewusst arm: Nutzer erscheinen nur als
 * `project_auth_user:<id>`, nie mit ihrer E-Mail; Token, Passwoerter und
 * Codes erscheinen gar nicht. `sanitizeProjectAuthAuditEvent` setzt das
 * durch, auch wenn ein Aufrufer sich irrt, bevor irgendein Sink schreibt.
 */
export type ProjectAuthAuditActorType = "app_user" | "admin" | "system";
export type ProjectAuthAuditStatus = "succeeded" | "failed";
export type ProjectAuthAuditMetadata = Record<string, string | number | boolean>;

export type ProjectAuthAuditEvent = {
  scope: ProjectAuthScope;
  action: string;
  actorType: ProjectAuthAuditActorType;
  actorRef: string;
  resourceRef: string;
  status: ProjectAuthAuditStatus;
  metadata?: ProjectAuthAuditMetadata;
};

export type ProjectAuthAuditEntry = {
  id: string;
  createdAt: string;
  actorType: string;
  actorRef: string;
  action: string;
  resourceRef: string;
  status: string;
  metadata: ProjectAuthAuditMetadata;
};

export type ProjectAuthAuditPage = { events: ProjectAuthAuditEntry[]; nextCursor: string | null };

export interface ProjectAuthAuditSink {
  record(event: ProjectAuthAuditEvent): Promise<void>;
  /** Neueste zuerst, nur `project_auth.*` im exakten Scope. `cursor` ist die ID des letzten Eintrags. */
  list(scope: ProjectAuthScope, input: { limit: number; cursor?: string }): Promise<ProjectAuthAuditPage>;
}

export class InvalidProjectAuthAuditEventError extends Error {
  constructor() {
    super("Invalid Project Auth audit event");
    this.name = "InvalidProjectAuthAuditEventError";
  }
}
recognisedByName(InvalidProjectAuthAuditEventError, "InvalidProjectAuthAuditEventError");

const ACTION = /^project_auth\.[a-z_]{1,40}(\.[a-z_]{1,40})?$/;
// Referenzen bestehen aus Praefix und ID. Kein "@", kein Leerzeichen: eine
// E-Mail kann so weder Akteur noch Ressource werden.
const REFERENCE = /^[A-Za-z0-9_:.-]{1,160}$/;
const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const METADATA_TEXT = /^[A-Za-z0-9_:.-]{0,80}$/;
const MAX_METADATA_KEYS = 12;

/**
 * Prueft Aktion und Referenzen streng (ein Verstoss ist ein Programmierfehler
 * und wirft) und laesst von den Metadaten nur kurze, harmlose Werte durch.
 * Ein Wert, der wie ein QKERN-Token aussieht (`qk_...`), oder ein Text mit
 * "@" faellt still weg, statt geschrieben zu werden.
 */
export function sanitizeProjectAuthAuditEvent(event: ProjectAuthAuditEvent): ProjectAuthAuditEvent {
  if (!ACTION.test(event.action) || !REFERENCE.test(event.actorRef) || !REFERENCE.test(event.resourceRef) ||
      !["app_user", "admin", "system"].includes(event.actorType) ||
      !["succeeded", "failed"].includes(event.status)) {
    throw new InvalidProjectAuthAuditEventError();
  }
  const metadata: ProjectAuthAuditMetadata = {};
  for (const [key, value] of Object.entries(event.metadata ?? {})) {
    if (Object.keys(metadata).length >= MAX_METADATA_KEYS || !METADATA_KEY.test(key)) continue;
    if (typeof value === "boolean") metadata[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) metadata[key] = value;
    else if (typeof value === "string" && METADATA_TEXT.test(value) && !value.toLowerCase().startsWith("qk_")) {
      metadata[key] = value;
    }
  }
  return { ...event, metadata };
}

export function projectAuthUserRef(userId: string): string {
  return `project_auth_user:${userId}`;
}

/** Fuer Entwicklung und Tests: dieselbe Bereinigung, dieselbe Reihenfolge wie PostgreSQL. */
export class MemoryProjectAuthAuditSink implements ProjectAuthAuditSink {
  private readonly entries: Array<ProjectAuthAuditEntry & { scope: ProjectAuthScope }> = [];
  private sequence = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async record(event: ProjectAuthAuditEvent): Promise<void> {
    const clean = sanitizeProjectAuthAuditEvent(event);
    this.sequence += 1;
    this.entries.push({
      scope: { ...clean.scope },
      id: `00000000-0000-4000-a000-${String(this.sequence).padStart(12, "0")}`,
      createdAt: this.now().toISOString(),
      actorType: clean.actorType,
      actorRef: clean.actorRef,
      action: clean.action,
      resourceRef: clean.resourceRef,
      status: clean.status,
      metadata: { ...clean.metadata },
    });
  }

  async list(scope: ProjectAuthScope, input: { limit: number; cursor?: string }): Promise<ProjectAuthAuditPage> {
    const matching = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.scope.organizationId === scope.organizationId &&
        entry.scope.projectId === scope.projectId && entry.scope.environment === scope.environment)
      .sort((left, right) => right.entry.createdAt.localeCompare(left.entry.createdAt) || right.index - left.index)
      .map(({ entry }) => entry);
    let start = 0;
    if (input.cursor) {
      const position = matching.findIndex((entry) => entry.id === input.cursor);
      if (position < 0) return { events: [], nextCursor: null };
      start = position + 1;
    }
    const page = matching.slice(start, start + input.limit + 1);
    const events = page.slice(0, input.limit).map(({ scope: _scope, ...entry }) => ({ ...entry, metadata: { ...entry.metadata } }));
    return { events, nextCursor: page.length > input.limit ? events[events.length - 1].id : null };
  }
}
