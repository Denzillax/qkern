import { recognisedByName } from "@/lib/server/errors/identity";
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
  | "CONNECTION_UNAVAILABLE"
  | "PERSISTENCE_ERROR";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly retryable: boolean;

  constructor(code: RepositoryErrorCode, message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message, { cause: options?.cause });
    // Der Name kommt seit 2.25 vom Prototyp (`recognisedByName`), als Literal statt aus new.target.
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}
recognisedByName(RepositoryError, "RepositoryError", ["ConfigurationError", "DependencyUnavailableError", "InvalidTenantContextError", "ResourceNotFoundError", "ConflictError", "InvalidReferenceError", "InvalidRecordError", "ApprovalAlreadyDecidedError", "ApprovalExpiredError", "MigrationNotReadyError", "MigrationLeaseLostError", "ProjectProvisioningNotReadyError", "ProjectProvisioningLeaseLostError", "TransactionConflictError", "QueryTimeoutError", "ConnectionUnavailableError", "PersistenceError"]);

export class ConfigurationError extends RepositoryError {
  constructor(message: string, cause?: unknown) {
    super("CONFIGURATION_ERROR", message, { cause });
  }
}
recognisedByName(ConfigurationError, "ConfigurationError");

export class DependencyUnavailableError extends RepositoryError {
  constructor(message: string, cause?: unknown) {
    super("DEPENDENCY_UNAVAILABLE", message, { cause });
  }
}
recognisedByName(DependencyUnavailableError, "DependencyUnavailableError");

export class InvalidTenantContextError extends RepositoryError {
  constructor(message = "A valid organization UUID is required.") {
    super("INVALID_TENANT_CONTEXT", message);
  }
}
recognisedByName(InvalidTenantContextError, "InvalidTenantContextError");

export class ResourceNotFoundError extends RepositoryError {
  constructor(resource = "Resource") {
    super("RESOURCE_NOT_FOUND", `${resource} was not found.`);
  }
}
recognisedByName(ResourceNotFoundError, "ResourceNotFoundError");

export class ConflictError extends RepositoryError {
  constructor(message = "The record conflicts with existing data.", cause?: unknown) {
    super("CONFLICT", message, { cause });
  }
}
recognisedByName(ConflictError, "ConflictError");

export class InvalidReferenceError extends RepositoryError {
  constructor(message = "A referenced resource does not exist.", cause?: unknown) {
    super("INVALID_REFERENCE", message, { cause });
  }
}
recognisedByName(InvalidReferenceError, "InvalidReferenceError");

export class InvalidRecordError extends RepositoryError {
  constructor(message = "The record violates a persistence constraint.", cause?: unknown) {
    super("INVALID_RECORD", message, { cause });
  }
}
recognisedByName(InvalidRecordError, "InvalidRecordError");

export class ApprovalAlreadyDecidedError extends RepositoryError {
  constructor() {
    super("APPROVAL_ALREADY_DECIDED", "The approval request has already been decided.");
  }
}
recognisedByName(ApprovalAlreadyDecidedError, "ApprovalAlreadyDecidedError");

export class ApprovalExpiredError extends RepositoryError {
  constructor() {
    super("APPROVAL_EXPIRED", "The approval request has expired.");
  }
}
recognisedByName(ApprovalExpiredError, "ApprovalExpiredError");

export class MigrationNotReadyError extends RepositoryError {
  constructor() {
    super("MIGRATION_NOT_READY", "The change set is not approved for migration apply.");
  }
}
recognisedByName(MigrationNotReadyError, "MigrationNotReadyError");

export class MigrationLeaseLostError extends RepositoryError {
  constructor() {
    super("MIGRATION_LEASE_LOST", "The migration worker no longer owns an active lease.");
  }
}
recognisedByName(MigrationLeaseLostError, "MigrationLeaseLostError");

export class ProjectProvisioningNotReadyError extends RepositoryError {
  constructor() {
    super("PROJECT_PROVISIONING_NOT_READY", "The project database environment cannot be provisioned in its current state.");
  }
}
recognisedByName(ProjectProvisioningNotReadyError, "ProjectProvisioningNotReadyError");

export class ProjectProvisioningLeaseLostError extends RepositoryError {
  constructor() {
    super("PROJECT_PROVISIONING_LEASE_LOST", "The project database provisioner no longer owns an active lease.");
  }
}
recognisedByName(ProjectProvisioningLeaseLostError, "ProjectProvisioningLeaseLostError");

export class TransactionConflictError extends RepositoryError {
  constructor(cause?: unknown) {
    super("TRANSACTION_CONFLICT", "The transaction conflicted with another write and can be retried.", {
      cause,
      retryable: true,
    });
  }
}
recognisedByName(TransactionConflictError, "TransactionConflictError");

export class QueryTimeoutError extends RepositoryError {
  constructor(cause?: unknown) {
    super("QUERY_TIMEOUT", "The database operation timed out and can be retried.", { cause, retryable: true });
  }
}
recognisedByName(QueryTimeoutError, "QueryTimeoutError");

/**
 * Der Pool hat keine Verbindung mehr hergegeben.
 *
 * Das ist kein Datenbankfehler: Die Abfrage ist nie gelaufen, und die Datenbank
 * hat nichts abgewiesen. Der Prozess hat schlicht mehr gleichzeitige Arbeit
 * angenommen, als sein Pool tragen kann.
 *
 * Bis Release 1.64 war das von einem echten Fehlschlag nicht zu unterscheiden.
 * `pg` meldet den Zeitablauf beim Verbindungsholen ohne SQLSTATE, er landete
 * deshalb im Sammelzweig als `PERSISTENCE_ERROR` — und der Queue-Dienst hat
 * daraus ein `QUEUE_CONFLICT` und die HTTP-Grenze eine 409 gemacht. Ein
 * Aufrufer las: „jemand anderes war schneller", obwohl die Warteschlange in
 * Ordnung war.
 *
 * Wiederholbar ist er, und zwar sinnvoll: Wer wartet, bekommt eine Verbindung.
 */
export class ConnectionUnavailableError extends RepositoryError {
  constructor(cause?: unknown) {
    super("CONNECTION_UNAVAILABLE",
      "No database connection was available and the operation can be retried.",
      { cause, retryable: true });
  }
}
recognisedByName(ConnectionUnavailableError, "ConnectionUnavailableError");

export class PersistenceError extends RepositoryError {
  constructor(cause?: unknown) {
    super("PERSISTENCE_ERROR", "The database operation failed.", { cause });
  }
}
recognisedByName(PersistenceError, "PersistenceError");

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

/**
 * Ist der Prozess an einer freien Verbindung gescheitert?
 *
 * Die Frage stellt jede HTTP-Grenze, und sie beantworten alle gleich: 503
 * statt 500 oder 409, denn es liegt nichts an der Anfrage und nichts an der
 * Datenbank. Ein Praedikat statt einer Antwort — jede Grenze hat ihr eigenes
 * Antwortformat, und keine soll es hier verlieren.
 *
 * `cause` wird mitgeprueft: Dienste verpacken den Fehler in ihre eigene
 * Fehlerklasse, bevor er die Grenze erreicht.
 */
export function isConnectionUnavailable(error: unknown): boolean {
  if (error instanceof ConnectionUnavailableError) return true;
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return cause instanceof ConnectionUnavailableError;
}
