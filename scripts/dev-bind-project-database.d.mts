export type BindArgs = {
  projectId: string;
  environment: "development" | "staging";
  organizationId?: string;
};

export function parseArgs(argv: readonly string[]): BindArgs;

export function bindStatement(args: Pick<BindArgs, "projectId" | "environment">): {
  text: string;
  values: [string, string, string];
};
