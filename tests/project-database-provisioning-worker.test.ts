import { describe, expect, it, vi } from "vitest";
import type {
  ProjectDatabaseBindingRecord,
  ProjectDatabaseProvisioningJobRecord,
} from "@/lib/server/db/models";
import {
  PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
  ProjectDatabaseProvisioningAdapterError,
  ProjectDatabaseProvisioningWorker,
  type ProjectDatabaseProvisioningAdapter,
  type ProjectDatabaseProvisioningPort,
  type ProjectDatabaseProvisioningWorkerOptions,
  type ProvisionedProjectDatabaseBinding,
} from "@/lib/server/provisioning/worker";

const NOW = new Date("2026-07-20T08:00:00.000Z");
const job = (overrides: Partial<ProjectDatabaseProvisioningJobRecord> = {}): ProjectDatabaseProvisioningJobRecord => ({
  id: "940cb242-32d6-41fd-b244-67d4913f7b91",
  organizationId: "0d9423d9-7437-4f66-898a-86275e6598fb",
  projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6",
  environment: "production",
  requestedBy: "user-1",
  status: "running",
  attemptCount: 1,
  maxAttempts: 5,
  retryCycleCount: 0,
  maxRetryCycles: 3,
  availableAt: NOW.toISOString(),
  leaseOwner: "provisioner-1",
  leaseToken: "lease-1",
  leaseExpiresAt: "2026-07-20T08:01:00.000Z",
  lastErrorCode: null,
  bindingId: null,
  startedAt: NOW.toISOString(),
  finishedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...overrides,
});

const binding: ProvisionedProjectDatabaseBinding = {
  databaseInstanceRef: "managed:database-1",
  vaultStaticRole: "project-database-1",
  host: "db.customer.example",
  port: 5432,
  expectedRole: "qkern_project_migrator",
  expectedDatabase: "project_database",
  expectedLedgerOwner: "qkern_ledger_owner",
  serverCertificateSha256: "ab".repeat(32),
  bootstrapContractSha256: PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
};

function fixture(overrides: { claimed?: ProjectDatabaseProvisioningJobRecord | null } = {}) {
  const claimed = overrides.claimed === undefined ? job() : overrides.claimed;
  const succeeded = job({
    status: "succeeded", leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    bindingId: "f9a5c34f-5886-4a67-af2d-991cc5036ff3", finishedAt: NOW.toISOString(),
  });
  const storedBinding: ProjectDatabaseBindingRecord = {
    id: succeeded.bindingId!, organizationId: succeeded.organizationId, projectId: succeeded.projectId,
    environment: succeeded.environment, provisioningJobId: succeeded.id, ...binding, createdAt: NOW.toISOString(),
  };
  const port: ProjectDatabaseProvisioningPort = {
    heartbeat: vi.fn(async () => undefined),
    quarantineExpired: vi.fn(async () => []),
    claimNext: vi.fn(async () => claimed ? { job: claimed, region: "eu-central-1" } : null),
    complete: vi.fn(async () => ({ job: succeeded, binding: storedBinding })),
    recordFailure: vi.fn(async (_claim, _owner, _token, errorCode) => job({
      status: "pending", leaseOwner: null, leaseToken: null, leaseExpiresAt: null, lastErrorCode: errorCode,
    })),
    releaseAfterAbort: vi.fn(async () => job({
      status: "pending", attemptCount: 0, leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    })),
  };
  return { port, claimed };
}

function worker(
  port: ProjectDatabaseProvisioningPort,
  adapter: ProjectDatabaseProvisioningAdapter,
  overrides: Partial<ProjectDatabaseProvisioningWorkerOptions> = {},
) {
  return new ProjectDatabaseProvisioningWorker(port, adapter, {
    provisionerId: "provisioner-1",
    now: () => NOW,
    ...overrides,
  });
}

describe("project database provisioning worker", () => {
  it("sends a reference-only contract and atomically completes a validated binding", async () => {
    const { port } = fixture();
    const provision = vi.fn<ProjectDatabaseProvisioningAdapter["provision"]>(async () => binding);
    await expect(worker(port, { provision }).runOnce()).resolves.toEqual({
      status: "succeeded", jobId: job().id,
    });
    expect(provision).toHaveBeenCalledWith({
      provisioningJobId: job().id,
      organizationId: job().organizationId,
      projectId: job().projectId,
      environment: "production",
      region: "eu-central-1",
      bootstrapContractSha256: PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
    }, { signal: undefined });
    expect(JSON.stringify(provision.mock.calls[0]?.[0])).not.toMatch(/password|credential|databaseUrl/i);
    expect(port.complete).toHaveBeenCalledWith(
      expect.objectContaining({ job: expect.objectContaining({ id: job().id }) }),
      "provisioner-1", "lease-1", binding,
    );
  });

  it("fails closed on unverified bootstrap and never stores the binding", async () => {
    const { port } = fixture();
    const invalid = { ...binding, bootstrapContractSha256: "cd".repeat(32) };
    await expect(worker(port, { provision: vi.fn(async () => invalid) }).runOnce())
      .resolves.toEqual({ status: "retry_scheduled", jobId: job().id });
    expect(port.recordFailure).toHaveBeenCalledWith(
      expect.anything(), "provisioner-1", "lease-1", "BOOTSTRAP_UNVERIFIED", 1_000,
    );
    expect(port.complete).not.toHaveBeenCalled();
  });

  it.each([
    { ...binding, host: "https://db.customer.example" },
    { ...binding, expectedRole: "pg_read_all_data" },
    { ...binding, expectedDatabase: "pg_database" },
    { ...binding, expectedLedgerOwner: "pg_database_owner" },
  ])("rejects unsafe target boundaries before persistence", async (invalid) => {
    const { port } = fixture();
    await expect(worker(port, { provision: vi.fn(async () => invalid) }).runOnce())
      .resolves.toMatchObject({ status: "retry_scheduled" });
    expect(port.recordFailure).toHaveBeenCalledWith(
      expect.anything(), "provisioner-1", "lease-1", "INVALID_BINDING", 1_000,
    );
    expect(port.complete).not.toHaveBeenCalled();
  });

  it("persists only fixed provider failure codes", async () => {
    const { port } = fixture();
    const adapter: ProjectDatabaseProvisioningAdapter = {
      provision: vi.fn(async () => { throw new ProjectDatabaseProvisioningAdapterError("PROVIDER_REJECTED"); }),
    };
    await expect(worker(port, adapter).runOnce()).resolves.toMatchObject({ status: "retry_scheduled" });
    expect(port.recordFailure).toHaveBeenCalledWith(
      expect.anything(), "provisioner-1", "lease-1", "PROVIDER_REJECTED", 1_000,
    );
  });

  it("releases an aborted claim without recording a provider failure", async () => {
    const { port } = fixture();
    const controller = new AbortController();
    const provision = vi.fn<ProjectDatabaseProvisioningAdapter["provision"]>(
      async (_request, options) => new Promise<ProvisionedProjectDatabaseBinding>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("provider secret")), { once: true });
      }),
    );
    const adapter: ProjectDatabaseProvisioningAdapter = { provision };
    const running = worker(port, adapter).runOnce(controller.signal);
    await vi.waitFor(() => expect(adapter.provision).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).resolves.toEqual({ status: "aborted", jobId: job().id });
    expect(port.releaseAfterAbort).toHaveBeenCalledOnce();
    expect(port.recordFailure).not.toHaveBeenCalled();
  });

  it("quarantines exhausted leases before claiming more work", async () => {
    const exhausted = job({ attemptCount: 5, leaseExpiresAt: "2026-07-20T07:59:00.000Z" });
    const { port } = fixture({ claimed: null });
    vi.mocked(port.quarantineExpired).mockResolvedValue([exhausted]);
    await expect(worker(port, { provision: vi.fn(async () => binding) }).runOnce()).resolves.toEqual({ status: "idle" });
    expect(vi.mocked(port.heartbeat).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(port.quarantineExpired).mock.invocationCallOrder[0]!);
    expect(vi.mocked(port.quarantineExpired).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(port.claimNext).mock.invocationCallOrder[0]!);
  });

  it("fails closed before claims when its persisted heartbeat cannot be written", async () => {
    const { port } = fixture();
    vi.mocked(port.heartbeat).mockRejectedValue(new Error("database unavailable"));
    await expect(worker(port, { provision: vi.fn(async () => binding) }).runOnce())
      .resolves.toEqual({ status: "claim_failed" });
    expect(port.quarantineExpired).not.toHaveBeenCalled();
    expect(port.claimNext).not.toHaveBeenCalled();
  });

  it("reports loop lifecycle and current queue readiness without exposing job data", async () => {
    const { port } = fixture({ claimed: null });
    const controller = new AbortController();
    const probe = {
      runtimeStarted: vi.fn(),
      iterationSucceeded: vi.fn(),
      iterationFailed: vi.fn(),
      runtimeStopped: vi.fn(),
    };
    const delay = vi.fn((_milliseconds: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    const running = worker(port, { provision: vi.fn(async () => binding) }, { delay, probe })
      .run(controller.signal);

    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).resolves.toBeUndefined();

    expect(probe.runtimeStarted).toHaveBeenCalledOnce();
    expect(probe.iterationSucceeded).toHaveBeenCalledOnce();
    expect(probe.iterationFailed).not.toHaveBeenCalled();
    expect(probe.runtimeStopped).toHaveBeenCalledOnce();
  });
});
