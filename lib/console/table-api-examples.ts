import { BASE_URL_PLACEHOLDER, QUICK_START_INSTALL, type Environment } from "@/lib/console/quick-start";

/**
 * Die drei Beispiele, mit denen man eine Tabelle von aussen anspricht (2.138),
 * rein gerechnet und ohne React.
 *
 * Die Namen sind nachgesehen und nicht erinnert. Der Pfad kommt aus
 * `app/api/v1/projects/[projectId]/environments/[environment]/tables/[table]/rows`;
 * es gibt in QKERN **kein** `/rest/v1/...`, und wer das Beispiel abtippt,
 * soll nicht an einer erfundenen Adresse scheitern. Der Kopfzeilenname
 * `x-qkern-key` steht so im Transport des SDK
 * (`sdk/typescript/src/index.ts`), das Paket heisst `@qkern/sdk`
 * (`sdk/typescript/package.json`), und die Fabrik heisst `createQkernClient`
 * und nicht `createClient`.
 *
 * Installationsbefehl und die Luecke fuer eine noch unbekannte Adresse kommen
 * aus `lib/console/quick-start`. Zwei Wahrheiten ueber denselben Befehl waeren
 * eine zu viel.
 *
 * Kein Key im Beispiel. Die Console kennt ihn nicht, sie zeigt ihn beim
 * Anlegen genau einmal, und ein Key in einem kopierbaren Block landet im
 * Versionsstand.
 */
export type TableApiTarget = Readonly<{
  baseUrl: string;
  projectId: string;
  environment: Environment;
  table: string;
  schema: string;
}>;

/** Wie viele Zeilen die Beispiele holen. Die Route begrenzt selbst auf 100. */
export const TABLE_API_EXAMPLE_LIMIT = 20;

/** Der Pfad der Zeilenroute, ohne Abfrageteil. */
export function tableRowsPath(target: TableApiTarget): string {
  return `/api/v1/projects/${target.projectId}/environments/${target.environment}/tables/${target.table}/rows`;
}

/** Derselbe Pfad mit dem Abfrageteil, den ein Lesen braucht. */
export function tableRowsQuery(target: TableApiTarget): string {
  return `${tableRowsPath(target)}?schema=${target.schema}&limit=${TABLE_API_EXAMPLE_LIMIT}`;
}

/** Die Adresse, oder eine Luecke, die als Luecke zu erkennen ist. */
function origin(baseUrl: string): string {
  return baseUrl === "" ? BASE_URL_PLACEHOLDER : baseUrl;
}

/** Die rohe Anfrage: Verb, Pfad, und die zwei Kopfzeilen, die sie braucht. */
export function tableRestExample(target: TableApiTarget): string {
  return [
    `GET ${tableRowsQuery(target)}`,
    "accept: application/json",
    "x-qkern-key: $QKERN_PROJECT_KEY",
  ].join("\n");
}

/** Dasselbe Lesen mit dem veroeffentlichten SDK. */
export function tableSdkExample(target: TableApiTarget): string {
  return [
    `// ${QUICK_START_INSTALL}`,
    'import { createQkernClient } from "@qkern/sdk";',
    "",
    "const qkern = createQkernClient({",
    `  baseUrl: "${origin(target.baseUrl)}",`,
    `  projectId: "${target.projectId}",`,
    `  environment: "${target.environment}",`,
    "  projectKey: process.env.QKERN_PROJECT_KEY,",
    "});",
    "",
    `const { rows } = await qkern`,
    `  .from("${target.table}", "${target.schema}")`,
    `  .select({ limit: ${TABLE_API_EXAMPLE_LIMIT} });`,
  ].join("\n");
}

/** Dasselbe Lesen auf der Kommandozeile. */
export function tableCurlExample(target: TableApiTarget): string {
  return [
    `curl '${origin(target.baseUrl)}${tableRowsQuery(target)}' \\`,
    `  -H 'accept: application/json' \\`,
    `  -H "x-qkern-key: $QKERN_PROJECT_KEY"`,
  ].join("\n");
}
