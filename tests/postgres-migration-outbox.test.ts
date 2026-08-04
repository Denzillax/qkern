import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import { PostgresMigrationOutboxLeasePort } from "@/lib/server/migrations/postgres-outbox";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";

describe("PostgreSQL migration outbox port", () => {
  it("scopes every fenced repository operation to one configured tenant", async () => {
    const claimNext = vi.fn().mockResolvedValue(null);
    const markPublished = vi.fn().mockResolvedValue({ id: "event" });
    const recordFailure = vi.fn().mockResolvedValue({ id: "event" });
    const releaseWithBackoff = vi.fn().mockResolvedValue({ id: "event" });
    const processPending = vi.fn().mockResolvedValue([]);
    const contexts: unknown[] = [];
    const database = {
      async withTenant<T>(context: unknown, operation: (repositories: ControlPlaneRepositories) => Promise<T>): Promise<T> {
        contexts.push(context);
        return operation({
          migrationOutbox: { claimNext, markPublished, recordFailure, releaseWithBackoff },
          migrationOutboxDeliveryCommands: { processPending },
        } as unknown as ControlPlaneRepositories);
      },
    };
    const port = new PostgresMigrationOutboxLeasePort(database, ORGANIZATION_ID);

    await port.processRetryCommands("publisher", 7);
    await port.claimNext("publisher", 30_000);
    await port.markPublished("event", "publisher", "lease");
    await port.recordFailure("event", "publisher", "lease", "DELIVERY_TIMEOUT", 6_000);
    await port.releaseWithBackoff("event", "publisher", "lease", 5_000);

    expect(contexts).toEqual([
      { organizationId: ORGANIZATION_ID, actorRef: "publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "publisher" },
    ]);
    expect(processPending).toHaveBeenCalledWith(7);
    expect(claimNext).toHaveBeenCalledWith("publisher", 30_000);
    expect(markPublished).toHaveBeenCalledWith("event", "publisher", "lease");
    expect(recordFailure).toHaveBeenCalledWith("event", "publisher", "lease", "DELIVERY_TIMEOUT", 6_000);
    expect(releaseWithBackoff).toHaveBeenCalledWith("event", "publisher", "lease", 5_000);
  });
});
