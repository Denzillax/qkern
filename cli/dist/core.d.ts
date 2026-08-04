import { type Environment } from "./security.js";
export type QkernCliConfig = Readonly<{
    version: 1;
    baseUrl: string;
    projectId: string;
    environment: Environment;
    schema: string;
    typesFile: string;
    migrationsDirectory: string;
    seedFile: string;
}>;
export type SchemaResult = Readonly<{
    source: "postgres";
    schema: string;
    tables: ReadonlyArray<{
        name: string;
        kind: string;
        rowSecurityEnabled: boolean;
        columns: ReadonlyArray<{
            name: string;
            dataType: string;
            nullable: boolean;
            identity: boolean;
            generated: boolean;
            sensitive: boolean;
        }>;
    }>;
}>;
export declare function parseConfig(value: unknown): QkernCliConfig;
export declare function readConfig(directory: string): Promise<QkernCliConfig>;
export declare function initializeProject(directory: string, input: {
    baseUrl: string;
    projectId: string;
    environment: Environment;
}): Promise<Readonly<{
    version: 1;
    baseUrl: string;
    projectId: string;
    environment: Environment;
    schema: string;
    typesFile: string;
    migrationsDirectory: string;
    seedFile: string;
}>>;
export declare function generateDatabaseTypes(result: SchemaResult): string;
export declare function planMigration(statement: string, environment: Environment): Readonly<{
    valid: true;
    risk: import("./security.js").Risk;
    environment: Environment;
    statementSha256: string;
    executes: false;
}>;
export declare function validateSeed(sql: string): Readonly<{
    statements: number;
    valid: true;
    executes: false;
}>;
export declare function resolveInside(root: string, relative: string): string;
