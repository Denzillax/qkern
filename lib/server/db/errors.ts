export type RepositoryErrorCode =
  | "CONFIGURATION_ERROR"
  | "DEPENDENCY_UNAVAILABLE"
  | "INVALID_TENANT_CONTEXT"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT"
  | "INVALID_REFERENCE"
  | "INVALID_RECORD"
  | "APPROVAL_ALREADY_DECIDED"
  | "APPROVAL_EXPIRED"
  | "MIGRATION_NOT_READY"
  | "MIGRATION_LEASE_LOST"
  | "PROJECT_PROVISIONING_NOT_READY"
  | "PROJECT_PROVISIONING_LEASE_LOST"
  | "TRANSACTION_CONFLICT"
  | "QUERY_TIMEOUT"
  | "PERSISTENCE_ERROR";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly retryable: boolean;

  constructor(code: RepositoryErrorCode, message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export class ConfigurationError extends RepositoryError {
  constructor(message: string, cause?: unknown) {
    super("CONFIGURATION_ERROR", message, { cause });
  }
}

export class DependencyUnavailableError extends RepositoryError {
  constructor(message: string, cause?: unknown) {
    super("DEPENDENCY_UNAVAILABLE", message, { cause });
  }
}

export class InvalidTenantContextError extends RepositoryError {
  constructor(message = "A valid organization UUID is required.") {
    super("INVALID_TENANT_CONTEXT", message);
  }
}

export class ResourceNotFoundError extends RepositoryError {
  constructor(resource = "Resource") {
    super("RESOURCE_NOT_FOUND", `${resource} was not found.`);
  }
}

export class ConflictError extends RepositoryError {
  constructor(message = "The record conflicts with existing data.", cause?: unknown) {
    super("CONFLICT", message, { cause });
  }
}

export class InvalidReferenceError extends RepositoryError {
  constructor(message = "A referenced resource does not exist.", cause?: unknown) {
    super("INVALID_REFERENCE", message, { cause });
  }
}

export class InvalidRecordError extends RepositoryError {
  constructor(message = "The record violates a persistence constraint.", cause?: unknown) {
    super("INVALID_RECORD", message, { cause });
  }
}

export class ApprovalAlreadyDecidedError extends RepositoryError {
  constructor() {
    super("APPROVAL_ALREADY_DECIDED", "The approval request has already been decided.");
  }
}

export class ApprovalExpiredError extends RepositoryError {
  constructor() {
    super("APPROVAL_EXPIRED", "The approval request has expired.");
  }
}

export class MigrationNotReadyError extends RepositoryError {
  constructor() {
    super("MIGRATION_NOT_READY", "The change set is not approved for migration apply.");
  }
}

export class MigrationLeaseLostError extends RepositoryError {
  constructor() {
    super("MIGRATION_LEASE_LOST", "The migration worker no longer owns an active lease.");
  }
}

export class ProjectProvisioningNotReadyError extends RepositoryError {
  constructor() {
    super("PROJECT_PROVISIONING_NOT_READY", "The project database environment cannot be provisioned in its current state.");
  }
}

export class ProjectProvisioningLeaseLostError extends RepositoryError {
  constructor() {
    super("PROJECT_PROVISIONING_LEASE_LOST", "The project database provisioner no longer owns an active lease.");
  }
}

export class TransactionConflictError extends RepositoryError {
  constructor(cause?: unknown) {
    super("TRANSACTION_CONFLICT", "The transaction conflicted with another write and can be retried.", {
      cause,
      retryable: true,
    });
  }
}

export class QueryTimeoutError extends RepositoryError {
  constructor(cause?: unknown) {
    super("QUERY_TIMEOUT", "The database operation timed out and can be retried.", { cause, retryable: true });
  }
}

export class PersistenceError extends RepositoryError {
  constructor(cause?: unknown) {
    super("PERSISTENCE_ERROR", "The database operation failed.", { cause });
  }
}

type PostgresError = Error & { code?: string };

export function mapPostgresError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;
  const pgError = error as PostgresError;
  switch (pgError?.code) {
    case "23505":
      return new ConflictError(undefined, error);
    case "23503":
      return new InvalidReferenceError(undefined, error);
    case "23502":
    case "23514":
    case "22P02":
      return new InvalidRecordError(undefined, error);
    case "40001":
    case "40P01":
      return new TransactionConflictError(error);
    case "57014":
      return new QueryTimeoutError(error);
    default:
      return new PersistenceError(error);
  }
}
