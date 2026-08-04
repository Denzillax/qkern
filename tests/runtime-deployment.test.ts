import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { itOnPosix } from "./support/posix";
import {
  RuntimeDeploymentFileReader,
  RuntimeDeploymentNotReadyError,
  RuntimeDeploymentVerifier,
  generateRuntimeDeploymentBundle,
  type RuntimeDeploymentBundleProvider,
  type RuntimeDeploymentOptions,
} from "@/lib/server/operations/runtime-deployment";
import {
  createRuntimeDeploymentVerifierFromEnv,
  runtimeDeploymentOptionsFromEnv,
} from "@/lib/server/operations/runtime-deployment-runtime";

const IMAGE = `registry.example.com/qkern/platform@sha256:${"a".repeat(64)}`;
const OPTIONS: RuntimeDeploymentOptions = {
  namespace: "qkern",
  image: IMAGE,
  configMapName: "qkern-runtime-config",
  secretName: "qkern-runtime-secrets",
};
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function provider(value: unknown): RuntimeDeploymentBundleProvider {
  return { read: async () => Buffer.from(JSON.stringify(value)) };
}

function deployments(bundle: any): any[] {
  return bundle.items.filter((item: any) => item.kind === "Deployment");
}

describe("background runtime deployment generator", () => {
  it("renders four isolated digest-pinned workloads and no public network resource", () => {
    const bundle: any = generateRuntimeDeploymentBundle(OPTIONS);
    expect(bundle.apiVersion).toBe("v1");
    expect(bundle.kind).toBe("List");
    expect(bundle.items).toHaveLength(8);
    expect(bundle.items.filter((item: any) => item.kind === "ServiceAccount")).toHaveLength(4);
    expect(deployments(bundle)).toHaveLength(4);
    expect(new Set(bundle.items.map((item: any) => item.kind)))
      .toEqual(new Set(["ServiceAccount", "Deployment"]));

    for (const deployment of deployments(bundle)) {
      const pod = deployment.spec.template.spec;
      const container = pod.containers[0];
      expect(deployment.spec).toMatchObject({
        replicas: 1,
        strategy: { type: "Recreate" },
      });
      expect(pod).toMatchObject({
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        hostNetwork: false,
        hostPID: false,
        hostIPC: false,
        terminationGracePeriodSeconds: 90,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 10_001,
          seccompProfile: { type: "RuntimeDefault" },
        },
      });
      expect(pod.containers).toHaveLength(1);
      expect(container.image).toBe(IMAGE);
      expect(container.securityContext).toEqual({
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        privileged: false,
        capabilities: { drop: ["ALL"] },
      });
      expect(container.livenessProbe.exec.command[2]).toContain("127.0.0.1:9464/live");
      expect(container.readinessProbe.exec.command[2]).toContain("127.0.0.1:9464/ready");
      expect(container.ports).toBeUndefined();
      expect(container.envFrom).toBeUndefined();
    }
    expect(JSON.stringify(bundle)).not.toMatch(
      /postgresql:\/\/|hmac-secret-value|bearer|password|credential-value/i,
    );
  });

  it("rejects unpinned, placeholder and ambiguously named inputs", () => {
    const invalid: RuntimeDeploymentOptions[] = [
      { ...OPTIONS, image: "registry.example.com/qkern/platform:latest" },
      {
        ...OPTIONS,
        image: `registry.example.invalid/qkern/platform@sha256:${"a".repeat(64)}`,
      },
      {
        ...OPTIONS,
        image: `registry.example.com/qkern/platform@sha256:${"0".repeat(64)}`,
      },
      { ...OPTIONS, namespace: "QKERN" },
      { ...OPTIONS, namespace: "qkern.production" },
      { ...OPTIONS, configMapName: OPTIONS.secretName },
      { ...OPTIONS, configMapName: "qkern.-runtime" },
      { ...OPTIONS, secretName: "bad_name" },
    ];
    for (const options of invalid) {
      expect(() => generateRuntimeDeploymentBundle(options))
        .toThrow("digest-pinned image");
    }
  });
});

describe("background runtime deployment policy", () => {
  it("accepts only the exact hardened bundle and returns a fixed readiness projection", async () => {
    const bundle = generateRuntimeDeploymentBundle(OPTIONS);
    const readiness = await new RuntimeDeploymentVerifier(provider(bundle), OPTIONS).verify();
    expect(readiness).toEqual({
      status: "ready",
      deployment: "production",
      componentCount: 4,
      components: [
        "project-provisioner",
        "migration-worker",
        "apply-publisher",
        "incident-publisher",
      ],
      policy: {
        digestPinnedImage: true,
        nonRoot: true,
        readOnlyRootFilesystem: true,
        privilegeEscalationDisabled: true,
        capabilitiesDropped: true,
        serviceAccountTokenDisabled: true,
        hostNamespacesDisabled: true,
        loopbackExecProbes: true,
        oneContainerPerWorkload: true,
        oneReplicaPerWorkload: true,
        publicNetworkResourcesAbsent: true,
      },
    });
    expect(JSON.stringify(readiness)).not.toMatch(
      /registry\.example|qkern-runtime-config|qkern-runtime-secrets|postgresql:\/\/|https?:\/\//i,
    );
  });

  it("fails closed for image, privilege, probe, command, replica and exposure drift", async () => {
    const mutations: Array<(bundle: any) => void> = [
      (bundle) => { deployments(bundle)[0].spec.template.spec.containers[0].image = "qkern:latest"; },
      (bundle) => { deployments(bundle)[0].spec.template.spec.hostNetwork = true; },
      (bundle) => { deployments(bundle)[0].spec.template.spec.automountServiceAccountToken = true; },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.containers[0]
          .securityContext.readOnlyRootFilesystem = false;
      },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.containers[0]
          .securityContext.capabilities.drop = [];
      },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.containers[0]
          .readinessProbe.exec.command[2] =
            "fetch('http://0.0.0.0:9464/ready').then(()=>process.exit(0))";
      },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.containers.push(
          structuredClone(deployments(bundle)[0].spec.template.spec.containers[0]),
        );
      },
      (bundle) => { deployments(bundle)[0].spec.replicas = 2; },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.containers[0].command =
          ["sh", "-c", "npm run worker:migrations"];
      },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.volumes[0] =
          { name: "runtime-tmp", hostPath: { path: "/tmp" } };
      },
      (bundle) => {
        deployments(bundle)[0].spec.template.spec.containers[0].env.push({
          name: "QKERN_PROVISIONING_BROKER_HMAC_SECRET",
          value: "inline-secret",
        });
      },
      (bundle) => {
        bundle.items.push({
          apiVersion: "v1",
          kind: "Service",
          metadata: { name: "public-runtime", namespace: "qkern" },
          spec: { type: "LoadBalancer" },
        });
      },
    ];
    for (const mutate of mutations) {
      const bundle: any = structuredClone(generateRuntimeDeploymentBundle(OPTIONS));
      mutate(bundle);
      await expect(new RuntimeDeploymentVerifier(provider(bundle), OPTIONS).verify())
        .rejects.toBeInstanceOf(RuntimeDeploymentNotReadyError);
    }
  });

  it("rejects unknown and duplicate JSON fields", async () => {
    const valid = generateRuntimeDeploymentBundle(OPTIONS);
    await expect(new RuntimeDeploymentVerifier(provider({
      ...valid,
      approvalBypass: true,
    }), OPTIONS).verify()).rejects.toBeInstanceOf(RuntimeDeploymentNotReadyError);

    const duplicate = JSON.stringify(valid).replace(
      '"kind":"List"',
      '"kind":"List","kind":"List"',
    );
    await expect(new RuntimeDeploymentVerifier({
      read: async () => Buffer.from(duplicate),
    }, OPTIONS).verify()).rejects.toBeInstanceOf(RuntimeDeploymentNotReadyError);
  });
});

describe("background runtime deployment file and CLI", () => {
  itOnPosix("accepts protected regular files and rejects writable files, links and relative paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-runtime-deployment-"));
    tempDirectories.push(directory);
    const bundlePath = path.join(directory, "runtime-deployments.json");
    await writeFile(
      bundlePath,
      JSON.stringify(generateRuntimeDeploymentBundle(OPTIONS)),
      { mode: 0o644 },
    );
    await expect(new RuntimeDeploymentFileReader(bundlePath, true).read())
      .resolves.toBeInstanceOf(Buffer);

    await chmod(bundlePath, 0o622);
    await expect(new RuntimeDeploymentFileReader(bundlePath, true).read())
      .rejects.toBeInstanceOf(RuntimeDeploymentNotReadyError);

    await chmod(bundlePath, 0o644);
    const linkPath = path.join(directory, "runtime-link.json");
    await symlink(bundlePath, linkPath);
    await expect(new RuntimeDeploymentFileReader(linkPath).read())
      .rejects.toBeInstanceOf(RuntimeDeploymentNotReadyError);
    expect(() => new RuntimeDeploymentFileReader("runtime.json"))
      .toThrow("absolute file path");
  });

  itOnPosix("validates environment authority and produces cause-free machine output", async () => {
    expect(runtimeDeploymentOptionsFromEnv({
      QKERN_RUNTIME_DEPLOYMENT_NAMESPACE: " qkern ",
      QKERN_RUNTIME_IMAGE: ` ${IMAGE} `,
      QKERN_RUNTIME_CONFIG_MAP: " qkern-runtime-config ",
      QKERN_RUNTIME_SECRET: " qkern-runtime-secrets ",
    })).toEqual(OPTIONS);
    expect(() => createRuntimeDeploymentVerifierFromEnv({
      ...envForCli(),
      QKERN_RUNTIME_DEPLOYMENT_BUNDLE: "{}",
    }, { provider: provider({}) })).toThrow("Inline");
    expect(() => createRuntimeDeploymentVerifierFromEnv({
      ...envForCli(),
      QKERN_RUNTIME_DEPLOYMENT_FILE: "/run/qkern/shared",
      QKERN_VAULT_TOKEN_FILE: "/run/qkern/shared",
    })).toThrow("cannot reuse");

    const directory = await mkdtemp(path.join(os.tmpdir(), "qkern-runtime-cli-"));
    tempDirectories.push(directory);
    const render = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/render-background-runtime-deployments.ts"],
      { cwd: process.cwd(), env: { ...process.env, ...envForCli() }, encoding: "utf8" },
    );
    expect(render.status, render.stderr).toBe(0);
    expect(render.stderr).toBe("");
    const rendered = JSON.parse(render.stdout);
    expect(deployments(rendered)).toHaveLength(4);

    const bundlePath = path.join(directory, "runtime-deployments.json");
    await writeFile(bundlePath, render.stdout, { mode: 0o600 });
    const verify = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-background-runtime-deployments.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...envForCli(),
          NODE_ENV: "production",
          QKERN_RUNTIME_DEPLOYMENT_FILE: bundlePath,
        },
        encoding: "utf8",
      },
    );
    expect(verify.status, verify.stderr).toBe(0);
    expect(JSON.parse(verify.stdout).data.backgroundRuntimeDeploymentReadiness)
      .toMatchObject({ status: "ready", componentCount: 4 });

    rendered.items[1].spec.template.spec.hostPID = true;
    await writeFile(bundlePath, JSON.stringify(rendered), { mode: 0o600 });
    const failure = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-background-runtime-deployments.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...envForCli(),
          NODE_ENV: "production",
          QKERN_RUNTIME_DEPLOYMENT_FILE: bundlePath,
        },
        encoding: "utf8",
      },
    );
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stderr)).toEqual({
      error: "Background runtime deployment is not ready",
      code: "RUNTIME_DEPLOYMENT_NOT_READY",
    });
    expect(failure.stderr).not.toContain(bundlePath);
    expect(failure.stderr).not.toContain(IMAGE);
  });
});

function envForCli(): Record<string, string> {
  return {
    QKERN_RUNTIME_DEPLOYMENT_NAMESPACE: OPTIONS.namespace,
    QKERN_RUNTIME_IMAGE: OPTIONS.image,
    QKERN_RUNTIME_CONFIG_MAP: OPTIONS.configMapName,
    QKERN_RUNTIME_SECRET: OPTIONS.secretName,
  };
}
