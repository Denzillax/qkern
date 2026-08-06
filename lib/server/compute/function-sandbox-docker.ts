import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { EgressOutcome, EgressRequest } from "@/lib/server/compute/function-egress";
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
const PINNED_IMAGE = /^[a-z0-9][a-z0-9.:/_-]{1,254}[a-z0-9]@sha256:[0-9a-f]{64}$/;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const REMOVE_TIMEOUT_MS = 10_000;

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
   * Vermittelt Ausgangsverbindungen einer Function.
   *
   * Ohne ihn wird eine Definition mit erlaubten Origins abgewiesen: Der
   * Container bekommt in keinem Fall ein Netz, und eine Liste, die niemand
   * bedient, wäre ein stiller Bruch der Zusage.
   */
  egress?: FunctionEgressHandler;
  spawnFn?: typeof spawn;
};

export interface FunctionEgressHandler {
  request(definition: FunctionDefinition, request: EgressRequest): Promise<EgressOutcome>;
  budget(): { spend(): boolean };
}

/**
 * Führt eine Function in einem wegwerfbaren Container aus.
 *
 * `FunctionSandboxPort` existiert seit Release 1.6 Alpha 4 ohne Implementierung.
 * Alles darunter — Egress-Policy, Ressourcenlimits, Secret-Canary — war deshalb
 * nur ein Versprechen im Vertrag.
 *
 * Die Isolation liegt in den Flags, nicht in dieser Klasse:
 *
 * - `--network none` — der Container hat **nie** ein Netz. Ausgangsverbindungen
 *   laufen ausschliesslich über den vermittelten Kanal auf stdio, wo die
 *   Allowlist der Definition bei jeder einzelnen Anfrage geprüft wird.
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
    // Nur ein Registry-Bezug mit Digest. Bis Release 1.34 gab es hier einen
    // benannten Schalter, der zusätzlich eine lokale Image-Id zuliess — nötig,
    // weil der Zertifizierungslauf ein lokal gebautes Image benutzte. Seit im
    // Stack eine echte Registry läuft, braucht ihn niemand mehr, und ein
    // Schlupfloch, das niemand braucht, gehört weg.
    if (!PINNED_IMAGE.test(definition.image)) {
      throw new FunctionInvocationError("FUNCTION_INVALID");
    }
    if (definition.egressOrigins.length > 0 && !this.options.egress) {
      // Fail closed. Ohne Vermittler bliebe die Liste unbedient, und das waere
      // ein stiller Bruch der Zusage, die sie ausdrueckt.
      throw new FunctionInvocationError("FUNCTION_INVALID");
    }
    if (options.signal.aborted) throw new FunctionInvocationError("FUNCTION_TIMEOUT");

    // Der Name kommt aus dem Zufallsgenerator, nicht aus der Definition: Er
    // muss eindeutig sein und darf nichts aus einer Eingabe uebernehmen.
    const container = `${SANDBOX_CONTAINER_PREFIX}${randomBytes(12).toString("hex")}`;
    const invoke = JSON.stringify({
      type: "invoke",
      id: invocation.id,
      functionId: invocation.functionId,
      requestedAt: invocation.requestedAt,
      payload: invocation.payload,
      entrypoint: definition.entrypoint,
      // Nur Referenzen. Der Wert eines Geheimnisses erreicht diesen Prozess gar
      // nicht und kann deshalb auch nicht weitergereicht werden.
      secretRefs: [...definition.secretRefs],
      egressOrigins: [...definition.egressOrigins],
    });
    return await this.run(container, this.args(definition, container), invoke, definition,
      options.signal);
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
   * Startet den Container und spricht zeilenweise JSON mit ihm.
   *
   * Die Function schickt entweder eine Bitte um eine Ausgangsverbindung oder
   * ihr Ergebnis. Eine einzelne Antwort ohne `type` gilt weiterhin als
   * Ergebnis — das war das Protokoll aus Release 1.22, und ein Image, das nichts
   * nach aussen ruft, muss dafür nicht angefasst werden.
   *
   * `stderr` wird verworfen. Es stammt aus fremdem Code und könnte alles
   * enthalten, was die Function gesehen hat.
   */
  private run(
    container: string,
    args: string[],
    input: string,
    definition: FunctionDefinition,
    signal: AbortSignal,
  ): Promise<FunctionInvocationResult> {
    return new Promise<FunctionInvocationResult>((resolve, reject) => {
      const child = this.spawnFn(this.docker, args, {
        stdio: ["pipe", "pipe", "pipe"] as const,
        // Die Umgebung dieses Prozesses bleibt draussen. Sie enthaelt
        // Datenbankadressen, Vault-Token und Signaturschluessel. Nur `PATH`
        // bleibt, weil sonst die Container-Laufzeit selbst nicht gefunden wird.
        env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
      });

      let pending = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let result: FunctionInvocationResult | null = null;
      const budget = this.options.egress?.budget();

      const finish = (error: FunctionInvocationError | null, value?: FunctionInvocationResult) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error) {
          try { child.kill("SIGKILL"); } catch { /* bereits beendet */ }
          // Den Client zu toeten beendet den Container nicht. Ohne diesen
          // Schritt lief eine Function nach ihrem Timeout unbegrenzt weiter und
          // verbrauchte weiter Speicher und CPU — der Aufrufer sah einen
          // sauberen Fehler, die Isolationszusage war trotzdem hohl.
          //
          // Auf das Entfernen wird **gewartet**. Abgekoppelt war es nur
          // best-effort: Endete der Prozess im selben Moment, blieb der
          // Container stehen. Der Preis sind wenige hundert Millisekunden auf
          // einem ohnehin gescheiterten Aufruf.
          void this.removeContainer(container).finally(() => reject(error));
        } else if (value) resolve(value);
        else reject(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
      };
      const onAbort = () => finish(new FunctionInvocationError("FUNCTION_TIMEOUT"));
      signal.addEventListener("abort", onAbort, { once: true });

      const answer = (payload: unknown) => {
        if (settled) return;
        try { child.stdin?.write(`${JSON.stringify(payload)}\n`); } catch { /* geschlossen */ }
      };

      const handleMessage = (raw: string) => {
        if (settled || !raw.trim()) return;
        let message: unknown;
        try {
          message = JSON.parse(raw);
        } catch {
          finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
          return;
        }
        if (!message || typeof message !== "object") {
          finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
          return;
        }
        const typed = message as { type?: unknown; id?: unknown; request?: unknown };
        if (typed.type === "egress") {
          const handler = this.options.egress;
          // Ohne Vermittler oder ueber dem Budget: eine Absage, kein Abbruch.
          // Die Function soll darauf reagieren koennen wie auf jeden anderen
          // fehlgeschlagenen Aufruf.
          if (!handler || !budget?.spend()) {
            answer({ type: "egress-result", id: typed.id, outcome: { error: "EGRESS_LIMIT" } });
            return;
          }
          void handler.request(definition, typed.request as EgressRequest)
            .then((outcome: EgressOutcome) =>
              answer({ type: "egress-result", id: typed.id, outcome }))
            .catch(() =>
              answer({ type: "egress-result", id: typed.id, outcome: { error: "EGRESS_FAILED" } }));
          return;
        }
        // `type: "result"` oder — wie in Release 1.22 — eine blosse Antwort.
        result = message as FunctionInvocationResult;
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          // Eine unbegrenzte Antwort wuerde diesen Prozess erschoepfen, nicht
          // den Container.
          finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
          return;
        }
        pending += chunk.toString("utf8");
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          handleMessage(line);
          newline = pending.indexOf("\n");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > MAX_STDERR_BYTES) child.stderr?.destroy();
      });

      child.on("error", () => finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED")));
      child.on("close", (code) => {
        // Der letzte Abschnitt kann ohne Zeilenende enden.
        handleMessage(pending);
        if (code === 0 && result) finish(null, result);
        else finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED"));
      });

      child.stdin?.on("error", () => finish(new FunctionInvocationError("FUNCTION_SANDBOX_FAILED")));
      // stdin bleibt offen: Der Container darf waehrend seines Laufs um
      // Ausgangsverbindungen bitten und braucht dafuer den Rueckkanal.
      child.stdin?.write(`${input}\n`);
    });
  }

  /**
   * Entfernt den Container hart. Ein Fehlschlag wird verschluckt: Meistens ist
   * der Container bereits weg, und ein Fehler hier darf den eigentlichen
   * Fehlerpfad nicht überschreiben.
   */
  private removeContainer(container: string): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const settle = () => { if (!done) { done = true; resolve(); } };
      try {
        const remover = this.spawnFn(this.docker, ["rm", "--force", "--volumes", container], {
          stdio: "ignore",
          env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
        });
        remover.on("error", settle);
        remover.on("close", settle);
        // Auch das Aufraeumen darf nicht unbegrenzt haengen.
        setTimeout(settle, REMOVE_TIMEOUT_MS).unref?.();
      } catch {
        settle();
      }
    });
  }
}
