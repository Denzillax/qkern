export type BindArgs = {
  projectId: string;
  environment: "development" | "staging";
  organizationId?: string;
  allowRemote: boolean;
};

export function parseArgs(argv: readonly string[]): BindArgs;

export function bindStatement(args: Pick<BindArgs, "projectId" | "environment">): {
  text: string;
  values: [string, string, string];
};

export function resolveOrganizationId(
  args: Pick<BindArgs, "organizationId">,
  env: Readonly<Record<string, string | undefined>>,
): string;

export function assertLocalUrl(
  url: string,
  options: { allowRemote: boolean },
): { host: string; port: string; database: string };
