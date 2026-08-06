import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MediatedFunctionEgress } from "@/lib/server/compute/function-egress";
import {
  DockerFunctionSandbox,
  SANDBOX_CONTAINER_PREFIX,
} from "@/lib/server/compute/function-sandbox-docker";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
import type { FunctionDefinition } from "@/lib/server/compute/model";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";

/**
 * Die Functions-Sandbox gegen eine echte Container-Laufzeit.
 *
 * `FunctionSandboxPort` existiert seit Release 1.6 Alpha 4 ohne Implementierung.
 * Egress-Policy, Ressourcenlimits und Secret-Canary — die drei Teile, die das
 * Austrittskriterium der Stufe 1.6 ausdrücklich nennt — waren damit ein
 * Versprechen im Vertrag und sonst nichts.
 *
 * Diese Datei prüft sie dort, wo sie gelten: an den Flags eines laufenden
 * Containers. Ein Test gegen einen nachgebildeten Sandbox-Port könnte keine
 * davon belegen.
 */

const image = process.env.QKERN_TEST_FUNCTION_IMAGE;
const enabled = Boolean(image);

// Erreicht dieser Wert den Container, ist die Umgebungsgrenze durchlaessig.
const CANARY = "qkern-canary-e2f7a1c48b6d";

/** Laufende Sandbox-Container. Nur die dieses Praefix, nie fremde. */
function runningSandboxContainers(): string[] {
  const result = spawnSync("docker", [
    "ps", "--filter", `name=${SANDBOX_CONTAINER_PREFIX}`, "--format", "{{.Names}}",
  ], { encoding: "utf8" });
  return (result.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

describe.runIf(enabled)("Function sandbox certification", () => {
  // Das Test-Image wird lokal gebaut und hat deshalb keinen Registry-Digest.
  // Der Schalter ist genau dafuer da und in der Produktion aus; ein eigener
  // Fall unten belegt das.
  const sandbox = new DockerFunctionSandbox({ allowLocalImageId: true });
  let previousCanary: string | undefined;

  beforeAll(() => {
    previousCanary = process.env.QKERN_TEST_SECRET_CANARY;
    process.env.QKERN_TEST_SECRET_CANARY = CANARY;
  });

  afterAll(() => {
    if (previousCanary === undefined) delete process.env.QKERN_TEST_SECRET_CANARY;
    else process.env.QKERN_TEST_SECRET_CANARY = previousCanary;
  });

  function definition(overrides: Partial<FunctionDefinition> = {}): FunctionDefinition {
    return Object.freeze({
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      environment: "development" as const,
      id: "33333333-3333-4333-8333-333333333333",
      name: "sandbox-probe",
      runtime: "nodejs24" as const,
      image: image!,
      entrypoint: "handler.mjs",
      timeoutMs: 60_000,
      memoryMiB: 128,
      maxConcurrency: 1,
      egressOrigins: Object.freeze([]),
      secretRefs: Object.freeze(["vault:functions/probe"]),
      ...overrides,
    });
  }

  async function call(
    payload: ProjectQueueJson,
    overrides: Partial<FunctionDefinition> = {},
    runner = sandbox,
  ) {
    const target = definition(overrides);
    return await runner.invoke(target, Object.freeze({
      id: "44444444-4444-4444-8444-444444444444",
      functionId: target.id,
      payload,
      requestedAt: "2026-08-05T12:00:00.000Z",
    }), { signal: AbortSignal.timeout(target.timeoutMs) });
  }

  it("runs a function and returns its bounded result", async () => {
    const result = await call({ mode: "echo", value: 42 });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ received: 42 });
  });

  it("hands the function references, never secret values", async () => {
    const result = await call({ mode: "echo" });
    expect(result.body).toMatchObject({ secretRefs: ["vault:functions/probe"] });
  });

  it("keeps the runtime environment out of the container", async () => {
    // Der Canary steht in der Umgebung dieses Testlaufs. Taucht er im Container
    // auf, reicht die Runtime ihre eigene Umgebung durch — und damit
    // Datenbankadressen, Vault-Token und Signaturschluessel.
    const result = await call({ mode: "environment" });
    const environment = (result.body as { environment: string[] }).environment;
    expect(environment.join("\n")).not.toContain(CANARY);
    expect(environment.some((entry) => entry.startsWith("QKERN_"))).toBe(false);
  });

  it("denies egress", async () => {
    const result = await call({ mode: "egress" });
    expect(result.body).toMatchObject({ reached: false });
  });

  it("refuses a definition that asks for allowed egress when nobody mediates it", async () => {
    // Fail closed: Eine Liste, die niemand bedient, waere ein stiller Bruch der
    // Zusage, die sie ausdrueckt.
    await expect(call({ mode: "echo" }, {
      egressOrigins: Object.freeze(["https://api.example.com"]),
    })).rejects.toMatchObject({ code: "FUNCTION_INVALID" });
  });

  it("lets a mediated request through to an allowed origin", async () => {
    // Der Container behaelt `--network none`. Die Verbindung stellt die Runtime
    // her, und sie prueft dabei die Allowlist der Definition.
    const mediated = new DockerFunctionSandbox({
      allowLocalImageId: true,
      egress: new MediatedFunctionEgress({
        fetchFn: async () => new Response('{"pong":true}', {
          headers: { "content-type": "application/json" },
        }),
      }),
    });
    const result = await call({ mode: "mediated" }, {
      egressOrigins: Object.freeze(["https://api.example.com"]),
    }, mediated);
    expect(result.body).toMatchObject({ outcome: { status: 200, body: '{"pong":true}' } });
  });

  it("refuses a mediated request to an origin outside the allowlist", async () => {
    let called = false;
    const mediated = new DockerFunctionSandbox({
      allowLocalImageId: true,
      egress: new MediatedFunctionEgress({
        fetchFn: async () => { called = true; return new Response("{}"); },
      }),
    });
    const result = await call({
      mode: "mediated", url: "https://api.example.com.evil.test/v1/ping",
    }, { egressOrigins: Object.freeze(["https://api.example.com"]) }, mediated);

    expect(result.body).toMatchObject({ outcome: { error: "EGRESS_NOT_ALLOWED" } });
    // Die Anfrage wurde nie gestellt, nicht nur ihr Ergebnis verworfen.
    expect(called).toBe(false);
  });

  it("bounds how many outbound requests one invocation may make", async () => {
    const mediated = new DockerFunctionSandbox({
      allowLocalImageId: true,
      egress: new MediatedFunctionEgress({
        maxRequests: 3,
        fetchFn: async () => new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      }),
    });
    const result = await call({ mode: "mediated-burst", count: 6 }, {
      egressOrigins: Object.freeze(["https://api.example.com"]),
    }, mediated);
    expect(result.body).toMatchObject({ allowed: 3, refused: 3 });
  });

  it("refuses an allowlisted origin whose name points at a private address", async () => {
    // Die Allowlist allein genuegt nicht: Ein Name gehoert dem, der ihn
    // betreibt, und darf jederzeit auf 169.254.169.254 oder 10.0.0.5 zeigen.
    // Geprueft wird deshalb die Adresse, nicht der Name.
    const mediated = new DockerFunctionSandbox({
      allowLocalImageId: true,
      egress: new MediatedFunctionEgress({
        resolver: { async resolve() { return [{ address: "169.254.169.254", family: 4 as const }]; } },
      }),
    });
    const result = await call({ mode: "mediated" }, {
      egressOrigins: Object.freeze(["https://api.example.com"]),
    }, mediated);
    expect(result.body).toMatchObject({ outcome: { error: "EGRESS_BLOCKED" } });
  });

  it("still denies a direct connection even while mediation is available", async () => {
    // Der Kanal ersetzt das Netz, er ergaenzt es nicht.
    const mediated = new DockerFunctionSandbox({
      allowLocalImageId: true,
      egress: new MediatedFunctionEgress({ fetchFn: async () => new Response("{}") }),
    });
    const result = await call({ mode: "egress" }, {
      egressOrigins: Object.freeze(["https://api.example.com"]),
    }, mediated);
    expect(result.body).toMatchObject({ reached: false });
  });

  it("runs as a non-root user", async () => {
    const result = await call({ mode: "identity" });
    expect(result.body).toMatchObject({ uid: 65534 });
  });

  it("denies a write outside the temporary filesystem", async () => {
    const result = await call({ mode: "write" });
    expect(result.body).toMatchObject({ wrote: false });
  });

  it("enforces the memory limit instead of letting the host absorb it", async () => {
    await expect(call({ mode: "memory" })).rejects.toBeInstanceOf(FunctionInvocationError);
  });

  it("kills a function that outruns its timeout", async () => {
    const target = definition({ timeoutMs: 3_000 });
    await expect(sandbox.invoke(target, {
      id: "55555555-5555-4555-8555-555555555555",
      functionId: target.id,
      payload: { mode: "sleep" },
      requestedAt: "2026-08-05T12:00:00.000Z",
    }, { signal: AbortSignal.timeout(3_000) }))
      .rejects.toMatchObject({ code: "FUNCTION_TIMEOUT" });
  }, 30_000);

  it("leaves no container running after a timeout", async () => {
    // Den Docker-Client zu toeten beendet den Container nicht. Ohne die
    // erzwungene Entfernung lief eine Function nach ihrem Timeout unbegrenzt
    // weiter: Der Aufrufer sah einen sauberen Fehler, waehrend Speicher und CPU
    // weiter verbraucht wurden. Genau das hatte der erste Zertifizierungslauf
    // uebersehen, weil er nur die Antwort des Aufrufers geprueft hat.
    const target = definition({ timeoutMs: 3_000 });
    await expect(sandbox.invoke(target, {
      id: "66666666-6666-4666-8666-666666666666",
      functionId: target.id,
      payload: { mode: "sleep" },
      requestedAt: "2026-08-05T12:00:00.000Z",
    }, { signal: AbortSignal.timeout(3_000) })).rejects.toBeInstanceOf(FunctionInvocationError);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (runningSandboxContainers().length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(runningSandboxContainers()).toEqual([]);
  }, 40_000);

  it("refuses an oversized response rather than buffering it", async () => {
    await expect(call({ mode: "flood" })).rejects.toMatchObject({
      code: "FUNCTION_SANDBOX_FAILED",
    });
  });

  it("refuses a mutable image reference", async () => {
    // Ein Tag koennte morgen einen anderen Inhalt bezeichnen.
    await expect(call({ mode: "echo" }, { image: "node:24-alpine" })).rejects.toMatchObject({
      code: "FUNCTION_INVALID",
    });
  });

  it("refuses a local image id unless the certification seam is switched on", async () => {
    // Belegt, dass der Schalter wirklich ein Schalter ist: Ohne ihn gilt exakt
    // die Regel der Definition, naemlich eine Registry-Referenz mit Digest.
    const strict = new DockerFunctionSandbox();
    await expect(call({ mode: "echo" }, {}, strict)).rejects.toMatchObject({
      code: "FUNCTION_INVALID",
    });
  });
});
