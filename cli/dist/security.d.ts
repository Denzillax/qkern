export type Environment = "development" | "staging" | "production";
export type Risk = "low" | "medium" | "high" | "critical";
export declare function validateSingleSqlStatement(statement: string): {
    valid: true;
} | {
    valid: false;
    reason: string;
};
export declare function classifySqlRisk(statement: string, environment: Environment): Risk;
