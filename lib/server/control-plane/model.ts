import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  Approval,
  AuditEvent,
  AutomationMode,
  ChangeSet,
  ChangeStatus,
  Environment,
  Project,
  ProjectAutomationPolicy,
  Risk,
} from "@/lib/types";

export type ControlPlaneActor = {
  id?: string;
  ref: string;
  type?: "user" | "agent" | "system";
};

export type ControlPlaneContext = {
  organizationId: string;
  actor: ControlPlaneActor;
};

export type CreateChangeSetInput = {
  projectId: string;
  environment: Environment;
  title: string;
  statement: string;
};

/**
 * Was zum Anlegen eines Projekts noetig ist (2.147).
 *
 * Drei Felder und nicht mehr. Der Status steht nicht darin: Er ist beim
 * Anlegen immer `provisioning`, weil durch das Anlegen keine Projektdatenbank
 * entsteht, und `ready` waere eine Behauptung ueber eine Datenbank, die es
 * nicht gibt. Der Slug steht darin, weil er aus dem Namen abgeleitet wird und
 * die Ableitung ein reines Modul ist (`lib/console/project-draft`), das die
 * Oberflaeche und die Route gemeinsam benutzen.
 */
export type CreateProjectInput = {
  name: string;
  slug: string;
  region: string;
};

/** Ein geloeschtes Projekt innerhalb seiner Frist (2.173). */
export type DeletedProject = {
  id: string;
  name: string;
  slug: string;
  deletedAt: string;
  deleteAfter: string;
};

/** Wie lange ein geloeschtes Projekt zurueckzuholen ist (2.173), wie in 0087. */
export const PROJECT_DELETION_GRACE_DAYS = 7;

export type DecideApprovalInput = {
  approvalId: string;
  decision: "approved" | "rejected";
};

export type SetAutomationPolicyInput = {
  projectId: string;
  environment: Environment;
  mode: AutomationMode;
  maxAutoRisk: Risk;
  autoQueue: boolean;
  emergencyStop: boolean;
};

/**
 * Eine Umgebung eines Projekts, wie `project_environments` sie fuehrt (2.68).
 *
 * `databaseInstanceRef` ist die undurchsichtige Kennung, die der
 * Provisionierer vergibt (`managed:…`), oder eine wartende Marke
 * (`pending:…`). Sie ist keine Adresse: weder Host noch Port noch Passwort
 * stehen darin, und der Katalog der Verbindungen gibt sie auch nicht her.
 * Genau deshalb darf sie in der Console stehen.
 */
export type ProjectEnvironmentBinding = {
  environment: Environment;
  databaseInstanceRef: string;
  /** false, solange die Referenz wartet und auf keine Datenbank zeigt */
  bound: boolean;
  /** null, wo die Quelle keinen Zeitpunkt fuehrt (der Speicher-Dienst) */
  createdAt: string | null;
};

/**
 * Die drei Umgebungen, die ein Projekt hat, in der Reihenfolge, in der eine
 * Aenderung sie durchlaeuft (2.81).
 *
 * Die Liste ist eine Konstante und kein Ergebnis einer Abfrage, weil genau
 * das die Aussage der Seite ist: Eine Umgebung entsteht nicht auf Zuruf. Wer
 * sie aus `project_environments` lesen wuerde, bekaeme je Projekt die Zeilen,
 * die dort stehen, und koennte eine fehlende Zeile mit einer fehlenden
 * Umgebung verwechseln.
 */
export const FIXED_ENVIRONMENTS: readonly Environment[] = ["development", "staging", "production"];

/** Die Zustaende, die `approval_requests.status` fuehrt. */
export type ApprovalTallyStatus = "pending" | "approved" | "rejected" | "expired";

/** Die Zustaende, die `migration_jobs.status` fuehrt. */
export type MigrationTallyStatus = "queued" | "running" | "applied" | "failed" | "review_required";

/**
 * Eine Zaehlung je Zustand, dazu die Summe und der jeweils juengste Zeitpunkt.
 *
 * Gezaehlt wird in der Datenbank und nicht an einer Liste, die bei 250 Zeilen
 * endet: Eine abgeschnittene Liste ergaebe eine Zahl, die kleiner ist als die
 * Wahrheit, und nichts auf der Seite wuerde das sagen.
 */
export type ChangeFlowTally<Status extends string> = {
  total: number;
  byStatus: Record<Status, number>;
  /** Der juengste `created_at` dieser Umgebung, oder null ohne eine Zeile. */
  latestCreatedAt: string | null;
};

export type ProjectEnvironmentChangeFlow = {
  environment: Environment;
  /**
   * false heisst: Die Kontrollebene fuehrt fuer diese feste Umgebung keine
   * Zeile in `project_environments`. Das ist kein Zweig, der noch fehlt,
   * sondern eine Einrichtung, die noch nicht fertig ist.
   */
  present: boolean;
  /** Die Referenz hat die Form, die der Katalog der Verbindungen annimmt. */
  bound: boolean;
  changeSets: ChangeFlowTally<ChangeStatus>;
  approvals: ChangeFlowTally<ApprovalTallyStatus>;
  /**
   * null heisst: Diese Installation fuehrt keine Warteschlange fuer
   * Migrationen. Lauter Nullen waeren die andere Auskunft, naemlich eine
   * leere Warteschlange, und die beiden sind nicht dasselbe.
   */
  migrations: (ChangeFlowTally<MigrationTallyStatus> & {
    /** Der juengste `finished_at`, also wann hier zuletzt etwas ankam. */
    lastFinishedAt: string | null;
  }) | null;
};

export type ProjectChangeFlow = {
  projectId: string;
  environments: ProjectEnvironmentChangeFlow[];
};

export type ControlPlaneSnapshot = {
  projects: Project[];
  changeSets: ChangeSet[];
  approvals: Approval[];
  audit: AuditEvent[];
};

export interface ControlPlaneService {
  getConsoleSnapshot(context: ControlPlaneContext): Promise<ControlPlaneSnapshot>;
  listProjects(context: ControlPlaneContext): Promise<Project[]>;
  getProject(context: ControlPlaneContext, projectId: string): Promise<Project>;
  getProjectEnvironment(context: ControlPlaneContext, projectId: string, environment: Environment): Promise<Project>;
  /** Alle Umgebungen eines Projekts mit ihrer Datenbankreferenz (2.68), nur lesend. */
  listProjectEnvironments(
    context: ControlPlaneContext,
    projectId: string,
  ): Promise<ProjectEnvironmentBinding[]>;
  /**
   * Was je Umgebung unterwegs und was angekommen ist (2.81), nur lesend.
   *
   * Immer alle drei Umgebungen, auch die ohne eine einzige Zeile: Die Seite
   * soll zeigen, dass die Menge der Umgebungen fest ist, und nicht die Menge
   * der Umgebungen, zu denen zufaellig etwas vorliegt.
   */
  summariseChangeFlow(
    context: ControlPlaneContext,
    projectId: string,
  ): Promise<ProjectChangeFlow>;
  /** Internal opaque target lookup. Connection strings never cross this boundary. */
  getProjectDatabaseTarget(
    context: ControlPlaneContext,
    projectId: string,
    environment: Environment,
  ): Promise<{ databaseInstanceRef: string }>;
  getAutomationPolicy(
    context: ControlPlaneContext,
    projectId: string,
    environment: Environment,
  ): Promise<ProjectAutomationPolicy>;
  setAutomationPolicy(
    context: ControlPlaneContext,
    input: SetAutomationPolicyInput,
  ): Promise<ProjectAutomationPolicy>;
  /**
   * Legt ein Projekt in der eigenen Organisation an (2.147).
   *
   * Das Ergebnis traegt `status: "provisioning"` und die drei festen
   * Umgebungen mit einer wartenden Datenbankreferenz. Ein Slug, der in dieser
   * Organisation schon vergeben ist, ergibt `ProjectSlugTakenError` und keinen
   * Fehler aus dem Treiber.
   */
  createProject(context: ControlPlaneContext, input: CreateProjectInput): Promise<Project>;
  /**
   * Loescht ein Projekt mit Frist (2.173). `confirmName` muss genau der Name
   * des Projekts sein; die Pruefung steht hier und nicht nur in der Console,
   * damit auch ein direkter Aufruf sie nicht umgeht. Danach ist das Projekt
   * fuer jeden Leseweg verschwunden, und bis zum Ablauf der Frist laesst es
   * sich zurueckholen.
   */
  deleteProject(context: ControlPlaneContext, projectId: string, confirmName: string): Promise<DeletedProject>;
  /** Holt ein geloeschtes Projekt vor Ablauf seiner Frist zurueck (2.173). */
  restoreProject(context: ControlPlaneContext, projectId: string): Promise<Project>;
  /** Die geloeschten Projekte der Organisation, deren Frist noch laeuft (2.173). */
  listDeletedProjects(context: ControlPlaneContext): Promise<DeletedProject[]>;
  createChangeSet(context: ControlPlaneContext, input: CreateChangeSetInput): Promise<ChangeSet>;
  decideApproval(context: ControlPlaneContext, input: DecideApprovalInput): Promise<Approval>;
}

/**
 * Der Slug ist in dieser Organisation schon vergeben (2.147).
 *
 * Eigener Fehler und nicht der nackte `ConflictError` aus dem Treiber, weil
 * die Route daraus eine Ablehnung mit Grund machen soll und nicht einen 500er.
 * Der Text nennt auch den Fall, der sonst raetselhaft bleibt: Die Bedingung
 * `UNIQUE (organization_id, slug)` traegt `deleted_at` nicht, ein geloeschtes
 * Projekt haelt seinen Slug also weiter.
 */
export class ProjectSlugTakenError extends Error {
  readonly code = "PROJECT_SLUG_TAKEN";

  constructor(readonly slug: string) {
    super(`A project with the identifier "${slug}" already exists in this organization.`);
    this.name = "ProjectSlugTakenError";
  }
}
recognisedByName(ProjectSlugTakenError, "ProjectSlugTakenError");

/**
 * Der abgetippte Name passt nicht zum Projekt (2.173).
 *
 * Dieselbe Bestaetigung wie in der Console, aber im Dienst geprueft: Wer die
 * Route direkt aufruft, soll nicht mit weniger loeschen koennen als jemand,
 * der den Knopf drueckt.
 */
export class ProjectDeleteConfirmationError extends Error {
  readonly code = "PROJECT_DELETE_CONFIRMATION";

  constructor() {
    super("The confirmation does not match the project name.");
    this.name = "ProjectDeleteConfirmationError";
  }
}
recognisedByName(ProjectDeleteConfirmationError, "ProjectDeleteConfirmationError");

/**
 * Zum Anlegen eines Projekts fehlt ein bestaendiger Nutzer (2.147).
 *
 * `projects.created_by` ist `NOT NULL` und zeigt auf `users`. Ein Agent oder
 * ein Systemaufruf hat keine Zeile dort, und ein erfundener Eintrag waere eine
 * Luege in der Spalte, die sagt, wer das Projekt angelegt hat.
 */
export class MissingProjectActorError extends Error {
  readonly code = "INVALID_PROJECT_ACTOR";

  constructor() {
    super("A persistent user id is required to create a project.");
    this.name = "MissingProjectActorError";
  }
}
recognisedByName(MissingProjectActorError, "MissingProjectActorError");

export class InvalidApprovalArtifactError extends Error {
  readonly code = "APPROVAL_INVALIDATED";

  constructor() {
    super("The approval artifact no longer matches its change set.");
    this.name = "InvalidApprovalArtifactError";
  }
}
recognisedByName(InvalidApprovalArtifactError, "InvalidApprovalArtifactError");

export class MissingDecisionActorError extends Error {
  readonly code = "INVALID_DECISION_ACTOR";

  constructor() {
    super("A persistent user id is required to decide an approval.");
    this.name = "MissingDecisionActorError";
  }
}
recognisedByName(MissingDecisionActorError, "MissingDecisionActorError");

export class MissingPolicyActorError extends Error {
  readonly code = "INVALID_POLICY_ACTOR";

  constructor() {
    super("A persistent user id is required to change an automation policy.");
    this.name = "MissingPolicyActorError";
  }
}
recognisedByName(MissingPolicyActorError, "MissingPolicyActorError");
