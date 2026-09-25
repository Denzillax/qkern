import { recognisedByName } from "@/lib/server/errors/identity";
import {
  isProjectDatabaseProvisioningErrorCode,
  type ProjectDatabaseBindingRecord,
  type ProjectDatabaseProvisioningErrorCode,
  type ProjectDatabaseProvisioningJobRecord,
} from "@/lib/server/db/models";
import { isIP } from "node:net";
import { RepositoryError, type RepositoryErrorCode } from "@/lib/server/db/errors";
import type { Environment } from "@/lib/types";
import { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";
import {
  safeRuntimeProbe,
  type RuntimeProbeObserver,
} from "@/lib/server/operations/runtime-probe";

export { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";

export type ProjectDatabaseProvisioningRequest = Readonly<{
  provisioningJobId: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  region: string;
  bootstrapContractSha256: typeof PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256;
}>;

export type ProvisionedProjectDatabaseBinding = Readonly<{
  databaseInstanceRef: string;
  vaultStaticRole: string;
  host: string;
  port: number;
  expectedRole: string;
  expectedDatabase: string;
  expectedLedgerOwner: string;
  serverCertificateSha256: string;
  bootstrapContractSha256: string;
}>;

export interface ProjectDatabaseProvisioningAdapter {
  provision(
    request: ProjectDatabaseProvisioningRequest,
    options: { signal?: AbortSignal },
  ): Promise<ProvisionedProjectDatabaseBinding>;
}

export class ProjectDatabaseProvisioningAdapterError extends Error {
  readonly failureCode: ProjectDatabaseProvisioningErrorCode;
  constructor(failureCode: ProjectDatabaseProvisioningErrorCode) {
    super("Project database provisioning failed.");
    this.name = "ProjectDatabaseProvisioningAdapterError";
    this.failureCode = isProjectDatabaseProvisioningErrorCode(failureCode)
      ? failureCode
      : "PROVIDER_UNAVAILABLE";
  }
}
recognisedByName(ProjectDatabaseProvisioningAdapterError, "ProjectDatabaseProvisioningAdapterError");

export type ProjectDatabaseProvisioningClaim = Readonly<{
  job: ProjectDatabaseProvisioningJobRecord;
  region: string;
}>;

export interface ProjectDatabaseProvisioningPort {
  heartbeat(provisionerId: string): Promise<void>;
  quarantineExpired(provisionerId: string): Promise<ProjectDatabaseProvisioningJobRecord[]>;
  claimNext(provisionerId: string, leaseDurationMs?: number): Promise<ProjectDatabaseProvisioningClaim | null>;
  complete(
    claim: ProjectDatabaseProvisioningClaim,
    provisionerId: string,
    leaseToken: string,
    binding: ProvisionedProjectDatabaseBinding,
  ): Promise<{ job: ProjectDatabaseProvisioningJobRecord; binding: ProjectDatabaseBindingRecord }>;
  recordFailure(
    claim: ProjectDatabaseProvisioningClaim,
    provisionerId: string,
    leaseToken: string,
    errorCode: ProjectDatabaseProvisioningErrorCode,
    backoffMs?: number,
  ): Promise<ProjectDatabaseProvisioningJobRecord>;
  releaseAfterAbort(
    claim: ProjectDatabaseProvisioningClaim,
    provisionerId: string,
    leaseToken: string,
    backoffMs?: number,
  ): Promise<ProjectDatabaseProvisioningJobRecord>;
}

export type ProjectDatabaseProvisioningLogEvent = Readonly<{
  event: "project_database_provisioning.claimed" | "project_database_provisioning.succeeded" |
    "project_database_provisioning.retry_scheduled" | "project_database_provisioning.failed" |
    "project_database_provisioning.lease_lost" | "project_database_provisioning.claim_failed" |
    "project_database_provisioning.aborted" | "project_database_provisioning.expired_lease_quarantined";
  status: string;
  organizationId?: string;
  projectId?: string;
  environment?: Environment;
  jobId?: string;
  attempt?: number;
  retryCycle?: number;
  errorCode?: ProjectDatabaseProvisioningErrorCode | "CONTROL_PLANE_UPDATE_FAILED";
  /**
   * Welcher der drei Aufrufe der Runde gescheitert ist.
   *
   * Bis Release 1.66 meldete `claim_failed` nur sich selbst. Release 1.59 hat
   * daraufhin die falsche Stelle vermutet, 1.60 sie ausgeschlossen, und erst
   * 1.61 fand den Heartbeat — drei Releases fuer eine Frage, die diese Zeile
   * beantwortet haette.
   */
  step?: ProvisioningStep;
  /**
   * Die Fehlerklasse, nicht die Fehlermeldung.
   *
   * Fest und aufzaehlbar: die Codes aus `RepositoryError`, sonst `UNKNOWN`.
   * Eine Datenbankmeldung gehoert nicht in ein Prozesslog — sie kann Tabellen-
   * und Spaltennamen fremder Mandanten tragen.
   */
  reason?: RepositoryErrorCode | "UNKNOWN";
}>;

export type ProvisioningStep = "heartbeat" | "quarantine" | "claim";

/** Fixer Code statt Meldung. Alles Unbekannte wird zu `UNKNOWN`. */
function failureReason(error: unknown): RepositoryErrorCode | "UNKNOWN" {
  return error instanceof RepositoryError ? error.code : "UNKNOWN";
}

export type ProjectDatabaseProvisioningWorkerResult =
  | { status: "idle" | "claim_failed" }
  | { status: "aborted"; jobId?: string }
  | { status: "succeeded" | "retry_scheduled" | "failed" | "lease_lost"; jobId: string };

export type ProjectDatabaseProvisioningWorkerOptions = {
  provisionerId: string;
  leaseDurationMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  idleDelayMs?: number;
  logger?: { log(event: ProjectDatabaseProvisioningLogEvent): void };
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  probe?: RuntimeProbeObserver;
};

const silentLogger = { log: (_event: ProjectDatabaseProvisioningLogEvent) => undefined };

export class ProjectDatabaseProvisioningWorker {
  private readonly provisionerId: string;
  private readonly leaseDurationMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly idleDelayMs: number;
  private readonly logger: { log(event: ProjectDatabaseProvisioningLogEvent): void };
  private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => Date;
  private readonly probe?: RuntimeProbeObserver;
  private activeOnce?: Promise<ProjectDatabaseProvisioningWorkerResult>;
  private loopRunning = false;

  constructor(
    private readonly port: ProjectDatabaseProvisioningPort,
    private readonly adapter: ProjectDatabaseProvisioningAdapter,
    options: ProjectDatabaseProvisioningWorkerOptions,
  ) {
    this.provisionerId = boundedReference(options.provisionerId);
    this.leaseDurationMs = boundedInteger(options.leaseDurationMs ?? 60_000, 1_000, 900_000);
    this.retryBaseDelayMs = boundedInteger(options.retryBaseDelayMs ?? 1_000, 100, 60_000);
    this.retryMaxDelayMs = boundedInteger(options.retryMaxDelayMs ?? 60_000, this.retryBaseDelayMs, 86_400_000);
    this.idleDelayMs = boundedInteger(options.idleDelayMs ?? 1_000, 10, 60_000);
    this.logger = options.logger ?? silentLogger;
    this.delay = options.delay ?? abortableDelay;
    this.now = options.now ?? (() => new Date());
    this.probe = options.probe;
  }

  runOnce(signal?: AbortSignal): Promise<ProjectDatabaseProvisioningWorkerResult> {
    if (this.activeOnce) return this.activeOnce;
    const operation = this.processOnce(signal).finally(() => {
      if (this.activeOnce === operation) this.activeOnce = undefined;
    });
    this.activeOnce = operation;
    return operation;
  }

  async run(signal: AbortSignal): Promise<void> {
    if (this.loopRunning) throw new Error("The project database provisioner is already running.");
    this.loopRunning = true;
    safeRuntimeProbe(this.probe, "runtimeStarted");
    try {
      while (!signal.aborted) {
        let result: ProjectDatabaseProvisioningWorkerResult;
        try {
          result = await this.runOnce(signal);
        } catch (error) {
          safeRuntimeProbe(this.probe, "iterationFailed");
          throw error;
        }
        if (signal.aborted || result.status === "aborted") break;
        safeRuntimeProbe(
          this.probe,
          result.status === "claim_failed" ? "iterationFailed" : "iterationSucceeded",
        );
        if (result.status === "idle" || result.status === "claim_failed") {
          try { await this.delay(this.idleDelayMs, signal); } catch (error) {
            if (signal.aborted || isAbortError(error)) break;
            throw error;
          }
        }
      }
    } finally {
      this.loopRunning = false;
      safeRuntimeProbe(this.probe, "runtimeStopped");
    }
  }

  private async processOnce(signal?: AbortSignal): Promise<ProjectDatabaseProvisioningWorkerResult> {
    if (signal?.aborted) return { status: "aborted" };
    // Drei Aufrufe, drei Schritte. Sie standen bis Release 1.66 in zwei
    // Bloecken, deren `catch` nichts ueber die Stelle sagte.
    const claimFailed = (step: ProvisioningStep, error: unknown) => {
      safeLog(this.logger, {
        event: "project_database_provisioning.claim_failed",
        status: "claim_failed",
        step,
        reason: failureReason(error),
      });
      return { status: "claim_failed" } as const;
    };

    try {
      await this.port.heartbeat(this.provisionerId);
    } catch (error) { return claimFailed("heartbeat", error); }

    try {
      const expired = await this.port.quarantineExpired(this.provisionerId);
      for (const job of expired) safeLog(this.logger, log(job, "expired_lease_quarantined", "PROVIDER_UNAVAILABLE"));
    } catch (error) { return claimFailed("quarantine", error); }

    let claim: ProjectDatabaseProvisioningClaim | null;
    try {
      claim = await this.port.claimNext(this.provisionerId, this.leaseDurationMs);
    } catch (error) { return claimFailed("claim", error); }
    if (!claim) return { status: "idle" };
    if (!validClaim(claim, this.provisionerId, this.now())) {
      safeLog(this.logger, log(claim.job, "lease_lost"));
      return { status: "lease_lost", jobId: claim.job.id };
    }
    safeLog(this.logger, log(claim.job, "claimed"));
    if (signal?.aborted) return this.abortClaim(claim);

    let binding: ProvisionedProjectDatabaseBinding;
    try {
      binding = await this.adapter.provision(Object.freeze({
        provisioningJobId: claim.job.id,
        organizationId: claim.job.organizationId,
        projectId: claim.job.projectId,
        environment: claim.job.environment,
        region: claim.region,
        bootstrapContractSha256: PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
      }), { signal });
      assertBinding(binding);
    } catch (error) {
      if (signal?.aborted) return this.abortClaim(claim);
      return this.failClaim(
        claim,
        error instanceof ProjectDatabaseProvisioningAdapterError
          ? error.failureCode
          : "PROVIDER_UNAVAILABLE",
      );
    }

    try {
      const completed = await this.port.complete(
        claim,
        this.provisionerId,
        claim.job.leaseToken!,
        binding,
      );
      if (completed.job.status !== "succeeded" || completed.binding.databaseInstanceRef !== binding.databaseInstanceRef) {
        throw new Error("Invalid completion");
      }
    } catch (error) {
      if (isLeaseLost(error)) {
        safeLog(this.logger, log(claim.job, "lease_lost"));
        return { status: "lease_lost", jobId: claim.job.id };
      }
      return this.failClaim(claim, "INVALID_BINDING");
    }
    safeLog(this.logger, log(claim.job, "succeeded"));
    return { status: "succeeded", jobId: claim.job.id };
  }

  private async failClaim(
    claim: ProjectDatabaseProvisioningClaim,
    errorCode: ProjectDatabaseProvisioningErrorCode,
  ): Promise<ProjectDatabaseProvisioningWorkerResult> {
    try {
      const updated = await this.port.recordFailure(
        claim,
        this.provisionerId,
        claim.job.leaseToken!,
        errorCode,
        retryDelay(claim.job.attemptCount, this.retryBaseDelayMs, this.retryMaxDelayMs),
      );
      const status = updated.status === "failed" ? "failed" : "retry_scheduled";
      safeLog(this.logger, log(updated, status, errorCode));
      return { status, jobId: claim.job.id };
    } catch (error) {
      if (isLeaseLost(error)) {
        safeLog(this.logger, log(claim.job, "lease_lost"));
        return { status: "lease_lost", jobId: claim.job.id };
      }
      safeLog(this.logger, log(claim.job, "lease_lost", "CONTROL_PLANE_UPDATE_FAILED"));
      return { status: "lease_lost", jobId: claim.job.id };
    }
  }

  private async abortClaim(claim: ProjectDatabaseProvisioningClaim): Promise<ProjectDatabaseProvisioningWorkerResult> {
    try {
      await this.port.releaseAfterAbort(
        claim,
        this.provisionerId,
        claim.job.leaseToken!,
        retryDelay(claim.job.attemptCount, this.retryBaseDelayMs, this.retryMaxDelayMs),
      );
    } catch (error) {
      if (isLeaseLost(error)) return { status: "lease_lost", jobId: claim.job.id };
      return { status: "lease_lost", jobId: claim.job.id };
    }
    safeLog(this.logger, log(claim.job, "aborted"));
    return { status: "aborted", jobId: claim.job.id };
  }
}

function assertBinding(binding: ProvisionedProjectDatabaseBinding): void {
  const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
  const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  const normalizedHost = typeof binding?.host === "string" ? binding.host.toLowerCase().replace(/\.$/, "") : "";
  if (!binding || typeof binding !== "object" ||
      !/^managed:[a-z0-9][a-z0-9._:-]{0,119}$/.test(binding.databaseInstanceRef) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(binding.vaultStaticRole) ||
      typeof binding.host !== "string" || binding.host.length < 1 || binding.host.length > 253 ||
      (!hostname.test(normalizedHost) && isIP(normalizedHost) === 0 && normalizedHost !== "localhost") ||
      !Number.isSafeInteger(binding.port) || binding.port < 1 || binding.port > 65_535 ||
      !identifier.test(binding.expectedRole) || !identifier.test(binding.expectedDatabase) ||
      !identifier.test(binding.expectedLedgerOwner) || binding.expectedRole === binding.expectedLedgerOwner ||
      binding.expectedRole.startsWith("pg_") || binding.expectedDatabase.startsWith("pg_") ||
      binding.expectedLedgerOwner.startsWith("pg_") ||
      !/^[a-f0-9]{64}$/.test(binding.serverCertificateSha256) ||
      binding.bootstrapContractSha256 !== PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256) {
    throw new ProjectDatabaseProvisioningAdapterError(
      binding?.bootstrapContractSha256 === PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256
        ? "INVALID_BINDING"
        : "BOOTSTRAP_UNVERIFIED",
    );
  }
}

function validClaim(claim: ProjectDatabaseProvisioningClaim, owner: string, now: Date): boolean {
  const job = claim.job;
  return job.status === "running" && job.leaseOwner === owner && typeof job.leaseToken === "string" &&
    job.leaseToken.length > 0 && typeof job.leaseExpiresAt === "string" &&
    Date.parse(job.leaseExpiresAt) > now.getTime() && job.attemptCount >= 1 &&
    job.attemptCount <= job.maxAttempts && job.maxAttempts === 5 &&
    job.retryCycleCount <= job.maxRetryCycles && job.maxRetryCycles === 3 &&
    typeof claim.region === "string" && claim.region.length >= 1 && claim.region.length <= 64 &&
    !/[\r\n\0]/u.test(claim.region);
}

function log(
  job: ProjectDatabaseProvisioningJobRecord,
  status: "claimed" | "succeeded" | "retry_scheduled" | "failed" | "lease_lost" | "aborted" |
    "expired_lease_quarantined",
  errorCode?: ProjectDatabaseProvisioningLogEvent["errorCode"],
): ProjectDatabaseProvisioningLogEvent {
  return {
    event: `project_database_provisioning.${status}`,
    status,
    organizationId: job.organizationId,
    projectId: job.projectId,
    environment: job.environment,
    jobId: job.id,
    attempt: job.attemptCount,
    retryCycle: job.retryCycleCount,
    ...(errorCode ? { errorCode } : {}),
  };
}

function retryDelay(attempt: number, base: number, maximum: number): number {
  return Math.min(maximum, base * 2 ** Math.min(Math.max(attempt - 1, 0), 20));
}

function isLeaseLost(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "PROJECT_PROVISIONING_LEASE_LOST";
}

function boundedReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/u.test(trimmed)) throw new Error("Invalid provisioner id.");
  return trimmed;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid provisioning timing.");
  return value;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error { const error = new Error("Aborted"); error.name = "AbortError"; return error; }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function safeLog(logger: { log(event: ProjectDatabaseProvisioningLogEvent): void }, event: ProjectDatabaseProvisioningLogEvent) {
  try { logger.log(event); } catch { /* Observability never controls provisioning. */ }
}
