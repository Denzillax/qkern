import { describe, expect, it } from "vitest";
import { qkernOpenAPI } from "@/lib/openapi";
import { DATA_IDENTIFIER_PATTERN } from "@/lib/server/data-plane/identifiers";

describe("QKERN OpenAPI contract", () => {
  it("uses OpenAPI 3.1 and unique operation ids", () => {
    expect(qkernOpenAPI.openapi).toBe("3.1.0");
    const operations = Object.values(qkernOpenAPI.paths).flatMap((path) => Object.values(path)).map((operation) => operation.operationId);
    expect(new Set(operations).size).toBe(operations.length);
  });

  it("documents auth and bounded Change Set inputs", () => {
    expect(qkernOpenAPI.info.version).toBe("1.8.0-alpha.1");
    expect(qkernOpenAPI.components.securitySchemes.sessionCookie.name).toBe("__Host-qkern_session");
    expect(qkernOpenAPI.paths["/v1/auth/register"].post.responses["201"].description).toContain("session");
    expect(qkernOpenAPI.paths["/v1/auth/login"].post.responses).toHaveProperty("429");
    expect(qkernOpenAPI.paths["/v1/auth/logout"].post.responses).toHaveProperty("204");
    expect(qkernOpenAPI.paths["/v1/auth/session"].get.responses).toHaveProperty("401");
    expect(qkernOpenAPI.components.schemas.RegisterCredentials.properties.password.minLength).toBe(12);
    expect(qkernOpenAPI.components.schemas.LoginCredentials.properties.password.writeOnly).toBe(true);
    expect(qkernOpenAPI.components.schemas.CreateChangeSet.required).not.toContain("agent");
    expect(qkernOpenAPI.components.schemas.CreateChangeSet.properties.statement.maxLength).toBe(10_000);
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/schema"].get.operationId)
      .toBe("inspectProjectSchema");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/query"].post.summary)
      .toContain("read-only PostgreSQL query");
    expect(qkernOpenAPI.components.schemas.ProjectReadQuery.properties.limit.maximum).toBe(100);
    const generatedRows = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/tables/{table}/rows"];
    expect(generatedRows.get.summary).toContain("cursor pagination");
    expect(generatedRows.get.description).toContain("parameterized");
    expect(generatedRows.post.summary).toContain("RLS-enforced");
    expect(generatedRows.patch.summary).toContain("exact primary key");
    expect(generatedRows.delete.summary).toContain("exact primary key");
    expect(generatedRows.get.security).toEqual([
      { projectApiKey: [], projectAuthAccess: [] }, { projectApiKey: [] }, { sessionCookie: [] },
    ]);
    expect(qkernOpenAPI.components.securitySchemes.projectApiKey.description).toContain("SHA-256 verifier");
    expect(qkernOpenAPI.components.securitySchemes.projectAuthAccess.bearerFormat).toContain("Ed25519");
    const projectAuthToken = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/auth/token"].post;
    expect(projectAuthToken.description).toContain("replay");
    expect(projectAuthToken.requestBody.content["application/json"].schema.oneOf).toHaveLength(2);
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/auth/.well-known/jwks.json"].get.summary)
      .toContain("Ed25519");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/auth/oidc/{provider}/authorize"].post.summary)
      .toContain("PKCE");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/auth/admin/users/{userId}"].patch.summary)
      .toContain("revoke every session");
    const sessions = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/auth/admin/users/{userId}/sessions"];
    expect(sessions.get.description).toContain("verifiers are never selected");
    expect(sessions.delete.summary).toContain("without disabling");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/auth/admin/users/{userId}/sessions/{sessionId}"].delete.summary)
      .toContain("whole refresh family");
    expect(Object.keys(qkernOpenAPI.components.schemas.ProjectAuthSessionSummary.properties)).not.toContain("refreshTokenHash");
    const keys = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/api-keys"];
    expect(keys.post.description).toContain("service keys do not bypass RLS");
    expect(keys.post.responses["201"].description).toContain("shown once");
    expect(qkernOpenAPI.components.schemas.CreatedProjectApiKeyResponse.properties.data.properties.secret.writeOnly)
      .toBe(true);
    const storageBuckets = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/storage/buckets"];
    expect(storageBuckets.post.summary).toContain("private-by-default");
    expect(storageBuckets.post.description).toContain("write access can never be public");
    const storageUpload = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/storage/buckets/{bucketId}/uploads"].post;
    expect(storageUpload.summary).toContain("SHA-256");
    expect(storageUpload.description).toContain("verifier");
    expect(qkernOpenAPI.components.schemas.PreparedProjectStorageUploadResponse.properties.data.properties.completionToken.writeOnly)
      .toBe(true);
    const storageObjects = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/storage/buckets/{bucketId}/objects"];
    expect(storageObjects.get.security).toEqual([
      { projectApiKey: [], projectAuthAccess: [] }, { projectApiKey: [] },
    ]);
    expect(storageObjects.get.description).toContain("Provider keys and checksums are never exposed");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/storage/buckets/{bucketId}/downloads"].post.summary)
      .toContain("at most 15 minutes");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/storage/scans/{objectId}"].post.description)
      .toContain("cannot supply a verdict");
    const queues = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/queues"];
    expect(queues.post.summary).toContain("retry, lease, dedupe and retention");
    expect(queues.post.security).toEqual([{ sessionCookie: [] }]);
    const enqueue = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/queues/{queue}/messages"].post;
    expect(enqueue.description).toContain("SHA-256 verifiers");
    expect(enqueue.security).toEqual([
      { projectApiKey: [], projectAuthAccess: [] }, { projectApiKey: [] },
    ]);
    const claims = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/queues/{queue}/claims"].post;
    expect(claims.description).toContain("shown once");
    expect(qkernOpenAPI.components.schemas.ProjectQueueClaim.properties.leaseToken.writeOnly).toBe(true);
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/queues/{queue}/messages/{messageId}/fail"].post.description)
      .toContain("computed by the server");
    expect(JSON.stringify(qkernOpenAPI.components.schemas.ProjectQueueStatus))
      .not.toMatch(/payload|worker|lease|token|dedupe/i);
    const deadLetters = qkernOpenAPI.paths[
      "/v1/projects/{projectId}/environments/{environment}/queues/{queue}/dead-letters"
    ].get;
    expect(deadLetters.description).toContain("never returned");
    expect(Object.keys(qkernOpenAPI.components.schemas.ProjectQueueDeadLetter.properties).join(" "))
      .not.toMatch(/payload|worker|lease|token|owner|dedupe/i);
    const replay = qkernOpenAPI.paths[
      "/v1/projects/{projectId}/environments/{environment}/queues/{queue}/dead-letters/{messageId}/replay"
    ].post;
    expect(replay.summary).toContain("without executing it in the request");
    expect(replay.security).toEqual([{ sessionCookie: [] }]);
    const usage = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/usage"].get;
    expect(usage.operationId).toBe("getProjectUsageProjection");
    expect(usage.description).toContain("does not expose event keys");
    expect(usage.security).toEqual([{ sessionCookie: [] }]);
    expect(qkernOpenAPI.components.schemas.UsageProjection.properties.metrics.minItems).toBe(6);
    expect(qkernOpenAPI.components.schemas.UsageMetricProjection.properties.used.type).toBe("string");
    expect(qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/generated-openapi"].get.operationId)
      .toBe("getGeneratedProjectOpenApi");
    const automation = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/automation-policy"];
    expect(automation.put.description).toContain("do not require per-change human approval");
    expect(automation.put.description).toContain("machine-signed release authorization");
    expect(qkernOpenAPI.components.schemas.SetProjectAutomationPolicy.properties.mode.enum)
      .toEqual(["manual", "guarded", "autonomous"]);
    const provisioning = qkernOpenAPI.paths["/v1/projects/{projectId}/environments/{environment}/provisioning"];
    expect(provisioning.get.operationId).toBe("getProjectDatabaseProvisioning");
    expect(provisioning.post.summary).toContain("never provisions in the request");
    expect(provisioning.post.responses).toHaveProperty("202");
    expect(provisioning.post.responses).toHaveProperty("200");
    expect(qkernOpenAPI.components.schemas.ProjectDatabaseProvisioningRequestResult.allOf[1].properties.executed.const)
      .toBe(false);
    expect(JSON.stringify(qkernOpenAPI.components.schemas.ProjectDatabaseProvisioningStatus))
      .not.toMatch(/host|port|vault|databaseInstanceRef|credential|lease|token/i);
    const provisioningHealth = qkernOpenAPI.paths["/v1/projects/provisioning/health"].get;
    expect(provisioningHealth.operationId).toBe("getProjectDatabaseProvisioningHealth");
    expect(provisioningHealth.summary).toContain("without direct job or heartbeat table access");
    expect(
      qkernOpenAPI.components.schemas.ProjectDatabaseProvisioningHealth
        .properties.policy.properties.heartbeatStaleAfterSeconds.const,
    ).toBe(120);
    expect(JSON.stringify(qkernOpenAPI.components.schemas.ProjectDatabaseProvisioningHealth))
      .not.toMatch(/jobId|projectId|environment|provisionerId|leaseOwner|leaseToken|host|port|vault|credential/i);
    const provisioningMetrics =
      qkernOpenAPI.paths["/internal/v1/projects/provisioning/metrics"].get;
    expect(provisioningMetrics.operationId).toBe("getProjectDatabaseProvisioningMetrics");
    expect(provisioningMetrics.description).toContain("never accepts session cookies");
    expect(provisioningMetrics.description).toContain("Ed25519-signed evidence");
    expect(provisioningMetrics.description).toContain("background-runtime deployment");
    expect(provisioningMetrics.description).toContain("real-provider E2E/Pager");
    expect(provisioningMetrics.description).toContain("release-security-assessment");
    expect(provisioningMetrics.security).toEqual([{ metricsBearer: [] }]);
    expect(qkernOpenAPI.components.securitySchemes.metricsBearer.scheme).toBe("bearer");
    const apply = qkernOpenAPI.paths["/v1/changesets/{changeSetId}/apply"].post;
    expect(apply.operationId).toBe("queueChangeSetApply");
    expect(apply.summary).toContain("never executes SQL");
    expect(apply.responses).toHaveProperty("202");
    expect(apply.responses).toHaveProperty("200");
    expect(apply.responses).toHaveProperty("409");
    expect(apply.responses).toHaveProperty("404");
    const reviews = qkernOpenAPI.paths["/v1/migrations/reviews"].get;
    expect(reviews.operationId).toBe("listMigrationReviews");
    const reconciliation = qkernOpenAPI.paths["/v1/migrations/{jobId}/review/reconciliation"].post;
    expect(reconciliation.summary).toContain("never executes SQL");
    expect(reconciliation.responses).toHaveProperty("202");
    expect(qkernOpenAPI.components.schemas.MigrationReconciliationRequestResult.properties.executed.const).toBe(false);
    const applyDeliveryHealth = qkernOpenAPI.paths["/v1/migrations/delivery/health"].get;
    expect(applyDeliveryHealth.operationId).toBe("getMigrationApplyDeliveryHealth");
    expect(applyDeliveryHealth.summary).toContain("without direct outbox access");
    const applyDelivery = qkernOpenAPI.paths["/v1/migrations/{jobId}/delivery"].get;
    expect(applyDelivery.operationId).toBe("getMigrationApplyDelivery");
    const applyDeliveryRetry = qkernOpenAPI.paths["/v1/migrations/{jobId}/delivery/retry"].post;
    expect(applyDeliveryRetry.summary).toContain("never publishes or executes SQL");
    expect(applyDeliveryRetry.requestBody.content["application/json"].schema.required)
      .toEqual(["reasonCode", "expectedFailureCode", "expectedRetryCycle"]);
    expect(applyDeliveryRetry.responses).toHaveProperty("202");
    expect(applyDeliveryRetry.responses).toHaveProperty("409");
    expect(qkernOpenAPI.components.schemas.MigrationApplyDeliveryRetryResult.properties.executed.const)
      .toBe(false);
    expect(JSON.stringify(qkernOpenAPI.components.schemas.MigrationApplyDeliveryStatus))
      .not.toMatch(/lease|token|broker|credential|provider|response/i);
    const incidents = qkernOpenAPI.paths["/v1/migrations/incidents"].get;
    expect(incidents.operationId).toBe("listMigrationIncidents");
    const deliveryHealth = qkernOpenAPI.paths["/v1/migrations/incidents/delivery/health"].get;
    expect(deliveryHealth.operationId).toBe("getMigrationIncidentDeliveryHealth");
    expect(deliveryHealth.summary).toContain("without direct outbox access");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryHealth.properties.policy.properties.overdueAfterSeconds.const).toBe(300);
    expect(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryState.properties.lastFailureCode.enum)
      .toContain("SIGNING_KEY_UNAVAILABLE");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryHealth.required)
      .toContain("activeDeliveryTimeoutCount");
    const acknowledgement = qkernOpenAPI.paths["/v1/migrations/incidents/{incidentId}/acknowledgement"].post;
    expect(acknowledgement.summary).toContain("without resolving");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentAcknowledgementResult.properties.executed.const).toBe(false);
    const deliveryRetry = qkernOpenAPI.paths["/v1/migrations/incidents/{incidentId}/delivery/retry"].post;
    expect(deliveryRetry.summary).toContain("never publishes or resolves");
    expect(deliveryRetry.responses).toHaveProperty("202");
    expect(deliveryRetry.responses).toHaveProperty("409");
    expect(deliveryRetry.requestBody.content["application/json"].schema.required)
      .toContain("expectedFailureCode");
    expect(deliveryRetry.requestBody.content["application/json"].schema.required)
      .toContain("expectedRetryCycle");
    expect(deliveryRetry.responses["409"].description).toContain("retry generation changed");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryRetryResult.required)
      .toContain("expectedRetryCycle");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryRetryResult.properties.executed.const).toBe(false);
    const resolution = qkernOpenAPI.paths["/v1/migrations/incidents/{incidentId}/resolution/verification"].post;
    expect(resolution.summary).toContain("never executes SQL");
    expect(resolution.summary).toContain("operator assertion");
    expect(resolution.responses).toHaveProperty("202");
    expect(resolution.responses).toHaveProperty("409");
    expect(resolution.requestBody.content["application/json"].schema.properties.reasonCode.const)
      .toBe("target_ledger_recheck");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentResolutionVerificationResult.properties.executed.const)
      .toBe(false);
    expect(qkernOpenAPI.components.schemas.MigrationIncidentItem.properties.status.enum).toContain("resolved");
    expect(qkernOpenAPI.components.schemas.MigrationIncidentItem.properties.resolutionCode.const)
      .toBe("target_ledger_match");
    expect(JSON.stringify(qkernOpenAPI.components.schemas.MigrationIncidentItem)).not.toContain("databaseInstanceRef");
    expect(JSON.stringify(qkernOpenAPI.components.schemas.MigrationIncidentItem)).not.toContain("statement");
    expect(JSON.stringify(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryState)).not.toMatch(/lease|token|provider|response/i);
    expect(JSON.stringify(qkernOpenAPI.components.schemas.MigrationIncidentDeliveryHealth)).not.toMatch(/leaseOwner|leaseToken|token|provider|response/i);
  });

  it("documents schema names with the same grammar as table names (2.33)", () => {
    const base = "/v1/projects/{projectId}/environments/{environment}";
    const schemaParameter = (path: string, method: "get") => {
      const operation = (qkernOpenAPI.paths as unknown as Record<string, Record<string, { parameters?: ReadonlyArray<{ name: string; schema: { pattern?: string; default?: string } }> }>>)[path][method];
      return operation.parameters?.find((parameter) => parameter.name === "schema")?.schema;
    };
    for (const path of [`${base}/schema`, `${base}/generated-openapi`, `${base}/tables/{table}/rows`]) {
      const schema = schemaParameter(path, "get");
      expect(schema).toMatchObject({ pattern: `^${DATA_IDENTIFIER_PATTERN}$`, default: "public" });
      const pattern = new RegExp(schema!.pattern!);
      expect(pattern.test("Shop")).toBe(true);
      expect(pattern.test('Shop"')).toBe(false);
      expect(pattern.test("S".repeat(64))).toBe(false);
    }
  });
  it("gives every generated request body a schema pattern, like the query parameters", () => {
    const schemas = (qkernOpenAPI.components as unknown as { schemas: Record<string, { properties?: Record<string, { pattern?: string; default?: string }> }> }).schemas;
    for (const name of ["GeneratedInsertRows", "GeneratedUpdateRow", "GeneratedDeleteRow"]) {
      expect(schemas[name].properties?.schema, name).toMatchObject({ pattern: `^${DATA_IDENTIFIER_PATTERN}$`, default: "public" });
    }
  });

});
