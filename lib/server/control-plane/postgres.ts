import {
  ApprovalAlreadyDecidedError,
  ApprovalExpiredError,
  ConflictError,
  InvalidRecordError,
  MigrationNotReadyError,
  ResourceNotFoundError,
} from "@/lib/server/db/errors";
import type { ApprovalRequestRecord, ChangeSetRecord } from "@/lib/server/db/models";
import type { ChangeStatus, Project } from "@/lib/types";
import { PostgresControlPlane, type ControlPlaneRepositories } from "@/lib/server/db/repositories";
import { classifySqlRisk, requiresApproval, validateSingleSqlStatement } from "@/lib/security";
import {
  approvalActionHash,
  hashesMatch,
  sha256,
  type StatementCipher,
} from "@/lib/server/control-plane/crypto";
import {
  approvalFromRecord,
  auditEventFromRecord,
  changeSetFromRecord,
  projectFromRecord,
} from "@/lib/server/control-plane/mappers";
import {
  FIXED_ENVIRONMENTS,
  InvalidApprovalArtifactError,
  MissingDecisionActorError,
  MissingPolicyActorError,
  MissingProjectActorError,
  PROJECT_DELETION_GRACE_DAYS,
  ProjectDeleteConfirmationError,
  ProjectSlugTakenError,
  type ApprovalTallyStatus,
  type ChangeFlowTally,
  type ControlPlaneContext,
  type ControlPlaneService,
  type CreateChangeSetInput,
  type CreateProjectInput,
  type DecideApprovalInput,
  type DeletedProject,
  type MigrationTallyStatus,
  type ProjectChangeFlow,
  type SetAutomationPolicyInput,
} from "@/lib/server/control-plane/model";
import {
  defaultAutomationPolicy,
  policyAllowsAutomaticApproval,
  policyCanAutoQueue,
} from "@/lib/server/control-plane/automation-policy";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";
import { randomUUID } from "node:crypto";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

type ApprovalVerificationRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  project_id: string;
  change_set_id: string;
  environment: ApprovalRequestRecord["environment"];
  action_hash: string;
  status: ApprovalRequestRecord["status"];
  expires_at: string | Date;
  created_at: string | Date;
};

function verificationRecord(row: ApprovalVerificationRow): ApprovalRequestRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    changeSetId: String(row.change_set_id),
    environment: row.environment,
    actionHash: String(row.action_hash),
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Eine Zeile der Zaehlung (2.81): eine Quelle, eine Umgebung, ein Zustand.
 *
 * Die Zahl kommt als Text, weil `count(*)` in PostgreSQL ein `bigint` ist und
 * der Treiber `bigint` als Zeichenkette liefert. Umgerechnet wird erst hier,
 * mit `Number`, denn eine Zahl von Change Sets bleibt weit unter der Grenze,
 * ab der eine Gleitkommazahl ungenau wird.
 */
type ChangeFlowTallyRow = {
  source: "change_set" | "approval" | "migration";
  environment: string;
  status: string;
  total: string;
  latest_created_at: string | Date | null;
  latest_finished_at: string | Date | null;
};

/**
 * Die Zustandslisten stehen hier als Konstante, damit jede Umgebung dieselben
 * Felder traegt, auch die mit einer Null darin. Eine Kachel, die nur bei
 * Bedarf erscheint, liesse die Seite je Projekt anders aussehen.
 */
const CHANGE_STATUSES: readonly ChangeStatus[] =
  ["draft", "validating", "ready", "approved", "applied", "rejected", "failed", "rolled_back"];
const APPROVAL_STATUSES: readonly ApprovalTallyStatus[] = ["pending", "approved", "rejected", "expired"];
const MIGRATION_STATUSES: readonly MigrationTallyStatus[] =
  ["queued", "running", "applied", "failed", "review_required"];

/** Der juengste der uebergebenen Zeitpunkte, oder null, wenn keiner da ist. */
function latestMoment(values: ReadonlyArray<string | Date | null>): string | null {
  const moments = values.flatMap((value) => {
    if (value === null) return [];
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? [parsed] : [];
  });
  return moments.length ? new Date(Math.max(...moments)).toISOString() : null;
}

/**
 * Die Zeilen einer Quelle zu einer Zaehlung, mit einer Null fuer jeden
 * Zustand, der nicht vorkam.
 *
 * Ein Zustand, den diese Liste nicht kennt, laesst die Zaehlung scheitern, und
 * das ist Absicht. Die drei Listen sind die Enums und Check-Bedingungen aus
 * `db/migrations`; kommt dort ein Wert dazu, ohne dass er hier ankommt, waere
 * die Alternative eine Zahl, die zu klein ist, auf einer Seite, deren ganzer
 * Zweck die richtige Zahl ist. Ein Fehler faellt auf, eine falsche Zahl nicht.
 */
function collectTally<Status extends string>(
  rows: ReadonlyArray<ChangeFlowTallyRow>,
  source: ChangeFlowTallyRow["source"],
  statuses: readonly Status[],
): ChangeFlowTally<Status> {
  const mine = rows.filter((row) => row.source === source);
  const known = new Set<string>(statuses);
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<Status, number>;
  let total = 0;
  for (const row of mine) {
    if (!known.has(row.status)) {
      throw new InvalidRecordError(`Unknown ${source} status in the change flow tally: ${row.status}`);
    }
    const count = Number(row.total);
    byStatus[row.status as Status] += count;
    total += count;
  }
  return { total, byStatus, latestCreatedAt: latestMoment(mine.map((row) => row.latest_created_at)) };
}

function expectedActionHash(changeSet: ChangeSetRecord, expiresAt: string, databaseInstanceRef: string): string {
  return approvalActionHash({
    changeSetId: changeSet.id,
    organizationId: changeSet.organizationId,
    projectId: changeSet.projectId,
    environment: changeSet.environment,
    databaseInstanceRef,
    title: changeSet.title,
    statementSha256: changeSet.statementSha256,
    createdBy: changeSet.createdBy,
    risk: changeSet.risk,
    expiresAt,
    requiredScope: "approval:decide",
  });
}

export class PostgresControlPlaneService implements ControlPlaneService {
  constructor(
    private readonly database: TenantRepositoryProvider,
    private readonly cipher: StatementCipher,
    private readonly approvalTtlMs = 24 * 60 * 60 * 1_000,
  ) {
    if (!Number.isInteger(approvalTtlMs) || approvalTtlMs < 60_000 || approvalTtlMs > 7 * 24 * 60 * 60 * 1_000) {
      throw new InvalidRecordError("approvalTtlMs must be between one minute and seven days.");
    }
  }

  async getConsoleSnapshot(context: ControlPlaneContext) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const projects = await repositories.projects.list();
      const environmentRecords = await repositories.environments.list();
      const changeRecords = await repositories.changeSets.list();
      const approvalRecords = await repositories.approvals.list();
      const auditRecords = await repositories.audit.list();
      const changeSets = changeRecords.map((record) => changeSetFromRecord(record, this.cipher));
      const changeSetsById = new Map(changeSets.map((changeSet) => [changeSet.id, changeSet]));
      const environmentsByProject = new Map(environmentRecords.map((record) => [record.projectId, record.environment]));
      return {
        projects: projects.map((project) => projectFromRecord(project, environmentsByProject.get(project.id))),
        changeSets,
        approvals: approvalRecords.flatMap((approval) => {
          const changeSet = changeSetsById.get(approval.changeSetId);
          if (!changeSet) return [];
          const mapped = approvalFromRecord(approval, changeSet);
          return mapped ? [mapped] : [];
        }),
        audit: auditRecords.flatMap((record) => {
          const mapped = auditEventFromRecord(record);
          return mapped ? [mapped] : [];
        }),
      };
    });
  }

  async listProjects(context: ControlPlaneContext) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const [projects, environments] = await Promise.all([repositories.projects.list(), repositories.environments.list()]);
      const environmentByProject = new Map(environments.map((record) => [record.projectId, record.environment]));
      return projects.map((record) => projectFromRecord(record, environmentByProject.get(record.id)));
    });
  }

  async getProject(context: ControlPlaneContext, projectId: string) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => projectFromRecord(await repositories.projects.get(projectId)));
  }

  async getProjectEnvironment(context: ControlPlaneContext, projectId: string, environment: import("@/lib/types").Environment) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      const [project] = await Promise.all([
        repositories.projects.get(projectId),
        repositories.environments.get(projectId, environment),
      ]);
      return projectFromRecord(project, environment);
    });
  }

  /**
   * Die Umgebungen eines Projekts mit ihrer Datenbankreferenz (2.68).
   *
   * `projects.get` steht zuerst, damit ein fremdes oder geloeschtes Projekt
   * ein "nicht gefunden" ergibt und nicht eine leere Liste; eine leere Liste
   * waere die Behauptung, das Projekt habe keine Umgebung.
   */
  async listProjectEnvironments(context: ControlPlaneContext, projectId: string) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      await repositories.projects.get(projectId);
      const records = await repositories.environments.list(projectId);
      return records.map((record) => ({
        environment: record.environment,
        databaseInstanceRef: record.databaseInstanceRef,
        // Gebunden heisst: Die Referenz hat die Form, die der Katalog der
        // Verbindungen ueberhaupt annimmt. Ob dahinter eine erreichbare
        // Datenbank steht, sagt diese Zeile nicht.
        bound: isCatalogReference(record.databaseInstanceRef),
        createdAt: record.createdAt,
      }));
    });
  }

  /**
   * Was je Umgebung unterwegs und was angekommen ist (2.81).
   *
   * Eine Abfrage, drei Quellen, gezaehlt in der Datenbank. Die Repositories
   * haben nur `list` mit einer Obergrenze von 250 Zeilen; eine Zahl daraus
   * waere ab der 251. Zeile falsch, und niemand saehe es. Darum die Zaehlung
   * hier, ueber `repositories.transaction`, also in derselben Transaktion,
   * unter derselben Laufzeitrolle und damit unter denselben Policies wie jede
   * andere Leseabfrage der Kontrollebene.
   *
   * `projects.get` steht zuerst, damit ein fremdes Projekt ein "nicht
   * gefunden" ergibt und nicht drei Umgebungen mit lauter Nullen. Lauter
   * Nullen waeren die Behauptung, es liege nichts vor.
   */
  async summariseChangeFlow(context: ControlPlaneContext, projectId: string): Promise<ProjectChangeFlow> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      await repositories.projects.get(projectId);
      const bindings = await repositories.environments.list(projectId);
      const tally = await repositories.transaction.query<ChangeFlowTallyRow>(
        `SELECT 'change_set' AS source, environment::text AS environment, status::text AS status,
                count(*)::text AS total, max(created_at) AS latest_created_at,
                NULL::timestamptz AS latest_finished_at
         FROM change_sets
         WHERE organization_id = $1 AND project_id = $2
         GROUP BY 2, 3
         UNION ALL
         SELECT 'approval', environment::text, status::text,
                count(*)::text, max(created_at), NULL::timestamptz
         FROM approval_requests
         WHERE organization_id = $1 AND project_id = $2
         GROUP BY 2, 3
         UNION ALL
         SELECT 'migration', environment::text, status::text,
                count(*)::text, max(created_at), max(finished_at)
         FROM migration_jobs
         WHERE organization_id = $1 AND project_id = $2
         GROUP BY 2, 3`,
        [context.organizationId, projectId],
      );
      const bindingByEnvironment = new Map(bindings.map((record) => [record.environment, record]));
      return {
        projectId,
        environments: FIXED_ENVIRONMENTS.map((environment) => {
          const binding = bindingByEnvironment.get(environment);
          const rows = tally.rows.filter((row) => row.environment === environment);
          return {
            environment,
            present: Boolean(binding),
            bound: binding ? isCatalogReference(binding.databaseInstanceRef) : false,
            changeSets: collectTally(rows, "change_set", CHANGE_STATUSES),
            approvals: collectTally(rows, "approval", APPROVAL_STATUSES),
            // Die Warteschlange ist Teil dieser Kontrollebene, darum nie null.
            migrations: {
              ...collectTally(rows, "migration", MIGRATION_STATUSES),
              lastFinishedAt: latestMoment(rows.filter((row) => row.source === "migration")
                .map((row) => row.latest_finished_at)),
            },
          };
        }),
      };
    });
  }

  async getProjectDatabaseTarget(context: ControlPlaneContext, projectId: string, environment: import("@/lib/types").Environment) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      await repositories.projects.get(projectId);
      const target = await repositories.environments.get(projectId, environment);
      return { databaseInstanceRef: target.databaseInstanceRef };
    });
  }

  async getAutomationPolicy(
    context: ControlPlaneContext,
    projectId: string,
    environment: import("@/lib/types").Environment,
  ) {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => {
      await repositories.environments.get(projectId, environment);
      return await repositories.automationPolicies.get(projectId, environment) ??
        defaultAutomationPolicy(context.organizationId, projectId, environment);
    });
  }

  async setAutomationPolicy(context: ControlPlaneContext, input: SetAutomationPolicyInput) {
    if (!context.actor.id || (context.actor.type ?? "user") !== "user") {
      throw new MissingPolicyActorError();
    }
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      await repositories.environments.get(input.projectId, input.environment);
      const policy = await repositories.automationPolicies.set({
        ...input,
        updatedBy: context.actor.id!,
      });
      await repositories.audit.append({
        projectId: input.projectId,
        environment: input.environment,
        actorType: "user",
        actorRef: context.actor.ref,
        action: "automation.policy.updated",
        resourceRef: `${input.projectId}:${input.environment}`,
        status: input.emergencyStop ? "blocked" : "success",
        metadata: {
          mode: input.mode,
          maxAutoRisk: input.maxAutoRisk,
          autoQueue: input.autoQueue,
          emergencyStop: input.emergencyStop,
          revision: policy.revision,
        },
      });
      return policy;
    });
  }

  /**
   * Legt ein Projekt an (2.147).
   *
   * **Eine Transaktion.** Die Projektzeile, die drei Umgebungen und der
   * Audit-Eintrag entstehen zusammen oder gar nicht. Ein Projekt ohne seine
   * Umgebungen waere eine halbe Einrichtung, die niemandem auffaellt, und ein
   * Anlegen ohne Audit-Eintrag waere eine Luecke in der Kette.
   *
   * **Der Status ist `provisioning`.** Durch dieses Anlegen entsteht keine
   * Projektdatenbank; es entsteht eine Zeile in der Kontrollebene. `ready`
   * waere die Behauptung, man koenne jetzt eine Migration anwenden, und genau
   * das lehnen `createChangeSet` und die Warteschlange ab, solange die
   * Referenz wartet.
   *
   * **`database_instance_ref` ist `pending:<Projekt-Id>`.** Das ist kein
   * erfundener Platzhalter, sondern die Marke, die QKERN an dieser Stelle schon
   * fuehrt: `lib/server/tenancy-postgres.ts` schreibt sie beim Einrichten
   * einer Organisation, der Provisionierer verlangt sie als Ausgangszustand
   * (`ProjectProvisioningNotReadyError`, wenn sie fehlt), `isCatalogReference`
   * liest sie als "nicht gebunden", und `bindProvisioned` tauscht nur eine
   * solche Marke gegen eine echte Referenz. Die Spalte ist `NOT NULL`, und die
   * drei Umgebungen weglassen hiesse, die Einrichtung auf eine spaetere
   * Bestellung zu verschieben, die ohne diese Zeilen keinen Angriffspunkt hat.
   *
   * **Der Slug wird zuerst gelesen, dann geschrieben.** Das Lesen ist die
   * Hoeflichkeit, die aus einem Treiberfehler eine Ablehnung mit Grund macht;
   * der Fang um das INSERT ist die Wahrheit, denn zwischen Lesen und Schreiben
   * kann ein zweiter Aufruf denselben Slug nehmen. Beide Wege enden in
   * `ProjectSlugTakenError`, damit die Route einen Fall behandelt und nicht
   * zwei.
   *
   * **Der Audit-Eintrag traegt keine Umgebung.** Ein Projekt anzulegen ist
   * keine Handlung in `development`, `staging` oder `production`, und die
   * Spalte laesst NULL zu. Die Folge steht im Bericht: Die Aktivitaetsliste der
   * Console laesst Eintraege ohne Umgebung weg (`auditEventFromRecord`), der
   * Eintrag steht also in der Kette und in der Datenbank, aber nicht auf jener
   * Seite. Eine erfundene Umgebung waere der schlechtere Tausch.
   */
  async deleteProject(context: ControlPlaneContext, projectId: string, confirmName: string): Promise<DeletedProject> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      const project = await repositories.projects.get(projectId);
      if (confirmName !== project.name) throw new ProjectDeleteConfirmationError();
      const marked = await repositories.projects.markDeleted(projectId);
      await repositories.audit.append({
        projectId,
        environment: null,
        actorType: context.actor.type ?? "user",
        actorRef: context.actor.ref,
        action: "project.deleted",
        resourceRef: projectId,
        status: "success",
        metadata: { slug: project.slug, deleteAfter: marked.deleteAfter, graceDays: PROJECT_DELETION_GRACE_DAYS },
      });
      // Wie in `listDeleted`: Eine Datenbank hat das Projekt, sobald eine
      // Umgebung auf `managed:` zeigt; abgebaut wird sie erst nach der Frist.
      const databases = await repositories.transaction.query(
        `SELECT count(*)::integer AS count FROM project_environments
         WHERE organization_id = $1 AND project_id = $2 AND database_instance_ref LIKE 'managed:%'`,
        [context.organizationId, projectId],
      );
      return {
        id: project.id, name: project.name, slug: project.slug, ...marked,
        state: "restorable",
        databaseTeardown: Number(databases.rows[0]?.count ?? 0) > 0 ? "pending" : "none",
      };
    });
  }

  async restoreProject(context: ControlPlaneContext, projectId: string): Promise<Project> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      await repositories.projects.restore(projectId);
      const project = await repositories.projects.get(projectId);
      await repositories.audit.append({
        projectId,
        environment: null,
        actorType: context.actor.type ?? "user",
        actorRef: context.actor.ref,
        action: "project.restored",
        resourceRef: projectId,
        status: "success",
        metadata: { slug: project.slug },
      });
      return projectFromRecord(project, FIXED_ENVIRONMENTS[0]);
    });
  }

  async listDeletedProjects(context: ControlPlaneContext): Promise<DeletedProject[]> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories) => repositories.projects.listDeleted());
  }

  async createProject(context: ControlPlaneContext, input: CreateProjectInput): Promise<Project> {
    const createdBy = context.actor.id;
    if (!createdBy || (context.actor.type ?? "user") !== "user") throw new MissingProjectActorError();
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      if (await repositories.projects.slugTaken(input.slug)) throw new ProjectSlugTakenError(input.slug);
      let project;
      try {
        project = await repositories.projects.create({
          name: input.name,
          slug: input.slug,
          region: input.region,
          createdBy,
          status: "provisioning",
        });
      } catch (error) {
        if (error instanceof ConflictError) throw new ProjectSlugTakenError(input.slug);
        throw error;
      }
      for (const environment of FIXED_ENVIRONMENTS) {
        await repositories.environments.createPending(project.id, environment, `pending:${project.id}`);
      }
      await repositories.audit.append({
        projectId: project.id,
        environment: null,
        actorType: "user",
        actorRef: context.actor.ref,
        action: "project.created",
        resourceRef: project.id,
        status: "success",
        metadata: {
          slug: project.slug,
          region: project.region,
          status: project.status,
          environments: [...FIXED_ENVIRONMENTS],
          databaseProvisioned: false,
        },
      });
      // Die Umgebung in der Antwort ist die erste der festen Reihe, also die,
      // in der eine Aenderung beginnt. Sie sagt nicht, dass dort schon etwas
      // laeuft: `status` sagt `provisioning`, und jede Umgebung wartet.
      return projectFromRecord(project, FIXED_ENVIRONMENTS[0]);
    });
  }

  async createChangeSet(context: ControlPlaneContext, input: CreateChangeSetInput) {
    const validation = validateSingleSqlStatement(input.statement);
    if (!validation.valid) throw new InvalidRecordError(`INVALID_SQL:${validation.reason}`);

    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      await repositories.projects.get(input.projectId);
      const environment = await repositories.environments.get(input.projectId, input.environment);
      if (environment.databaseInstanceRef.startsWith("pending:")) throw new MigrationNotReadyError();
      const policy = await repositories.automationPolicies.get(input.projectId, input.environment) ??
        defaultAutomationPolicy(context.organizationId, input.projectId, input.environment);
      const changeSetId = randomUUID();
      const statementSha256 = sha256(input.statement);
      const risk = classifySqlRisk(input.statement, input.environment);
      const created = await repositories.changeSets.create({
        id: changeSetId,
        projectId: input.projectId,
        environment: input.environment,
        title: input.title,
        statementSha256,
        encryptedStatement: this.cipher.encrypt(input.statement, {
          changeSetId,
          organizationId: context.organizationId,
          projectId: input.projectId,
          environment: input.environment,
          statementSha256,
        }),
        risk,
        status: "ready",
        createdBy: context.actor.id ?? null,
      });

      const automaticApproval = policyAllowsAutomaticApproval(policy, input.statement, risk);
      const approvalRequired = requiresApproval(input.statement, input.environment) || automaticApproval;
      let approval: ApprovalRequestRecord | null = null;
      if (approvalRequired) {
        const expiresAt = new Date(Date.now() + this.approvalTtlMs);
        approval = await repositories.approvals.create({
          projectId: input.projectId,
          changeSetId: created.id,
          environment: input.environment,
          actionHash: expectedActionHash(created, expiresAt.toISOString(), environment.databaseInstanceRef),
          expiresAt,
        });
      }
      if (approval && automaticApproval) {
        const decision = await repositories.approvals.decide(approval.id, "approved", {
          type: "system",
          ref: `qkern-automation-policy:${policy.revision}`,
        });
        approval = decision.approval;
        await repositories.audit.append({
          projectId: input.projectId,
          environment: input.environment,
          actorType: "system",
          actorRef: `qkern-automation-policy:${policy.revision}`,
          action: "approval.automatically_approved",
          resourceRef: approval.id,
          status: "success",
          metadata: { policyMode: policy.mode, policyRevision: policy.revision, risk },
        });
        if (policyCanAutoQueue(policy)) {
          const queued = await repositories.migrationJobs.enqueueApproved(created.id, approval.id);
          await repositories.audit.append({
            projectId: input.projectId,
            environment: input.environment,
            actorType: "system",
            actorRef: `qkern-automation-policy:${policy.revision}`,
            action: "migration.apply.automatically_queued",
            resourceRef: queued.job.id,
            status: "pending",
            metadata: { changeSetId: created.id, policyRevision: policy.revision },
          });
        }
      }
      await repositories.audit.append({
        projectId: input.projectId,
        environment: input.environment,
        actorType: context.actor.type ?? "user",
        actorRef: context.actor.ref,
        action: "qkern_migration_preview",
        resourceRef: created.id,
        status: approval && !automaticApproval ? "pending" : "success",
        metadata: {
          statementSha256,
          risk,
          automationMode: policy.mode,
          automaticApproval,
          automaticQueue: automaticApproval && policyCanAutoQueue(policy),
          policyRevision: policy.revision,
        },
      });
      return changeSetFromRecord(
        automaticApproval ? { ...created, status: "approved" } : created,
        this.cipher,
      );
    });
  }

  async decideApproval(context: ControlPlaneContext, input: DecideApprovalInput) {
    const actorId = context.actor.id;
    if (!actorId) throw new MissingDecisionActorError();
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories) => {
      const approval = await this.lockApprovalArtifact(repositories, input.approvalId);
      if (approval.status !== "pending") throw new ApprovalAlreadyDecidedError();
      if (Date.parse(approval.expiresAt) <= Date.now()) throw new ApprovalExpiredError();

      const changeRecord = await repositories.changeSets.get(approval.changeSetId);
      const environment = await repositories.environments.get(changeRecord.projectId, changeRecord.environment);
      if (environment.databaseInstanceRef.startsWith("pending:")) throw new InvalidApprovalArtifactError();
      const plaintext = this.cipher.decrypt(changeRecord.encryptedStatement, {
        changeSetId: changeRecord.id,
        organizationId: changeRecord.organizationId,
        projectId: changeRecord.projectId,
        environment: changeRecord.environment,
        statementSha256: changeRecord.statementSha256,
      });
      if (!hashesMatch(sha256(plaintext), changeRecord.statementSha256) ||
          !hashesMatch(approval.actionHash, expectedActionHash(
            changeRecord, approval.expiresAt, environment.databaseInstanceRef,
          ))) {
        throw new InvalidApprovalArtifactError();
      }
      const result = await repositories.approvals.decide(input.approvalId, input.decision, {
        id: actorId,
        type: "user",
        ref: context.actor.ref,
      });
      await repositories.audit.append({
        projectId: result.approval.projectId,
        environment: result.approval.environment,
        actorType: context.actor.type ?? "user",
        actorRef: context.actor.ref,
        action: `approval.${input.decision}`,
        resourceRef: result.approval.id,
        status: input.decision === "approved" ? "success" : "blocked",
        metadata: { actionHash: result.approval.actionHash },
      });
      const changeSet = changeSetFromRecord({ ...changeRecord, status: input.decision }, this.cipher);
      const mapped = approvalFromRecord(result.approval, changeSet);
      if (!mapped) throw new InvalidApprovalArtifactError();
      return mapped;
    });
  }

  private async lockApprovalArtifact(repositories: ControlPlaneRepositories, approvalId: string): Promise<ApprovalRequestRecord> {
    const result = await repositories.transaction.query<ApprovalVerificationRow>(
      `SELECT approval.id, approval.organization_id, approval.project_id, approval.change_set_id,
              approval.environment, approval.action_hash, approval.status, approval.expires_at, approval.created_at
       FROM approval_requests AS approval
       JOIN change_sets AS change_set
         ON change_set.organization_id = approval.organization_id
        AND change_set.project_id = approval.project_id
        AND change_set.environment = approval.environment
        AND change_set.id = approval.change_set_id
       WHERE approval.organization_id = $1 AND approval.id = $2
       FOR UPDATE OF approval, change_set`,
      [repositories.transaction.organizationId, approvalId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Approval request");
    return verificationRecord(result.rows[0]);
  }
}

export function createPostgresControlPlaneService(
  database: PostgresControlPlane,
  cipher: StatementCipher,
  approvalTtlMs?: number,
): PostgresControlPlaneService {
  return new PostgresControlPlaneService(database, cipher, approvalTtlMs);
}
