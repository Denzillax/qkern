import { describe, expect, it } from "vitest";
import {
  computeScopeOrganizationFromEnv,
  computeScopeSourceFromEnv,
  ComputeScopeCensusRuntime,
  countAgainst,
  MAX_COMPUTE_SCOPES,
  resolveComputeScopes,
  type ComputeScopeCatalog,
  type ComputeScopeConfig,
} from "@/lib/server/compute/scope-discovery";

/**
 * Die Scope-Entdeckung (2.107) ohne Datenbank.
 *
 * Was hier steht, ist die Entscheidung: welche Quelle gilt, was zusammen
 * verboten ist, was gezaehlt wird. Dass die Zeilen aus `project_environments`
 * wirklich so herauskommen und dass die Laufzeitrolle die fremde Organisation
 * nicht sieht, belegt der PostgreSQL-Fall "(2.107)". Diese Datei entscheidet
 * nichts ueber die Datenbank und behauptet nichts darueber.
 */
const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION = "22222222-2222-4222-8222-222222222222";

function scope(projectId: string, environment: "development" | "staging" | "production",
  organizationId = ORGANIZATION): ComputeScopeConfig {
  return Object.freeze({ organizationId, projectId, environment });
}

const alpha = scope("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "development");
const beta = scope("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "production");

function catalogOf(...environments: ComputeScopeConfig[]): ComputeScopeCatalog {
  return { environments: async () => environments };
}

describe("compute scope source from env", () => {
  it("stays on the explicit list when nothing says otherwise", () => {
    expect(computeScopeSourceFromEnv({})).toBe("static-env");
    expect(computeScopeSourceFromEnv({ QKERN_COMPUTE_SCOPE_SOURCE: "" })).toBe("static-env");
    expect(computeScopeSourceFromEnv({ QKERN_COMPUTE_SCOPE_SOURCE: "static-env" }))
      .toBe("static-env");
  });

  it("takes the discovery only when it is named", () => {
    expect(computeScopeSourceFromEnv({ QKERN_COMPUTE_SCOPE_SOURCE: "control-plane" }))
      .toBe("control-plane");
  });

  it("refuses a third name instead of falling back to one of the two", () => {
    // Ein Tippfehler darf nicht in einem der beiden Wege landen. Beide sind
    // vertretbar, und genau deshalb waere jede Vorgabe hier eine Vermutung.
    expect(() => computeScopeSourceFromEnv({ QKERN_COMPUTE_SCOPE_SOURCE: "controlplane" }))
      .toThrow(/static-env or control-plane/);
  });

  it("reads the organization as a UUID or not at all", () => {
    expect(computeScopeOrganizationFromEnv({})).toBeUndefined();
    expect(computeScopeOrganizationFromEnv({ QKERN_COMPUTE_ORGANIZATION_ID: "  " }))
      .toBeUndefined();
    expect(computeScopeOrganizationFromEnv({ QKERN_COMPUTE_ORGANIZATION_ID: ORGANIZATION }))
      .toBe(ORGANIZATION);
    expect(() => computeScopeOrganizationFromEnv({ QKERN_COMPUTE_ORGANIZATION_ID: "acme" }))
      .toThrow(/must be a UUID/);
  });
});

describe("resolve compute scopes", () => {
  it("keeps the explicit list, and needs one", async () => {
    const resolved = await resolveComputeScopes({ source: "static-env", configured: [alpha] });
    expect(resolved.source).toBe("static-env");
    expect(resolved.scopes).toEqual([alpha]);
    expect(resolved.unserved).toBe(0);
    await expect(resolveComputeScopes({ source: "static-env" }))
      .rejects.toThrow(/QKERN_COMPUTE_SCOPES_JSON is required/);
  });

  it("counts against the control plane even on the explicit path", async () => {
    // Gerade dort ist die Zaehlung etwas wert: Eine Umgebung, die in der von
    // Hand gepflegten Liste fehlt, faellt sonst niemandem auf.
    const resolved = await resolveComputeScopes({
      source: "static-env", configured: [alpha],
      organizationId: ORGANIZATION, catalog: catalogOf(alpha, beta),
    });
    expect(resolved.scopes).toEqual([alpha]);
    expect(resolved.unserved).toBe(1);
    expect(resolved.stale).toBe(0);
  });

  it("does not count without an organization, because it could not", async () => {
    const resolved = await resolveComputeScopes({
      source: "static-env", configured: [alpha], catalog: catalogOf(alpha, beta),
    });
    expect(resolved.unserved).toBe(0);
  });

  it("discovers the environments of the one organization", async () => {
    const resolved = await resolveComputeScopes({
      source: "control-plane", organizationId: ORGANIZATION, catalog: catalogOf(alpha, beta),
    });
    expect(resolved.source).toBe("control-plane");
    expect(resolved.scopes).toEqual([alpha, beta]);
  });

  it("needs the organization, because the runtime role sees only one", async () => {
    await expect(resolveComputeScopes({
      source: "control-plane", catalog: catalogOf(alpha),
    })).rejects.toThrow(/QKERN_COMPUTE_ORGANIZATION_ID/);
  });

  it("refuses the explicit list beside the discovery", async () => {
    // Zwei Wahrheiten ueber denselben Prozess, von denen eine stillschweigend
    // verliert, sind der Zustand, den dieser Schnitt beseitigt.
    await expect(resolveComputeScopes({
      source: "control-plane", organizationId: ORGANIZATION,
      catalog: catalogOf(alpha), configured: [beta],
    })).rejects.toThrow(/cannot be mixed/);
  });

  it("falls when the discovery finds nothing, instead of running idle", async () => {
    await expect(resolveComputeScopes({
      source: "control-plane", organizationId: ORGANIZATION, catalog: catalogOf(),
    })).rejects.toThrow(/found no environment/);
  });

  it("falls above the limit instead of serving a part and looking complete", async () => {
    const many = Array.from({ length: MAX_COMPUTE_SCOPES + 1 }, (_entry, index) =>
      scope(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`, "development"));
    await expect(resolveComputeScopes({
      source: "control-plane", organizationId: ORGANIZATION, catalog: catalogOf(...many),
    })).rejects.toThrow(/more than 32 environments/);
  });
});

describe("count against the control plane", () => {
  it("counts in both directions", () => {
    expect(countAgainst([alpha], [alpha, beta], ORGANIZATION))
      .toEqual({ unserved: 1, stale: 0 });
    expect(countAgainst([alpha, beta], [alpha], ORGANIZATION))
      .toEqual({ unserved: 0, stale: 1 });
    expect(countAgainst([alpha], [alpha], ORGANIZATION))
      .toEqual({ unserved: 0, stale: 0 });
  });

  it("says nothing about an organization it cannot see", () => {
    // Ein Bereich einer fremden Organisation als veraltet zu zaehlen waere eine
    // Aussage ueber etwas, das diese Sicht nicht sehen darf.
    const foreign = scope("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "development",
      OTHER_ORGANIZATION);
    expect(countAgainst([alpha, foreign], [alpha], ORGANIZATION))
      .toEqual({ unserved: 0, stale: 0 });
  });
});

describe("compute scope census runtime", () => {
  it("reports only a round that has something to say", async () => {
    const seen: Array<{ unserved: number; stale: number }> = [];
    const census = new ComputeScopeCensusRuntime({
      catalog: catalogOf(alpha), organizationId: ORGANIZATION, scopes: [alpha],
      intervalMs: 1_000,
      onCensus: (counted) => seen.push({ ...counted }),
      sleep: async () => { census.stop(); },
    });
    await census.run();
    expect(seen).toEqual([]);
  });

  it("reports the two numbers when a round finds a difference", async () => {
    const seen: Array<{ unserved: number; stale: number }> = [];
    const census = new ComputeScopeCensusRuntime({
      catalog: catalogOf(alpha, beta), organizationId: ORGANIZATION, scopes: [alpha],
      intervalMs: 1_000,
      onCensus: (counted) => seen.push({ ...counted }),
      sleep: async () => { census.stop(); },
    });
    await census.run();
    expect(seen).toEqual([{ unserved: 1, stale: 0 }]);
  });

  it("keeps running when the count fails, because counting is observation", async () => {
    let failures = 0;
    const census = new ComputeScopeCensusRuntime({
      catalog: { environments: async () => { throw new Error("unreachable"); } },
      organizationId: ORGANIZATION, scopes: [alpha], intervalMs: 1_000,
      onFailure: () => { failures += 1; },
      sleep: async () => { census.stop(); },
    });
    await census.run();
    expect(failures).toBe(1);
  });

  it("refuses an interval outside its bounds", () => {
    expect(() => new ComputeScopeCensusRuntime({
      catalog: catalogOf(alpha), organizationId: ORGANIZATION, scopes: [alpha], intervalMs: 10,
    })).toThrow(/between 1000 and 86400000/);
  });
});
