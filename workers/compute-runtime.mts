import { createComputeRuntimeFromEnv } from "@/lib/server/compute/runtime-composition";
import {
  computeScopeOrganizationFromEnv,
  computeScopeSourceFromEnv,
  computeScopesFromEnv,
  PostgresComputeScopeCatalog,
  resolveComputeScopes,
} from "@/lib/server/compute/scope-discovery";
import { createControlPlaneService } from "@/lib/server/control-plane/runtime";
import { ControlPlaneDataTargetResolver } from "@/lib/server/data-plane/runtime";
import { closePostgresPool, getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { TrustedProjectDatabaseConnectionCatalog } from
  "@/lib/server/migrations/connection-catalog";
import { createLocalProjectDatabaseCatalogFromEnv } from
  "@/lib/server/migrations/connection-catalog-env";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";
import { ControlPlaneRealtimeProjectConnection } from
  "@/lib/server/realtime/project-connection";
import type { ProjectConnection } from "@/lib/server/realtime/postgres-change-source";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

// Die Probe gab es seit Alpha 1, und kein Prozess hat sie je gestartet: Vier
// Kompositionen reichten einen `probe` durch, den niemand erzeugte. Der
// Erreichbarkeitsvertrag aus 1.42 hat das nicht gesehen — das Modul war
// importiert, nur die Fabrik rief niemand.
const probe = createLoopbackRuntimeProbeFromEnv(process.env);

// Die Webhook-Bruecke (2.53) braucht, was dieser Prozess bis 2.52 nicht hatte:
// eine Verbindung zu den Projektdatenbanken. Gebaut wird sie genau wie in der
// Realtime-Runtime — erst die Control Plane nach dem Katalogverweis fragen,
// dann der Katalog nach der Verbindung — und mit **denselben**
// Umgebungsvariablen wie dort und beim Migrationsworker. Ein zweiter Satz
// waere eine zweite Wahrheit ueber dieselben Datenbanken.
//
// Die Verbindung wird hier aufgebaut und nicht in der Komposition: Der Katalog
// entsteht asynchron, die Fabrik ist synchron.
let projectConnection: ProjectConnection | undefined;
let projectCatalog: TrustedProjectDatabaseConnectionCatalog | undefined;

try {
  if (process.env.QKERN_COMPUTE_DATABASE_WEBHOOKS_ENABLED === "true") {
    // Derselbe Katalog wie bei Realtime Changes und der Generated Data API,
    // bis auf den Anwendungsnamen: Es ist dieselbe unprivilegierte Rolle in
    // denselben Projektdatenbanken, und `db/project/0003` erteilt genau ihr das
    // Leserecht auf dem Feed. Ein eigener Satz Variablen waere eine zweite
    // Wahrheit ueber dieselbe Verbindung.
    projectCatalog = await createLocalProjectDatabaseCatalogFromEnv(process.env, undefined, {
      allowFlag: "QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG",
      catalogVariable: "QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON",
      applicationName: "qkern-compute-database-webhooks",
    });
    projectConnection = new ControlPlaneRealtimeProjectConnection(
      new ControlPlaneDataTargetResolver(createControlPlaneService(process.env)),
      projectCatalog,
      "compute-database-webhooks",
    );
  }
  // Die Bereiche (2.107). Bis 2.106 stand hier nichts: Die Komposition las
  // `QKERN_COMPUTE_SCOPES_JSON` und sonst nichts, und ein Projekt, das nach
  // dem letzten Neustart entstand, wurde nicht bedient, ohne dass es jemand
  // erfuhr. Aufgeloest wird hier und nicht in der Komposition, weil die
  // Entdeckung liest und die Fabrik synchron ist -- dieselbe Naht wie bei der
  // Projektverbindung darueber.
  const scopeSource = computeScopeSourceFromEnv(process.env);
  const scopeOrganizationId = computeScopeOrganizationFromEnv(process.env);
  const resolved = await resolveComputeScopes({
    source: scopeSource,
    ...(scopeOrganizationId ? { organizationId: scopeOrganizationId } : {}),
    // Am entdeckten Weg darf die Liste nicht daneben stehen; `resolveComputeScopes`
    // weist das ab, statt sie stillschweigend zu uebergehen.
    ...(scopeSource === "static-env" ? { configured: computeScopesFromEnv(process.env) } : {}),
    ...(scopeOrganizationId
      ? { catalog: new PostgresComputeScopeCatalog(new PostgresControlPlane(getPostgresPool(process.env))) }
      : {}),
  });
  const runtime = createComputeRuntimeFromEnv(process.env, {
    probe: probe?.observer,
    scopes: resolved.scopes,
    ...(projectConnection ? { projectConnection } : {}),
    // Scope-Index, Zahl der ausgeloesten Vorkommen und feste Failure Codes —
    // keine Ids, keine Endpunkte, keine Datenbankmeldungen. Bis Release 1.53
    // meldete dieser Prozess nach seiner Startzeile gar nichts.
    logger: { log: (event) => console.info(JSON.stringify(event)) },
  });
  const bound = await probe?.start();
  console.error(
    `QKERN compute runtime serving ${runtime.scopes.length} scope(s): cron dispatch and webhook delivery`
    // Die Bruecke nennt sich in der Startzeile. Ein Prozess, der sie stumm
    // laufen laesst, ist von einem ohne sie nicht zu unterscheiden — und genau
    // diese Verwechslung war 2.50 bis 2.52 der Zustand.
    + (runtime.databaseWebhookBridge ? " and the database webhook bridge" : "")
    // Und derselbe Satz fuer den Log-Drain-Sammler (2.64). Zwischen 2.54 und
    // 2.63 war er gebaut, zertifiziert und untaetig; ein Prozess, der ihn
    // stumm laufen liesse, waere von einem ohne ihn nicht zu unterscheiden.
    + (runtime.logDrainCollector ? " and the log drain collector" : "")
    // Und derselbe Satz fuer den Dashboard-Webhook-Sammler (2.75). Er meldet
    // Ereignisse des Projekts nach draussen; ob er laeuft, gehoert in die
    // Startzeile und nicht in eine Vermutung.
    + (runtime.dashboardWebhookCollector ? " and the dashboard webhook collector" : "")
    // Und derselbe Satz fuer den Aufraeumer abgelaufener Einmal-Artefakte
    // (2.89). Er loescht Zeilen; dass er laeuft, gehoert in die Startzeile und
    // nicht in eine Vermutung.
    + (runtime.authRetention ? " and the auth expiry retention sweep" : "")
    // Woher die Bereiche kommen, gehoert in die Startzeile: Ein Prozess mit
    // einer entdeckten Liste und einer von Hand gesetzten sehen sonst gleich
    // aus, und die beiden altern vollkommen verschieden.
    + ` (scopes from ${runtime.scopeSource}`
    // Und ob gezaehlt wird. Ohne Zaehlung faellt eine vergessene Umgebung
    // niemandem auf, und genau das war der Zustand bis 2.106.
    + (runtime.scopeCensus ? ", census on" : ", no census")
    + ")"
    + (bound ? ` (probe on http://${bound.host}:${bound.port}/ready)` : ""),
  );
  // Eine Abweichung, die beim Start schon dasteht, wird beim Start gesagt. Die
  // Schleife meldet sie danach im Takt; die erste Zeile soll nicht auf sie
  // warten muessen.
  if (resolved.unserved > 0 || resolved.stale > 0) {
    console.info(JSON.stringify({
      event: "compute.scope_census", scopeIndex: -1,
      unserved: resolved.unserved, stale: resolved.stale,
    }));
  }
  runtime.scopes.length > 0 && probe?.observer.runtimeStarted();
  await runtime.run(controller.signal);
} catch {
  // Konfiguration, Endpunkte, Geheimnisreferenzen und Datenbankmeldungen
  // bleiben aus dem Log dieses Prozesses.
  console.error("QKERN compute runtime failed its startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await probe?.stop();
  // Die Projektverbindungen werden ausdruecklich geschlossen. Ein Prozess, der
  // sie offen laesst, endet auf SIGTERM erst, wenn der Treiber seine Leerlauf-
  // frist abgewartet hat -- ein sauberes Ende sieht dann aus wie ein haengendes.
  await projectCatalog?.close().catch(() => undefined);
  await closePostgresPool();
}
