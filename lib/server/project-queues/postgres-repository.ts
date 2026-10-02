import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import type {
  ProjectQueue,
  ProjectQueueClaim,
  ProjectQueueDeadLetter,
  ProjectQueueFailureCode,
  ProjectQueueJson,
  ProjectQueueMessage,
  ProjectQueuePrincipal,
  ProjectQueueScope,
  ProjectQueueStatus,
} from "@/lib/server/project-queues/model";
import {
  ProjectQueueConflictError,
  type ProjectQueueMeter,
  type ProjectQueueRepository,
  type ProjectQueueTraceRecord,
} from "@/lib/server/project-queues/repository";
import type {
  ProjectQueueTrace,
  ProjectQueueTraceAnchor,
  ProjectQueueTraceEntry,
  ProjectQueueTraceSearchEntry,
  ProjectQueueTraceSearchPage,
  ProjectQueueTraceStation,
} from "@/lib/server/project-queues/trace";
import {
  PROJECT_QUEUE_TRACE_MAX_STATIONS,
  PROJECT_QUEUE_TRACE_PRUNE_BATCH,
  PROJECT_QUEUE_TRACE_STATIONS,
  projectQueueClaimTraceparent,
  projectQueueTraceExpiresAt,
  projectQueueTraceSpanId,
} from "@/lib/server/project-queues/trace";

type Row = Record<string, unknown>;
type QueueDatabase = Pick<PostgresControlPlane, "withTenant">;

export class PostgresProjectQueueRepository implements ProjectQueueRepository {
  readonly durability = "durable" as const;

  constructor(private readonly database: QueueDatabase) {}

  listQueues(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${QUEUE_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3
        ORDER BY name ASC LIMIT 100`, scopeValues(scope));
      return result.rows.map(queueFromRow);
    });
  }

  findQueue(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueIdOrName: string,
  ) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${QUEUE_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3
          AND (id::text=$4 OR name=$4) LIMIT 1`, [...scopeValues(scope), queueIdOrName]);
      return result.rows[0] ? queueFromRow(result.rows[0]) : null;
    });
  }

  createQueue(principal: ProjectQueuePrincipal, queue: ProjectQueue) {
    return this.withTenant(principal, false, async (database, audit) => {
      try {
        const result = await database.query(`INSERT INTO project_queues
          (id,organization_id,project_id,environment,name,enqueue_policy,max_attempts,
           visibility_timeout_seconds,retry_base_seconds,retry_max_seconds,
           dedupe_window_seconds,retention_seconds,max_pending_messages,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          RETURNING ${QUEUE_COLUMNS}`, queueValues(queue));
        const created = queueFromRow(result.rows[0]);
        await audit?.append({
          projectId: queue.projectId,
          environment: queue.environment,
          actorType: "user",
          actorRef: principal.actorRef,
          action: "project.queue.created",
          resourceRef: queue.id,
          status: "success",
          metadata: { name: queue.name, enqueuePolicy: queue.enqueuePolicy },
        });
        return created;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ProjectQueueConflictError("QUEUE_CONFLICT");
        }
        throw error;
      }
    });
  }

  enqueue(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    message: ProjectQueueMessage,
    now: Date,
    meter?: ProjectQueueMeter,
    trace?: ProjectQueueTraceAnchor | null,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const result = await this.enqueueWithin(database, scope, queue, message, now, trace);
      // Nach dem Schreiben, vor dem Festschreiben — und in **dieser**
      // Transaktion. Wirft der Haken, verschwindet die Nachricht mit ihm.
      //
      // Die frueh geworfenen Konflikte (falsche Queue, volle Queue) kommen hier
      // nie an: Eine abgewiesene Operation soll auch kein Kontingent
      // verbrauchen.
      await meter?.(database);
      return result;
    });
  }

  private async enqueueWithin(
    database: SqlQueryable,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    message: ProjectQueueMessage,
    now: Date,
    trace?: ProjectQueueTraceAnchor | null,
  ): Promise<{ message: ProjectQueueMessage; deduplicated: boolean }> {
    {
      const current = await this.lockQueue(database, scope, queue.id);
      if (!current || current.name !== queue.name || message.queueId !== current.id) {
        throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      }
      await cleanup(database, scope, current, now);
      if (message.dedupeKeyHash && current.dedupeWindowSeconds > 0) {
        const duplicate = await database.query(`${MESSAGE_SELECT}
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
            AND dedupe_key_hash=$5 AND dedupe_expires_at > $6
          ORDER BY created_at ASC,id ASC LIMIT 1`, [
          ...scopeValues(scope), current.id, message.dedupeKeyHash, now,
        ]);
        if (duplicate.rows[0]) {
          const twin = messageFromRow(duplicate.rows[0]);
          // Die Station gehoert dem Zwilling: Die zweite Anfrage hat keine
          // eigene Nachricht, und sie bekommt auch keine eigene Spur.
          await recordTrace(database, scope, current, twin.id, {
            station: "deduplicated", attempt: twin.attemptCount,
            workerId: null, failureCode: null, occurredAt: now,
          });
          return { message: twin, deduplicated: true };
        }
      }
      const pending = await database.query<{ count: unknown }>(`SELECT count(*)::int AS count
        FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND status IN ('available','in_flight')`, [...scopeValues(scope), current.id]);
      if (safeInteger(pending.rows[0]?.count) >= current.maxPendingMessages) {
        throw new ProjectQueueConflictError("QUEUE_CAPACITY_EXCEEDED");
      }
      // Verifikator und Frist entstehen zusammen oder gar nicht: Genau das
      // verlangt `project_queue_messages_dedupe_pair` aus 0026. Der Dienst
      // entscheidet schon oben, dass ein Fenster von null keinen Verifikator
      // bildet; hier steht dieselbe Regel noch einmal, weil ein Port, der an
      // seinem eigenen CHECK scheitert, dem Aufrufer nur `QUEUE_CONFLICT`
      // sagen kann, also eine Aussage ueber einen Wettlauf, den es nie gab.
      const dedupeKeyHash = current.dedupeWindowSeconds > 0 ? message.dedupeKeyHash : null;
      const dedupeExpiresAt = dedupeKeyHash
        ? new Date(now.getTime() + current.dedupeWindowSeconds * 1_000)
        : null;
      // Die Station steht **nach** dem try, nicht darin. Ein 23505 aus der
      // Spur-Tabelle waere im Fangzweig sonst eine Aussage ueber den
      // Dedupe-Index, also ein "jemand war schneller", das nie stattgefunden
      // hat. Dieselbe Falle, die 1.64 beim erschoepften Pool gestellt hat.
      let created: ProjectQueueMessage;
      try {
        const inserted = await database.query(`INSERT INTO project_queue_messages
          (id,organization_id,project_id,environment,queue_id,payload,status,owner_subject,
           dedupe_key_hash,dedupe_expires_at,attempt_count,available_at,lease_worker_id,
           lease_token_hash,lease_sequence,lease_expires_at,last_failure_code,created_at,
           completed_at,dead_lettered_at)
          VALUES ($1,$2,$3,$4,$5,$6,'available',$7,$8,$9,0,$10,NULL,NULL,0,NULL,NULL,$11,NULL,NULL)
          RETURNING ${MESSAGE_COLUMNS}`, [
          message.id, message.organizationId, message.projectId, message.environment,
          message.queueId, message.payload as Record<string, unknown>, message.ownerSubject,
          dedupeKeyHash, dedupeExpiresAt, message.availableAt, message.createdAt,
        ]);
        created = messageFromRow(inserted.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          if (dedupeKeyHash) {
            const duplicate = await database.query(`${MESSAGE_SELECT}
              WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
                AND dedupe_key_hash=$5 AND dedupe_expires_at > $6 LIMIT 1`, [
              ...scopeValues(scope), current.id, dedupeKeyHash, now,
            ]);
            if (duplicate.rows[0]) {
              const twin = messageFromRow(duplicate.rows[0]);
              await recordTrace(database, scope, current, twin.id, {
                station: "deduplicated", attempt: twin.attemptCount,
                workerId: null, failureCode: null, occurredAt: now,
              });
              return { message: twin, deduplicated: true };
            }
          }
          throw new ProjectQueueConflictError("QUEUE_CONFLICT");
        }
        throw error;
      }
      await recordTrace(database, scope, current, created.id, {
        station: "enqueued", attempt: 0, workerId: null, failureCode: null,
        occurredAt: created.createdAt, trace,
      });
      return { message: created, deduplicated: false };
    }
  }

  claim(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    input: {
      workerId: string;
      limit: number;
      now: Date;
      leases: Array<{ token: string; tokenHash: string }>;
    },
  ): Promise<ProjectQueueClaim[]> {
    return this.withTenant(principal, false, async (database) => {
      const current = await this.existingQueue(database, scope, queue.id);
      if (!current || current.name !== queue.name) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      await recoverExpiredLeases(database, scope, current, input.now);
      const ready = await database.query(`${MESSAGE_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND status='available' AND available_at <= $5
        ORDER BY available_at ASC,created_at ASC,id ASC
        FOR UPDATE SKIP LOCKED LIMIT $6`, [
        ...scopeValues(scope), current.id, input.now, input.limit,
      ]);
      const claims: ProjectQueueClaim[] = [];
      for (const [index, row] of ready.rows.entries()) {
        const message = messageFromRow(row);
        const lease = input.leases[index];
        if (!lease) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
        const leaseExpiresAt = new Date(input.now.getTime() + current.visibilityTimeoutSeconds * 1_000);
        const updated = await database.query(`${UPDATE_MESSAGE}
          SET status='in_flight',attempt_count=attempt_count+1,lease_sequence=lease_sequence+1,
              lease_worker_id=$5,lease_token_hash=$6,lease_expires_at=$7
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
            AND queue_id=$8 AND status='available'
          RETURNING ${MESSAGE_COLUMNS}`, [
          ...scopeValues(scope), message.id, input.workerId, lease.tokenHash,
          leaseExpiresAt, current.id,
        ]);
        if (!updated.rows[0]) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
        const claimed = messageFromRow(updated.rows[0]);
        const station = await recordTrace(database, scope, current, claimed.id, {
          station: "claimed", attempt: claimed.attemptCount,
          workerId: input.workerId, failureCode: null, occurredAt: input.now,
        });
        const traceId = await traceIdOf(database, scope, claimed.id);
        claims.push({
          id: claimed.id,
          queue: current.name,
          payload: structuredClone(claimed.payload),
          attempt: claimed.attemptCount,
          leaseSequence: claimed.leaseSequence,
          leaseToken: lease.token,
          leaseExpiresAt: claimed.leaseExpiresAt!.toISOString(),
          createdAt: claimed.createdAt.toISOString(),
          // Der Anschluss nach innen (2.124): Spur-Id dieser Nachricht,
          // Eltern-Span die Station, die dieser Claim gerade geschrieben hat.
          // Dieselbe Anweisung hat beides, also kostet es keine zweite Abfrage.
          traceparent: projectQueueClaimTraceparent(traceId, station.spanId),
        });
      }
      return claims;
    });
  }

  acknowledge(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const result = await database.query(`${UPDATE_MESSAGE}
        SET status='completed',completed_at=$8,lease_worker_id=NULL,
            lease_token_hash=NULL,lease_expires_at=NULL
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND queue_id=$5 AND status='in_flight' AND lease_worker_id=$6
          AND lease_token_hash=$7 AND lease_expires_at > $8
        RETURNING ${MESSAGE_COLUMNS}`, [
        ...scopeValues(scope), messageId, queue.id, workerId, leaseTokenHash, now,
      ]);
      if (!result.rows[0]) throw new ProjectQueueConflictError("QUEUE_LEASE_LOST");
      const acknowledged = messageFromRow(result.rows[0]);
      await recordTrace(database, scope, queue, acknowledged.id, {
        station: "completed", attempt: acknowledged.attemptCount,
        workerId, failureCode: null, occurredAt: now,
      });
      return acknowledged;
    });
  }

  fail(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    failureCode: Exclude<ProjectQueueFailureCode, "LEASE_EXPIRED">,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const locked = await database.query(`${MESSAGE_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND queue_id=$5 AND status='in_flight' AND lease_worker_id=$6
          AND lease_token_hash=$7 AND lease_expires_at > $8
        FOR UPDATE`, [
        ...scopeValues(scope), messageId, queue.id, workerId, leaseTokenHash, now,
      ]);
      if (!locked.rows[0]) throw new ProjectQueueConflictError("QUEUE_LEASE_LOST");
      const message = messageFromRow(locked.rows[0]);
      const deadLettered = message.attemptCount >= queue.maxAttempts || failureCode === "INVALID_PAYLOAD";
      const delaySeconds = Math.min(queue.retryMaxSeconds,
        queue.retryBaseSeconds * (2 ** Math.min(message.attemptCount - 1, 20)));
      const availableAt = deadLettered ? message.availableAt : new Date(now.getTime() + delaySeconds * 1_000);
      const result = await database.query(`${UPDATE_MESSAGE}
        SET status=$8,available_at=$9,lease_worker_id=NULL,lease_token_hash=NULL,
            lease_expires_at=NULL,last_failure_code=$10,dead_lettered_at=$11
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND queue_id=$5 AND status='in_flight' AND lease_worker_id=$6 AND lease_token_hash=$7
        RETURNING ${MESSAGE_COLUMNS}`, [
        ...scopeValues(scope), messageId, queue.id, workerId, leaseTokenHash,
        deadLettered ? "dead_lettered" : "available", availableAt, failureCode,
        deadLettered ? now : null,
      ]);
      if (!result.rows[0]) throw new ProjectQueueConflictError("QUEUE_LEASE_LOST");
      const settled = messageFromRow(result.rows[0]);
      await recordTrace(database, scope, queue, settled.id, {
        station: deadLettered ? "dead_lettered" : "retry_scheduled",
        attempt: settled.attemptCount, workerId, failureCode, occurredAt: now,
      });
      return settled;
    });
  }

  /**
   * Die Erneuerung bekommt **keine** Station, und das ist eine Entscheidung,
   * nicht eine Luecke. Die Begruendung steht in `trace.ts`: Ein Herzschlag
   * alle zehn Sekunden protokolliert den Takt und nicht die Arbeit, und ob
   * eine Pacht gehalten hat, sagt der Ausgang.
   */
  renewLease(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const leaseExpiresAt = new Date(now.getTime() + queue.visibilityTimeoutSeconds * 1_000);
      const result = await database.query(`${UPDATE_MESSAGE}
        SET lease_expires_at=$8
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND queue_id=$5 AND status='in_flight' AND lease_worker_id=$6
          AND lease_token_hash=$7 AND lease_expires_at > $9
        RETURNING ${MESSAGE_COLUMNS}`, [
        ...scopeValues(scope), messageId, queue.id, workerId, leaseTokenHash,
        leaseExpiresAt, now,
      ]);
      if (!result.rows[0]) throw new ProjectQueueConflictError("QUEUE_LEASE_LOST");
      return messageFromRow(result.rows[0]);
    });
  }

  status(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    now: Date,
  ): Promise<ProjectQueueStatus> {
    return this.withTenant(principal, false, async (database) => {
      const current = await this.existingQueue(database, scope, queue.id);
      if (!current || current.name !== queue.name) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      await recoverExpiredLeases(database, scope, current, now);
      await cleanup(database, scope, current, now);
      const result = await database.query<{
        available: unknown;
        scheduled: unknown;
        in_flight: unknown;
        completed: unknown;
        dead_lettered: unknown;
        oldest_available_at: unknown;
      }>(`SELECT
          count(*) FILTER (WHERE status='available' AND available_at <= $5)::int AS available,
          count(*) FILTER (WHERE status='available' AND available_at > $5)::int AS scheduled,
          count(*) FILTER (WHERE status='in_flight')::int AS in_flight,
          count(*) FILTER (WHERE status='completed')::int AS completed,
          count(*) FILTER (WHERE status='dead_lettered')::int AS dead_lettered,
          min(available_at) FILTER (WHERE status='available' AND available_at <= $5) AS oldest_available_at
        FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4`, [
        ...scopeValues(scope), current.id, now,
      ]);
      const row = result.rows[0];
      return {
        queue: current.name,
        available: safeInteger(row?.available),
        scheduled: safeInteger(row?.scheduled),
        inFlight: safeInteger(row?.in_flight),
        completed: safeInteger(row?.completed),
        deadLettered: safeInteger(row?.dead_lettered),
        oldestAvailableAt: row?.oldest_available_at === null || row?.oldest_available_at === undefined
          ? null
          : date(row.oldest_available_at).toISOString(),
      };
    });
  }

  listDeadLetters(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    limit: number,
  ): Promise<ProjectQueueDeadLetter[]> {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`SELECT message.id,message.attempt_count,
          message.last_failure_code,message.created_at,message.dead_lettered_at, EXISTS (
          SELECT 1 FROM project_queue_messages AS replay
          WHERE replay.organization_id=message.organization_id
            AND replay.project_id=message.project_id AND replay.environment=message.environment
            AND replay.replayed_from_message_id=message.id
        ) AS replayed
        FROM project_queue_messages AS message
        WHERE message.organization_id=$1 AND message.project_id=$2 AND message.environment=$3
          AND message.queue_id=$4 AND message.status='dead_lettered'
        ORDER BY message.dead_lettered_at DESC,message.id ASC LIMIT $5`, [
        ...scopeValues(scope), queue.id, limit,
      ]);
      return result.rows.map((row) => {
        const failureCode = row.last_failure_code === null ? null : String(row.last_failure_code);
        if (!failureCode || !["HANDLER_ERROR", "HANDLER_TIMEOUT", "DEPENDENCY_UNAVAILABLE",
          "INVALID_PAYLOAD", "LEASE_EXPIRED"].includes(failureCode) || row.dead_lettered_at === null) {
          throw new Error("Invalid dead letter");
        }
        return {
          id: String(row.id),
          queue: queue.name,
          attempt: safeInteger(row.attempt_count),
          failureCode: failureCode as ProjectQueueFailureCode,
          createdAt: date(row.created_at).toISOString(),
          deadLetteredAt: date(row.dead_lettered_at).toISOString(),
          replayed: row.replayed === true,
        };
      });
    });
  }

  replayDeadLetter(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    replayId: string,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database, audit) => {
      const source = await database.query(`${MESSAGE_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND id=$5 AND status='dead_lettered' FOR UPDATE`, [
        ...scopeValues(scope), queue.id, messageId,
      ]);
      if (!source.rows[0]) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      const prior = await database.query(`${MESSAGE_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND replayed_from_message_id=$5 LIMIT 1`, [
        ...scopeValues(scope), queue.id, messageId,
      ]);
      if (prior.rows[0]) return { message: messageFromRow(prior.rows[0]), created: false };
      const original = messageFromRow(source.rows[0]);
      try {
        const inserted = await database.query(`INSERT INTO project_queue_messages
          (id,organization_id,project_id,environment,queue_id,payload,status,owner_subject,
           dedupe_key_hash,dedupe_expires_at,attempt_count,available_at,lease_worker_id,
           lease_token_hash,lease_sequence,lease_expires_at,last_failure_code,created_at,
           completed_at,dead_lettered_at,replayed_from_message_id)
          VALUES ($1,$2,$3,$4,$5,$6,'available',$7,NULL,NULL,0,$8,NULL,NULL,0,NULL,NULL,$8,NULL,NULL,$9)
          RETURNING ${MESSAGE_COLUMNS}`, [
          replayId, scope.organizationId, scope.projectId, scope.environment, queue.id,
          original.payload as Record<string, unknown>, original.ownerSubject, now, messageId,
        ]);
        // Die neue Nachricht erbt den Anschluss der alten: Eine Kette durch ein
        // Dead Letter bleibt damit draussen eine Spur. Gelesen wird die erste
        // Station der Quelle, nicht die Quelle selbst, denn der Anschluss steht
        // nur dort.
        await recordTrace(database, scope, queue, replayId, {
          station: "replayed", attempt: 0, workerId: null, failureCode: null,
          occurredAt: now, sourceMessageId: messageId,
          trace: await traceAnchor(database, scope, messageId),
        });
        await audit?.append({
          projectId: scope.projectId,
          environment: scope.environment,
          actorType: "user",
          actorRef: principal.actorRef,
          action: "project.queue.dead_letter_replayed",
          resourceRef: replayId,
          status: "success",
          metadata: { queue: queue.name, sourceMessageId: messageId },
        });
        return { message: messageFromRow(inserted.rows[0]), created: true };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          const existing = await database.query(`${MESSAGE_SELECT}
            WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
              AND replayed_from_message_id=$5 LIMIT 1`, [
            ...scopeValues(scope), queue.id, messageId,
          ]);
          if (existing.rows[0]) return { message: messageFromRow(existing.rows[0]), created: false };
        }
        throw error;
      }
    });
  }

  /**
   * Die Spur einer Nachricht, in Zeitreihenfolge.
   *
   * Lesend und damit in einer Lesetransaktion: Die Spur wird hier nicht
   * aufgeraeumt. Das Aufraeumen haengt am Einreihen und am Status, also an den
   * schreibenden Wegen; ein Leser, der loescht, waere eine Ansicht mit
   * Nebenwirkung.
   */
  readTrace(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
  ): Promise<ProjectQueueTrace | null> {
    return this.withTenant(principal, true, async (database) => {
      const stations = await database.query(`SELECT sequence,station,attempt,worker_id,
          failure_code,trace_id,parent_span_id,span_id,source_message_id,occurred_at
        FROM project_queue_message_traces
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND message_id=$5
        ORDER BY sequence ASC LIMIT $6`, [
        ...scopeValues(scope), queue.id, messageId, PROJECT_QUEUE_TRACE_MAX_STATIONS,
      ]);
      const message = await database.query<{ id: unknown }>(`SELECT id
        FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND id=$5`, [...scopeValues(scope), queue.id, messageId]);
      const exists = message.rows.length === 1;
      if (stations.rows.length === 0 && !exists) return null;
      const replay = await database.query<{ message_id: unknown }>(`SELECT message_id
        FROM project_queue_message_traces
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND source_message_id=$5
        ORDER BY occurred_at ASC,message_id ASC LIMIT 1`, [
        ...scopeValues(scope), queue.id, messageId,
      ]);
      const first = stations.rows[0];
      return Object.freeze({
        messageId,
        queue: queue.name,
        traceId: first?.trace_id === null || first?.trace_id === undefined ? null : String(first.trace_id),
        parentSpanId: first?.parent_span_id === null || first?.parent_span_id === undefined
          ? null : String(first.parent_span_id),
        sourceMessageId: first?.source_message_id === null || first?.source_message_id === undefined
          ? null : String(first.source_message_id),
        replayedIntoMessageId: replay.rows[0] ? String(replay.rows[0].message_id) : null,
        messageExists: exists,
        complete: stations.rows.length < PROJECT_QUEUE_TRACE_MAX_STATIONS,
        stations: Object.freeze(stations.rows.map(traceEntryFromRow)),
      });
    });
  }

  /**
   * Der Besitzer einer Nachricht (2.131), fuer die Anwendungstuer.
   *
   * Eine eigene Abfrage und nicht ein zusaetzliches Feld in `readTrace`: Der
   * Besitzer soll in der Antwort der Admin-Route nicht auftauchen, und ein Wert,
   * der durch den Leser laeuft, taucht irgendwann dort auf. Gelesen wird
   * ausdruecklich nur `owner_subject`, nicht die Zeile.
   */
  findTraceMessageOwner(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
  ): Promise<string | null> {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query<{ owner_subject: unknown }>(`SELECT owner_subject
        FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
          AND id=$5`, [...scopeValues(scope), queue.id, messageId]);
      return result.rows[0] ? String(result.rows[0].owner_subject) : null;
    });
  }

  /**
   * Die Nachrichten einer Spur-Id (2.131), haeppchenweise.
   *
   * ## Was die Abfrage liest, und wie der Index aus 0085 sie traegt
   *
   * Die Bedingung ist Scope plus `trace_id`, die Ordnung ist
   * `(occurred_at, message_id)` aufsteigend, und genau diese sechs Spalten stehen
   * in dieser Reihenfolge im Teilindex. Der Scope steht vorn, damit die
   * Mandantengrenze nicht erst von der Policy kommt; die Begruendung in voller
   * Laenge steht in 0085.
   *
   * **Je Nachricht hoechstens eine Zeile, ohne DISTINCT.** `trace_id` liegt nach
   * `project_queue_message_traces_trace_anchor` (0081) nur auf Sequenz eins. Die
   * Zusage kommt also aus der Tabelle und nicht aus einer Gruppierung, die jemand
   * richtig geschrieben haben muss.
   *
   * **Der Verbund auf `project_queues` nennt die Queue je Zeile** und ist ein
   * INNER JOIN, der nichts verliert: Der Fremdschluessel aus 0081 haengt die Spur
   * mit `ON DELETE CASCADE` an die Queue, eine Station ohne ihre Queue gibt es
   * also nicht. Verbunden wird ueber alle vier Spalten des Schluessels und nicht
   * nur ueber `queue_id`, damit der Verbund dieselbe Grenze fuehrt wie das
   * `WHERE`.
   *
   * **Der Cursor liest seine eigene Position nach.** Dieselbe Form wie im
   * Audit-Log von Project Auth: Die Abfrage holt `(occurred_at, message_id)` der
   * Cursor-Zeile selbst, und ein Cursor, dessen Zeile weggeraeumt ist, macht den
   * Vergleich zu NULL und die Seite damit leer. Verglichen wird
   * `message_id::text`, weil der Cursor von draussen kommt und eine
   * Zeichenkette ist, die keine UUID sein muss; ein `$5::uuid` wuerde an einem
   * krummen Cursor mit einem Datenbankfehler scheitern statt mit einer leeren
   * Seite. Die Ordnung selbst bleibt dabei auf `uuid` und nicht auf Text: Beide
   * Seiten des Tupelvergleichs kommen aus der Spalte.
   */
  searchTraces(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    input: { traceId: string; limit: number; cursor: string | null },
  ): Promise<ProjectQueueTraceSearchPage> {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`SELECT trace.message_id,trace.station,trace.span_id,
          trace.parent_span_id,trace.source_message_id,trace.occurred_at,queue.name AS queue
        FROM project_queue_message_traces AS trace
        JOIN project_queues AS queue
          ON queue.organization_id=trace.organization_id AND queue.project_id=trace.project_id
            AND queue.environment=trace.environment AND queue.id=trace.queue_id
        WHERE trace.organization_id=$1 AND trace.project_id=$2 AND trace.environment=$3
          AND trace.trace_id=$4
          AND ($5::text IS NULL OR (trace.occurred_at,trace.message_id) > (
            SELECT cursor_row.occurred_at,cursor_row.message_id
            FROM project_queue_message_traces AS cursor_row
            WHERE cursor_row.organization_id=$1 AND cursor_row.project_id=$2
              AND cursor_row.environment=$3 AND cursor_row.trace_id=$4
              AND cursor_row.message_id::text=$5::text))
        ORDER BY trace.occurred_at ASC,trace.message_id ASC
        LIMIT $6`, [...scopeValues(scope), input.traceId, input.cursor, input.limit + 1]);
      const messages = result.rows.slice(0, input.limit).map(traceSearchEntryFromRow);
      return Object.freeze({
        traceId: input.traceId,
        messages: Object.freeze(messages),
        nextCursor: result.rows.length > input.limit ? messages[messages.length - 1]!.messageId : null,
      });
    });
  }

  private lockQueue(database: SqlQueryable, scope: ProjectQueueScope, queueId: string) {
    return this.queue(database, scope, queueId, true);
  }

  private existingQueue(database: SqlQueryable, scope: ProjectQueueScope, queueId: string) {
    return this.queue(database, scope, queueId, false);
  }

  private async queue(database: SqlQueryable, scope: ProjectQueueScope, queueId: string, lock: boolean) {
    const result = await database.query(`${QUEUE_SELECT}
      WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
      ${lock ? "FOR UPDATE" : ""}`, [...scopeValues(scope), queueId]);
    return result.rows[0] ? queueFromRow(result.rows[0]) : null;
  }

  private withTenant<T>(
    principal: ProjectQueuePrincipal,
    readOnly: boolean,
    work: (database: SqlQueryable, audit?: { append(input: Record<string, unknown>): Promise<unknown> }) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
      readOnly,
    }, async (repositories) => work(repositories.transaction, repositories.audit as never));
  }
}

const QUEUE_COLUMNS = `id,organization_id,project_id,environment,name,enqueue_policy,max_attempts,
  visibility_timeout_seconds,retry_base_seconds,retry_max_seconds,dedupe_window_seconds,
  retention_seconds,max_pending_messages,created_at,updated_at`;
const QUEUE_SELECT = `SELECT ${QUEUE_COLUMNS} FROM project_queues`;
const MESSAGE_COLUMNS = `id,organization_id,project_id,environment,queue_id,payload,status,
  owner_subject,dedupe_key_hash,attempt_count,available_at,lease_worker_id,lease_token_hash,
  lease_sequence,lease_expires_at,last_failure_code,created_at,completed_at,dead_lettered_at,
  replayed_from_message_id`;
const MESSAGE_SELECT = `SELECT ${MESSAGE_COLUMNS} FROM project_queue_messages`;
const UPDATE_MESSAGE = "UPDATE project_queue_messages";

/**
 * Gibt verfallene Pachten frei und schreibt je Nachricht ihre Station.
 *
 * Bis 2.121 war das **eine** Anweisung, ein UPDATE ohne RETURNING. Fuer die
 * Spur fehlten damit zwei Angaben: welche Nachrichten es waren und welcher Wirt
 * die Pacht gehalten hatte. Letzteres kann RETURNING nicht liefern, denn
 * dieselbe Anweisung setzt `lease_worker_id` auf NULL, und RETURNING gibt den
 * neuen Wert. Darum steht jetzt ein `SELECT ... FOR UPDATE` davor.
 *
 * Das kostet keine Zusage: `FOR UPDATE` sperrt genau die Zeilen, die das UPDATE
 * danach anfasst, und eine zweite Instanz, die gleichzeitig erholt, sieht nach
 * dem Freigeben der Sperre, dass die Bedingung `status='in_flight'` nicht mehr
 * gilt, und ueberspringt die Zeile. Es entsteht also auch keine zweite Station
 * zum selben Verfall.
 */
async function recoverExpiredLeases(
  database: SqlQueryable,
  scope: ProjectQueueScope,
  queue: ProjectQueue,
  now: Date,
) {
  const expired = await database.query<{ id: unknown; attempt_count: unknown; lease_worker_id: unknown }>(
    `SELECT id,attempt_count,lease_worker_id FROM project_queue_messages
     WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
       AND status='in_flight' AND lease_expires_at <= $5
     ORDER BY id ASC FOR UPDATE`, [...scopeValues(scope), queue.id, now]);
  if (expired.rows.length === 0) return;
  await database.query(`${UPDATE_MESSAGE}
    SET status=CASE WHEN attempt_count >= $6 THEN 'dead_lettered' ELSE 'available' END,
        available_at=CASE WHEN attempt_count >= $6 THEN available_at ELSE $5 END,
        lease_worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,
        last_failure_code='LEASE_EXPIRED',
        dead_lettered_at=CASE WHEN attempt_count >= $6 THEN $5 ELSE NULL END
    WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
      AND status='in_flight' AND lease_expires_at <= $5`, [
    ...scopeValues(scope), queue.id, now, queue.maxAttempts,
  ]);
  for (const row of expired.rows) {
    const attempt = safeInteger(row.attempt_count);
    await recordTrace(database, scope, queue, String(row.id), {
      station: attempt >= queue.maxAttempts ? "dead_lettered" : "lease_expired",
      attempt,
      workerId: row.lease_worker_id === null ? null : String(row.lease_worker_id),
      failureCode: "LEASE_EXPIRED",
      occurredAt: now,
    });
  }
}

/**
 * Haengt eine Station an die Spur einer Nachricht, in einer Anweisung.
 *
 * Die Sequenz rechnet die Datenbank aus, und zwar in derselben Anweisung, die
 * schreibt: Zwei Abfragen daraus zu machen hiesse, zwischen Lesen und Schreiben
 * ein Fenster zu lassen, in dem eine zweite Station dieselbe Nummer bekommt.
 * Die Mengengrenze steht im `WHERE` und nicht im TypeScript: Eine Grenze, die
 * im Code steht, gilt nur fuer den Code, der sie kennt.
 *
 * Der Anschluss nach draussen landet nur auf Sequenz eins, auch wenn der
 * Aufrufer ihn mitgibt; `project_queue_message_traces_trace_anchor` aus 0081
 * verlangt genau das, und die Entscheidung steht in `trace.ts`.
 *
 * Die Span-Id dagegen wuerfelt der Prozess und nicht die Datenbank (2.124), und
 * sie kommt ueber `RETURNING` zurueck. Die Entscheidung, wer Spans erzeugt,
 * steht in Migration 0082; dass der Wert hier und nicht in einem Vorgabewert der
 * Spalte entsteht, hat einen einzigen Grund: Ein Vorgabewert wuerde einen
 * Schreiber, der die Spalte vergisst, still bedienen, und `RETURNING` koennte
 * dann nicht mehr unterscheiden, wer sie gesetzt hat.
 *
 * Erreicht die Spur die Grenze, schreibt die Anweisung keine Zeile und wirft
 * nicht: Eine Beobachtung ist keine Ausfuehrungsgewalt. Dass die Grenze
 * erreicht ist, sagt der Leser ueber `complete`, und der Claim traegt dann
 * keinen `traceparent` hinaus, weil es keine Station gibt, die er benennen
 * koennte.
 */
async function recordTrace(
  database: SqlQueryable,
  scope: ProjectQueueScope,
  queue: ProjectQueue,
  messageId: string,
  record: ProjectQueueTraceRecord,
): Promise<{ spanId: string | null }> {
  const result = await database.query<{ span_id: unknown }>(
    `INSERT INTO project_queue_message_traces
      (organization_id,project_id,environment,queue_id,message_id,sequence,station,attempt,
       worker_id,failure_code,trace_id,parent_span_id,span_id,source_message_id,
       occurred_at,expires_at)
    SELECT $1::uuid,$2::uuid,$3::qkern_environment,$4::uuid,$5::uuid,next.sequence,
      $6::text,$7::int,$8::text,$9::text,
      CASE WHEN next.sequence=1 THEN $10::text ELSE NULL END,
      CASE WHEN next.sequence=1 THEN $11::text ELSE NULL END,
      $12::text,$13::uuid,$14::timestamptz,$15::timestamptz
    FROM (SELECT coalesce(max(sequence),0)+1 AS sequence FROM project_queue_message_traces
          WHERE organization_id=$1::uuid AND project_id=$2::uuid
            AND environment=$3::qkern_environment AND message_id=$5::uuid) AS next
    WHERE next.sequence <= $16::int
    RETURNING span_id`, [
    ...scopeValues(scope), queue.id, messageId, record.station, record.attempt,
    record.workerId, record.failureCode, record.trace?.traceId ?? null,
    record.trace?.parentSpanId ?? null, projectQueueTraceSpanId(),
    record.sourceMessageId ?? null,
    record.occurredAt, projectQueueTraceExpiresAt(queue, record.occurredAt),
    PROJECT_QUEUE_TRACE_MAX_STATIONS,
  ]);
  // `RETURNING` ohne Zeile heisst: Die Grenze war erreicht, es wurde nichts
  // geschrieben. Dann gibt es auch keine Span, an die sich jemand haengen
  // koennte, und der Claim traegt nichts hinaus.
  const written = result.rows[0]?.span_id;
  return { spanId: written === null || written === undefined ? null : String(written) };
}

/**
 * Die Spur-Id einer Nachricht, also der Wert auf ihrer ersten Station.
 *
 * Eine eigene Anweisung und kein zweiter Rueckgabewert von `recordTrace`: Beide
 * laufen in derselben Transaktion, also ist nichts an der einen Anweisung
 * atomarer als an zwei, und eine `INSERT ... RETURNING`-Anweisung, die
 * nebenbei eine fremde Zeile mitliest, waere die Art Abfrage, die beim naechsten
 * Lesen niemand mehr versteht. Gerufen wird sie nur im Claim, also hoechstens
 * zehnmal je Abholung, und sie liest ueber
 * `project_queue_message_traces_order_key` genau eine Zeile.
 */
async function traceIdOf(
  database: SqlQueryable,
  scope: ProjectQueueScope,
  messageId: string,
): Promise<string | null> {
  const result = await database.query<{ trace_id: unknown }>(
    `SELECT trace_id FROM project_queue_message_traces
      WHERE organization_id=$1 AND project_id=$2 AND environment=$3
        AND message_id=$4 AND sequence=1`, [...scopeValues(scope), messageId]);
  const value = result.rows[0]?.trace_id;
  return value === null || value === undefined ? null : String(value);
}

/**
 * Der Anschluss nach draussen einer Nachricht, also ihre erste Station.
 *
 * **Eltern-Span bleibt der Span von draussen, auch beim Wiedereinreihen**, und
 * das ist eine Entscheidung aus 2.124, die anders ausgefallen ist als zuerst
 * gedacht. Der erste Entwurf liess eine wiedereingereihte Nachricht an der
 * letzten Station ihrer Quelle haengen, also an `dead_lettered`, mit dem
 * Argument: Verursacht hat das Wiedereinreihen das Dead Letter und nicht der
 * Aufruf von vorletzter Woche. Fall (2.121) hat ihn umgeworfen, und zwar zu
 * Recht.
 *
 * Der Grund ist die Bedeutung der Spalte. `parent_span_id` heisst "die Span
 * **draussen**, an der diese Nachricht haengt"; genau das sagt 0081 mit dem
 * CHECK, der sie an Sequenz eins und an eine Spur-Id bindet. Haengt sie bei
 * einer wiedereingereihten Nachricht an einer Station von QKERN, hat eine
 * Spalte zwei Bedeutungen, und welche gilt, erkennt der Leser nur daran, ob
 * `source_message_id` gesetzt ist. Zwei Bedeutungen in einer Spalte laufen
 * auseinander.
 *
 * Die Ursache steht ausserdem schon da, und zwar genauer: `source_message_id`
 * nennt das Dead Letter, aus dem diese Nachricht entstanden ist, und die Spur
 * laeuft darueber in beide Richtungen. Eine zweite Darstellung derselben
 * Beziehung waere keine Verbesserung.
 *
 * Fuer die Span-Kette nach draussen heisst das: QKERN gibt genau **eine** Kante
 * heraus, die vom Claim zum Worker, und die traegt die Span der
 * `claimed`-Station. Dass zwei Claims derselben Spur (einer vor und einer nach
 * dem Dead Letter) dieselbe Eltern-Span von draussen teilen, ist richtig: Beide
 * gehen wirklich auf denselben Aufruf zurueck.
 */
async function traceAnchor(
  database: SqlQueryable,
  scope: ProjectQueueScope,
  messageId: string,
): Promise<ProjectQueueTraceAnchor | null> {
  const result = await database.query<{ trace_id: unknown; parent_span_id: unknown }>(
    `SELECT trace_id,parent_span_id FROM project_queue_message_traces
     WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND message_id=$4
       AND sequence=1`, [...scopeValues(scope), messageId]);
  const row = result.rows[0];
  if (!row || row.trace_id === null || row.trace_id === undefined) return null;
  return Object.freeze({
    traceId: String(row.trace_id),
    parentSpanId: String(row.parent_span_id),
  });
}

function traceEntryFromRow(row: Row): ProjectQueueTraceEntry {
  const station = String(row.station);
  if (!(PROJECT_QUEUE_TRACE_STATIONS as readonly string[]).includes(station)) {
    throw new Error("Invalid queue trace station");
  }
  const failure = row.failure_code === null ? null : String(row.failure_code);
  if (failure !== null && !["HANDLER_ERROR", "HANDLER_TIMEOUT", "DEPENDENCY_UNAVAILABLE",
    "INVALID_PAYLOAD", "LEASE_EXPIRED"].includes(failure)) {
    throw new Error("Invalid queue trace failure code");
  }
  return Object.freeze({
    sequence: boundedInteger(row.sequence, 1, PROJECT_QUEUE_TRACE_MAX_STATIONS),
    station: station as ProjectQueueTraceStation,
    attempt: boundedInteger(row.attempt, 0, 20),
    workerId: row.worker_id === null ? null : String(row.worker_id),
    failureCode: failure as ProjectQueueFailureCode | null,
    // Die Form steht im CHECK aus 0082. Hier wird sie nochmals geprueft, weil
    // der Leser diesen Wert in eine Kopfzeile schreiben laesst und eine
    // Kopfzeile mit kaputtem Hex schlimmer ist als keine.
    spanId: hexSpan(row.span_id),
    occurredAt: date(row.occurred_at).toISOString(),
  });
}

/**
 * Eine Trefferzeile der Suche. Die Station wird gegen die Liste geprueft wie
 * ueberall, und ein Wirt kommt hier nicht vor: Die erste Station hat per CHECK
 * keinen, und die Abfrage liest die Spalte nicht einmal.
 */
function traceSearchEntryFromRow(row: Row): ProjectQueueTraceSearchEntry {
  const station = String(row.station);
  if (!(PROJECT_QUEUE_TRACE_STATIONS as readonly string[]).includes(station)) {
    throw new Error("Invalid queue trace station");
  }
  return Object.freeze({
    messageId: String(row.message_id),
    queue: String(row.queue),
    station: station as ProjectQueueTraceStation,
    spanId: hexSpan(row.span_id),
    parentSpanId: row.parent_span_id === null ? null : String(row.parent_span_id),
    sourceMessageId: row.source_message_id === null ? null : String(row.source_message_id),
    occurredAt: date(row.occurred_at).toISOString(),
  });
}

function hexSpan(value: unknown): string {
  const candidate = String(value);
  if (!/^[0-9a-f]{16}$/.test(candidate)) throw new Error("Invalid queue trace span id");
  return candidate;
}

async function cleanup(
  database: SqlQueryable,
  scope: ProjectQueueScope,
  queue: ProjectQueue,
  now: Date,
) {
  await database.query(`${UPDATE_MESSAGE}
    SET dedupe_key_hash=NULL,dedupe_expires_at=NULL
    WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
      AND dedupe_key_hash IS NOT NULL AND dedupe_expires_at <= $5`, [
    ...scopeValues(scope), queue.id, now,
  ]);
  const cutoff = new Date(now.getTime() - queue.retentionSeconds * 1_000);
  await database.query(`DELETE FROM project_queue_messages
    WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
      AND status='completed' AND completed_at < $5 AND dedupe_key_hash IS NULL`, [
    ...scopeValues(scope), queue.id, cutoff,
  ]);
  // Die Spuren danach, und mit eigener Frist: Geschnitten wird an `expires_at`
  // der Station und nie am Ausgang der Nachricht. Die Begruendung steht in
  // `trace.ts`; die Reihenfolge der beiden Loeschungen ist dagegen frei, denn
  // zwischen Nachricht und Spur gibt es keinen Fremdschluessel. Genau das ist
  // der Zweck: Die Spur ueberlebt die Nachricht, die sie beschreibt.
  //
  // Eine Portion je Aufruf, nicht die ganze Altlast. Dieses Aufraeumen haengt
  // am Einreihen und am Status, also an Wegen, auf die jemand wartet; eine
  // unbegrenzte Loeschung wuerde dort die Tabelle so lange halten, wie sie
  // dauert. Was liegen bleibt, holt der naechste Aufruf (das Muster aus 0063).
  await database.query(`DELETE FROM project_queue_message_traces
    WHERE ctid IN (SELECT ctid FROM project_queue_message_traces
      WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND queue_id=$4
        AND expires_at <= $5
      ORDER BY expires_at ASC LIMIT $6)`, [
    ...scopeValues(scope), queue.id, now, PROJECT_QUEUE_TRACE_PRUNE_BATCH,
  ]);
}

function scopeValues(scope: ProjectQueueScope): SqlValue[] {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function queueValues(queue: ProjectQueue): SqlValue[] {
  return [
    queue.id, queue.organizationId, queue.projectId, queue.environment, queue.name,
    queue.enqueuePolicy, queue.maxAttempts, queue.visibilityTimeoutSeconds,
    queue.retryBaseSeconds, queue.retryMaxSeconds, queue.dedupeWindowSeconds,
    queue.retentionSeconds, queue.maxPendingMessages, queue.createdAt, queue.updatedAt,
  ];
}

function queueFromRow(row: Row): ProjectQueue {
  const enqueuePolicy = String(row.enqueue_policy);
  if (!new Set(["authenticated", "service"]).has(enqueuePolicy)) throw new Error("Invalid queue policy");
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: environment(row.environment),
    name: String(row.name),
    enqueuePolicy: enqueuePolicy as ProjectQueue["enqueuePolicy"],
    maxAttempts: boundedInteger(row.max_attempts, 1, 20),
    visibilityTimeoutSeconds: boundedInteger(row.visibility_timeout_seconds, 5, 900),
    retryBaseSeconds: boundedInteger(row.retry_base_seconds, 1, 300),
    retryMaxSeconds: boundedInteger(row.retry_max_seconds, 1, 3_600),
    dedupeWindowSeconds: boundedInteger(row.dedupe_window_seconds, 0, 86_400),
    retentionSeconds: boundedInteger(row.retention_seconds, 60, 604_800),
    maxPendingMessages: boundedInteger(row.max_pending_messages, 1, 10_000),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function messageFromRow(row: Row): ProjectQueueMessage {
  const status = String(row.status);
  const failure = row.last_failure_code === null ? null : String(row.last_failure_code);
  if (!["available", "in_flight", "completed", "dead_lettered"].includes(status) ||
      (failure !== null && !["HANDLER_ERROR", "HANDLER_TIMEOUT", "DEPENDENCY_UNAVAILABLE",
        "INVALID_PAYLOAD", "LEASE_EXPIRED"].includes(failure))) {
    throw new Error("Invalid queue message state");
  }
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: environment(row.environment),
    queueId: String(row.queue_id),
    payload: json(row.payload),
    status: status as ProjectQueueMessage["status"],
    ownerSubject: String(row.owner_subject),
    dedupeKeyHash: row.dedupe_key_hash === null ? null : String(row.dedupe_key_hash),
    attemptCount: boundedInteger(row.attempt_count, 0, 20),
    availableAt: date(row.available_at),
    leaseWorkerId: row.lease_worker_id === null ? null : String(row.lease_worker_id),
    leaseTokenHash: row.lease_token_hash === null ? null : String(row.lease_token_hash),
    leaseSequence: safeInteger(row.lease_sequence),
    leaseExpiresAt: nullableDate(row.lease_expires_at),
    lastFailureCode: failure as ProjectQueueFailureCode | null,
    createdAt: date(row.created_at),
    completedAt: nullableDate(row.completed_at),
    deadLetteredAt: nullableDate(row.dead_lettered_at),
    replayedFromMessageId: row.replayed_from_message_id === null ? null : String(row.replayed_from_message_id),
  };
}

function json(value: unknown): ProjectQueueJson {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { throw new Error("Invalid queue payload"); }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > 256 * 1_024) {
    throw new Error("Invalid queue payload");
  }
  const parsed = JSON.parse(encoded) as ProjectQueueJson;
  validateJson(parsed, 0, { nodes: 0 });
  return parsed;
}

function validateJson(value: ProjectQueueJson, depth: number, state: { nodes: number }) {
  state.nodes += 1;
  if (depth > 12 || state.nodes > 4_000) throw new Error("Invalid queue payload");
  if (Array.isArray(value)) for (const item of value) validateJson(item, depth + 1, state);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("Invalid queue payload");
    }
    validateJson(item, depth + 1, state);
  }
}

function environment(value: unknown): ProjectQueueScope["environment"] {
  if (!["development", "staging", "production"].includes(String(value))) throw new Error("Invalid queue environment");
  return String(value) as ProjectQueueScope["environment"];
}

function boundedInteger(value: unknown, min: number, max: number) {
  const parsed = safeInteger(value);
  if (parsed < min || parsed > max) throw new Error("Invalid queue integer");
  return parsed;
}

function safeInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid queue integer");
  return parsed;
}

function date(value: unknown) {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid queue timestamp");
  return parsed;
}

function nullableDate(value: unknown) { return value === null ? null : date(value); }
