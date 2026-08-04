import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import { PostgresMigrationIncidentOutboxLeasePort } from "@/lib/server/migrations/postgres-incident-outbox";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";

describe("PostgreSQL migration incident outbox port", () => {
  it("scopes every fenced repository operation to one configured tenant", async () => {
    const claimNext = vi.fn().mockResolvedValue(null);
    const processPending = vi.fn().mockResolvedValue([]);
    const markPublished = vi.fn().mockResolvedValue({ id: "event" });
    const recordFailure = vi.fn().mockResolvedValue({ id: "event" });
    const releaseWithBackoff = vi.fn().mockResolvedValue({ id: "event" });
    const contexts: unknown[] = [];
    const database = {
      async withTenant<T>(context: unknown, operation: (repositories: ControlPlaneRepositories) => Promise<T>): Promise<T> {
        contexts.push(context);
        return operation({
          migrationIncidentDeliveryCommands: { processPending },
          migrationIncidentOutbox: { claimNext, markPublished, recordFailure, releaseWithBackoff },
        } as unknown as ControlPlaneRepositories);
      },
    };
    const port = new PostgresMigrationIncidentOutboxLeasePort(database, ORGANIZATION_ID);

    await port.processRetryCommands("incident-publisher", 20);
    await port.claimNext("incident-publisher", 30_000);
    await port.markPublished("event", "incident-publisher", "lease");
    await port.recordFailure("event", "incident-publisher", "lease", "PUBLISH_FAILED", 4_000);
    await port.releaseWithBackoff("event", "incident-publisher", "lease", 5_000);

    expect(contexts).toEqual([
      { organizationId: ORGANIZATION_ID, actorRef: "incident-publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "incident-publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "incident-publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "incident-publisher" },
      { organizationId: ORGANIZATION_ID, actorRef: "incident-publisher" },
    ]);
    expect(processPending).toHaveBeenCalledWith(20);
    expect(claimNext).toHaveBeenCalledWith("incident-publisher", 30_000);
    expect(markPublished).toHaveBeenCalledWith("event", "incident-publisher", "lease");
    expect(recordFailure).toHaveBeenCalledWith(
      "event", "incident-publisher", "lease", "PUBLISH_FAILED", 4_000,
    );
    expect(releaseWithBackoff).toHaveBeenCalledWith("event", "incident-publisher", "lease", 5_000);
  });
});
