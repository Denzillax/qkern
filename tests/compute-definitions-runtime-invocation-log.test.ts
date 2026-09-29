import { describe, expect, it } from "vitest";
import { createFunctionInvocationServiceFromEnv } from "@/lib/server/compute/definitions-runtime";
import { PostgresComputeDefinitionRepository } from "@/lib/server/compute/definitions-postgres-repository";

/**
 * Die Fabrik des Betriebs verdrahtet das Aufrufprotokoll (2.98).
 *
 * Seit 1.89 gab es das Protokoll, und der Kettenfall im Functions-Stack
 * schrieb es auch: Er baute den Dienst von Hand und gab `invocationLog`
 * mit. Die Fabrik, ueber die die Web-Route, der Queue-Wirt und die
 * Auth-Hooks den Dienst bekommen, gab es nicht mit. Im Betrieb hat darum
 * seit 1.89 kein Aufruf eine Zeile geschrieben, und keine Zertifizierung
 * hat es gesehen, weil jede den Dienst selbst gebaut hat.
 *
 * Dieser Fall liest die Verdrahtung. Er verbindet sich nicht: Der Pool wird
 * erst bei der ersten Abfrage geoeffnet.
 */
describe("function invocation service from env", () => {
  it("hands the invocation log and the output log to the service", () => {
    const service = createFunctionInvocationServiceFromEnv({
      QKERN_FUNCTIONS_ENABLED: "true",
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_RUNTIME_DATABASE_URL: "postgresql://qkern_app:unused@127.0.0.1:1/qkern_control",
      DATABASE_SSL: "disable",
    });
    const options = (service as unknown as { options: {
      invocationLog?: unknown; repository: unknown;
    } }).options;
    expect(options.invocationLog).toBeInstanceOf(PostgresComputeDefinitionRepository);
    // Dasselbe Repository fuer Definition und Protokoll: eine Verbindung,
    // eine Rechtegrenze.
    expect(options.invocationLog).toBe(options.repository);
    const log = options.invocationLog as PostgresComputeDefinitionRepository;
    expect(typeof log.recordFunctionInvocation).toBe("function");
    expect(typeof log.recordFunctionInvocationOutput).toBe("function");
  });
});
