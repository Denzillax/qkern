import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { FunctionInvocationError, type FunctionSandboxPort } from "@/lib/server/compute/functions";
import type {
  FunctionDefinition,
  FunctionInvocation,
  FunctionInvocationResult,
} from "@/lib/server/compute/model";

/**
 * Dieselbe Regel wie in `validateFunctionDefinition`: eine Registry-Referenz mit
 * Inhaltsdigest. Ein Tag ist veränderlich — derselbe Name könnte morgen einen
 * anderen Inhalt bezeichnen.
 */
const PINNED_IMAGE = /^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$/;

/**
 * Eine blosse lokale Image-Id. Inhaltsadressiert und damit fest, aber nur auf
 * genau diesem Rechner auflösbar — deshalb kein gültiges Ziel für eine
 * gespeicherte Definition und nur über einen ausdrücklichen Schalter erreichbar.
 */
const LOCAL_IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

/** Präfix jedes Sandbox-Containers, damit ein Betreiber Reste erkennen kann. */
export const SANDBOX_CONTAINER_PREFIX = "qkern-fn-";

export type DockerFunctionSandboxOptions = {
  /** Ausführbare Datei der Container-Laufzeit. */
  docker?: string;
  /** Nicht-root Benutzer im Container, als `uid:gid`. */
  user?: string;
  cpus?: number;
  pidsLimit?: number;
  tmpfsBytes?: number;
  /**
   * Erlaubt Egress. In dieser Stufe **nicht implementiert**: Ohne Proxy gäbe es
   * nur alles oder nichts, und „alles" wäre keine Policy.
   */
  allowEgress?: never;
  /**
   * Erlaubt zusätzlich eine lokale Image-Id als Ziel.
   *
   * Ausschliesslich für die Zertifizierung der Isolationsflags: Ein lokal
   * gebautes Image hat keinen Registry-Digest, und eine Registry aufzusetzen,
   * nur um `--network none` zu prüfen, würde den Nachweis nicht besser machen.
   * Der Schalter ist sichtbar, benannt und standardmässig aus, damit die
   * Produktionsgrenze exakt die der Definition bleibt.
   */
  allowLocalImageId?: boolean;
  spawnFn?: typeof spawn;
};

/**
 * Führt eine Function in einem wegwerfbaren Container aus.
 *
 * `FunctionSandboxPort` existiert seit Release 1.6 Alpha 4 ohne Implementierung.
 * Alles darunter — Egress-Policy, Ressourcenlimits, Secret-Canary — war deshalb
 * nur ein Versprechen im Vertrag.
 *
 * Die Isolation liegt in den Flags, nicht in dieser Klasse:
 *
 * - `--network none` — kein Egress. Das ist die einzige Netzwerkform, die diese
 *   Stufe kennt; eine Definition mit erlaubten Origins wird abgewiesen, statt
 *   stillschweigend volles Netz oder gar keins zu bekommen.
 * - `--read-only` mit einem kleinen `noexec`-tmpfs für `/tmp` — geschriebener
 *   Code kann nicht ausgeführt werden.
 * - `--user` ungleich root, `--cap-drop ALL`, `--security-opt no-new-privileges`
 *   — ein Setuid-Binary im Image hebt die Rechte nicht wieder an.
 * - `--memory` gleich `--memory-swap` — ohne das würde die Speichergrenze
 *   einfach in Swap ausweichen und nie greifen.
 * - `--pids-limit` — sonst genügt eine Fork-Schleife.
 *
 * **Die Umgebung des Containers trägt keine Geheimnisse.** Sie enthält
 * ausschliesslich die Referenzen aus der Definition. Der Prozess dieser Runtime
 * gibt seine eigene Umgebung nicht weiter; das prüft ein Canary-Fall der
 * Zertifizierung.
 */
export class DockerFunctionSandbox implements FunctionSandboxPort {
  private readonly docker: string;
  private readonly user: string;
  private readonly cpus: number;
  private readonly pidsLimit: number;
  private readonly tmpfsBytes: number;
  private readonly spawnFn: typeof spawn;

  constructor(private readonly options: DockerFunctionSandboxOptions = {}) {
    this.docker = options.docker ?? "docker";
    this.user = options.user ?? "65534:65534";
    this.cpus = options.cpus ?? 1;
    this.pidsLimit = options.pidsLimit ?? 64;
    this.tmpfsBytes = options.tmpfsBytes ?? 16 * 1024 * 1024;
    this.spawnFn = options.spawnFn ?? spawn;
    if (!/^\d{1,10}:\d{1,10}$/.test(this.user) || this.user.startsWith("0:")) {
      throw new FunctionInvocationError("FUNCTION_SANDBOX_FAILED");
    }
    if (!(this.cpus > 0 && this.cpus <= 8) ||
        !Number.isSafeInteger(this.pidsLimit) || this.pidsLimit < 8 || this.pidsLimit > 4_096 ||
        !Number.isSafeInteger(this.tmpfsBytes) || this.tmpfsBytes < 1_048_576 ||
        this.tmpfsBytes > 268_435_456) {
      throw new FunctionInvocationError("FUNCTION_SANDBOX_FAILED");
    }
  }

  async invoke(
    definition: FunctionDefinition,
    invocation: FunctionInvocation,
    options: { signal: AbortSignal },
  ): Promise<FunctionInvocationResult> {
    const pinned = PINNED_IMAGE.test(definition.image) ||
      (this.options.allowLocalImageId === true && LOCAL_IMAGE_ID.test(definition.image));
    if (!pinned) throw new FunctionInvocationError("FUNCTION_INVALID");
    if (definition.egressOrigins.length > 0) {
      // Fail closed. Ein Egress-Proxy fehlt; volles Netz zu geben waere das
      // Gegenteil dessen, was die Liste ausdrueckt, und gar kein Netz waere ein
      // stiller Bruch der Zusage.
      throw new FunctionInvocationError("FUNCTION_INVALID");
    }
    if (options.signal.aborted) throw new FunctionInvocationError("FUNCTION_TIMEOUT");

    // Der Name kommt aus dem Zufallsgenerator, nicht aus der Definition: Er
    // muss eindeutig sein und darf nichts aus einer Eingabe uebernehmen.
    const container = `${SANDBOX_CONTAINER_PREFIX}${randomBytes(12).toString("hex")}`;
    const raw = await this.run(container, this.args(definition, container), JSON.stringify({
      id: invocation.id,
      functionId: invocation.functionId,
      requestedAt: invocation.requestedAt,
      payload: invocation.payload,
      entrypoint: definition.entrypoint,
      // Nur Referenzen. Der Wert eines Geheimnisses erreicht diesen Prozess gar
      // nicht und kann deshalb auch nicht weitergereicht werden.
      secretRefs: [...definition.secretRefs],
    }), options.signal);

    try {
      return JSON.parse(raw) as FunctionInvocationResult;
    } catch (cause) {
      // Die Ausgabe stammt aus fremdem Code und gehoert nicht in eine Meldung.
      void cause;
      throw new FunctionInvocationError("FUNCTION_SANDBOX_FAILED");
    }
  }

  private args(definition: FunctionDefinition, container: string): string[] {
    return [
      "run", "--rm", "--interactive",
      "--name", container,
      "--network", "none",
      "--read-only",
      "--tmpfs", `/tmp:rw,noexec,nosuid,size=${this.tmpfsBytes}`,
      "--user", this.user,
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--memory", `${definition.memoryMiB}m`,
      // Gleich der Speichergrenze: Sonst weicht ein Speicherfresser in Swap aus
      // und die Grenze greift nie.
      "--memory-swap", `${definition.memoryMiB}m`,
      "--cpus", String(this.cpus),
      "--pids-limit", String(this.pidsLimit),
      // Bewusst kein `--env`. Der Aufruf steht vollstaendig auf stdin; jede
      // Variable hier waere eine zweite Stelle, an der versehentlich ein
      // Geheimnis landen koennte.
      definition.image,
    ];
  }

  /**
   * Startet den Container, schreibt den Aufruf auf stdin und liest eine
   * begrenzte Antwort von stdout.
   *
   * `stderr` wird verworfen. Es stammt aus fremdem Code und könnte alles
   * enthalten, was die Function gesehen hat.
   */
  private run(
    container: string,
    args: string[],
    input: string,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn(this.docker, args, {
        stdio: ["pipe", "pipe", "pipe"] as const,
        // Die Umgebung dieses Prozesses bleibt draussen. Sie enthaelt
        // Datenbankadressen, Vault-Token und Signaturschluessel. Nur `PATH`
        // bleibt, weil sonst die Container-Laufzeit selbst nicht gefunden wird.
        env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
      });

      let stdout = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (error: FunctionInvocationError | null, value?: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error) {
          try { child.kill("SIGKILL"); } catch { /* bereits beendet */ }
          // Den Client zu toeten beendet den Container nicht. Ohne diesen
          // Schritt lief eine Function nach ihrem Timeout unbegrenzt weiter und
          // verbrauchte weiter Speicher und CPU — der Aufrufer sah einen
          // sauberen Fehler, die Isolationszusage war trotzdem hohl.
          this.removeContainer(container);
          reject(error);
        } else resolve(value ?? "");
      };
      const onAbort = () => finish(new FunctionInvocationError("FUNCTION_TIMEOUT"));
      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          // Eine unbegrenzte Antwort wuerde diesen Prozess erschoepfen, nicht
          // den Container.
          finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
          return;
        }
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > MAX_STDERR_BYTES) child.stderr?.destroy();
      });

      child.on("error", () => finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED")));
      child.on("close", (code) => {
        if (code === 0) finish(null, stdout);
        else finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
      });

      child.stdin?.on("error", () => finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED")));
      child.stdin?.end(input);
    });
  }

  /**
   * Entfernt den Container hart. Ein Fehlschlag wird verschluckt: Meistens ist
   * der Container bereits weg, und ein Fehler hier darf den eigentlichen
   * Fehlerpfad nicht überschreiben.
   */
  private removeContainer(container: string): void {
    try {
      const remover = this.spawnFn(this.docker, ["rm", "--force", "--volumes", container], {
        stdio: "ignore",
        env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
      });
      remover.on("error", () => undefined);
      remover.unref();
    } catch { /* Die Laufzeit ist nicht erreichbar; nichts zu tun */ }
  }
}
