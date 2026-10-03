import { REAL_VIEWS, type RealViewId } from "@/components/console/navigation";

/**
 * Der Schnellstart der Projekt-Uebersicht (2.136), rein gerechnet.
 *
 * Drei Schritte und ein Beispiel, das wirklich laeuft. Das Modul haelt nur,
 * was kein React braucht: welche Schritte es gibt, in welche Ansicht jeder
 * fuehrt und wie der Verbindungsschnipsel fuer dieses Projekt aussieht. Die
 * Texte stehen in der Ansicht, denn der Uebersetzungsvertrag liest die
 * `t`-Aufrufe aus `components/console` und sonst nirgendwo.
 *
 * Die Namen im Beispiel sind nachgesehen und nicht erinnert: Das Paket heisst
 * `@qkern/sdk` (siehe `sdk/typescript/package.json`), nicht `@qkern/js`, und
 * die Fabrik heisst `createQkernClient` (siehe `sdk/typescript/src/index.ts`),
 * nicht `createClient`. Veroeffentlicht ist es: `docs/evidence/README.md`
 * fuehrt den Lauf, der `@qkern/sdk@1.7.0-alpha.5` auf npm hochgeladen hat,
 * und darum traegt der Befehl den Tag `alpha`.
 */

export type Environment = "development" | "staging" | "production";

export type QuickStartStepId = "table" | "auth" | "connect";

/**
 * Jeder Schritt fuehrt in eine Ansicht, die es gibt. `RealViewId` zwingt das
 * schon beim Tippen; der Vertrag prueft es zusaetzlich gegen `REAL_VIEWS`,
 * damit eine umbenannte Ansicht nicht erst im Browser auffaellt.
 */
export type QuickStartStep = { id: QuickStartStepId; view: RealViewId };

export const QUICK_START_STEPS: ReadonlyArray<QuickStartStep> = [
  { id: "table", view: "db-tables" },
  { id: "auth", view: "auth-providers" },
  { id: "connect", view: "api" },
];

/** Der Installationsbefehl. Der Tag `alpha` gehoert dazu, solange 1.7.0 Alpha ist. */
export const QUICK_START_INSTALL = "npm install @qkern/sdk@alpha";

/**
 * Wenn die Adresse der Console noch nicht bekannt ist, steht eine Luecke da,
 * die als Luecke zu erkennen ist. Eine erfundene Adresse waere schlimmer: Sie
 * liesse sich kopieren und wuerde nicht funktionieren.
 */
export const BASE_URL_PLACEHOLDER = "<QKERN-URL>";

/**
 * Der Schnipsel, der zu diesem Projekt passt. Der Key steht nicht darin,
 * sondern wird aus der Umgebung gelesen: Die Console kennt ihn nicht, sie
 * zeigt ihn beim Anlegen genau einmal, und ein Key in einem kopierbaren
 * Beispiel landet im Versionsstand.
 */
export function connectSnippet(input: { baseUrl: string; projectId: string; environment: Environment }): string {
  const baseUrl = input.baseUrl === "" ? BASE_URL_PLACEHOLDER : input.baseUrl;
  return [
    'import { createQkernClient } from "@qkern/sdk";',
    "",
    "const qkern = createQkernClient({",
    `  baseUrl: "${baseUrl}",`,
    `  projectId: "${input.projectId}",`,
    `  environment: "${input.environment}",`,
    "  projectKey: process.env.QKERN_PROJECT_KEY,",
    "});",
    "",
    'const { data } = await qkern.from("orders").select({ limit: 20 });',
  ].join("\n");
}

/** Dieselbe Pruefung, die der Vertrag fahren will, an der Quelle. */
export function quickStartStepsPointAtRealViews(): boolean {
  const real = new Set<string>(REAL_VIEWS);
  return QUICK_START_STEPS.every((step) => real.has(step.view));
}
