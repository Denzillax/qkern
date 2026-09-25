import { describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "@/lib/server/db/pool";

/**
 * Gefunden auf dem GitHub-Runner (2.15): der PostgreSQL-Lauf war 161 von 161
 * gruen und endete trotzdem mit exit 1, weil `DROP DATABASE ... WITH (FORCE)`
 * eine unbenutzte Verbindung eines Pools beendete, den niemand mehr hielt.
 * node-postgres meldet das als `error`-Ereignis des Pools; ohne Zuhoerer ist
 * es ein unbehandelter Fehler des Prozesses. Der Pool aus der Fabrik hoert zu.
 */
describe("postgres pool idle-connection errors", () => {
  it("logs a lost idle connection instead of raising an unhandled error", () => {
    const pool = createPostgresPool({ connectionString: "postgres://nobody:nothing@127.0.0.1:1/never", applicationName: "qkern-test" });
    const emitter = pool as unknown as { listenerCount(event: string): number; emit(event: string, ...args: unknown[]): boolean };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(emitter.listenerCount("error")).toBe(1);
      // Ohne Zuhoerer wuerde `emit("error")` hier werfen.
      expect(() => emitter.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
      expect(log).toHaveBeenCalledWith("[db] idle connection lost", { pool: "qkern-test", message: "terminating connection due to administrator command" });
    } finally {
      log.mockRestore();
    }
  });
});
