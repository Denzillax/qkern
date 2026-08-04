import { createProductionApplyAuthorizerFromEnv } from
  "@/lib/server/migrations/production-apply-authorization-runtime";

async function main(): Promise<void> {
  try {
    const env = process.env;
    await createProductionApplyAuthorizerFromEnv(env).assertAuthorized({
      organizationId: env.QKERN_PRODUCTION_APPLY_SUBJECT_ORGANIZATION_ID?.trim() ?? "",
      projectId: env.QKERN_PRODUCTION_APPLY_SUBJECT_PROJECT_ID?.trim() ?? "",
      environment: "production",
      changeSetId: env.QKERN_PRODUCTION_APPLY_SUBJECT_CHANGE_SET_ID?.trim() ?? "",
      approvalId: env.QKERN_PRODUCTION_APPLY_SUBJECT_APPROVAL_ID?.trim() ?? "",
      databaseInstanceRef:
        env.QKERN_PRODUCTION_APPLY_SUBJECT_DATABASE_INSTANCE_REF?.trim() ?? "",
      statementSha256:
        env.QKERN_PRODUCTION_APPLY_SUBJECT_STATEMENT_SHA256?.trim() ?? "",
      approvalActionHash:
        env.QKERN_PRODUCTION_APPLY_SUBJECT_APPROVAL_ACTION_HASH?.trim() ?? "",
    });
    process.stdout.write(`${JSON.stringify({
      data: {
        productionApplyAuthorization: {
          status: "authorized",
          deployment: "production",
          scope: "migration_apply",
        },
      },
    })}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: "Production apply is not authorized",
      code: "PRODUCTION_APPLY_BLOCKED",
    })}\n`);
    process.exitCode = 1;
  }
}

void main();
