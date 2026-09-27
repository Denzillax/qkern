import type { NextRequest } from "next/server";
import type { Environment } from "@/lib/types";
import type { GeneratedDataContext } from "@/lib/server/data-plane/generated-api";
import {
  authenticatedContext,
  RequestAuthenticationError,
  RequestAuthorizationError,
  requireCapability,
} from "@/lib/server/request-context";
import type { ProjectApiKeyService } from "@/lib/server/project-api-keys/service";
import { projectApiKeyService } from "@/lib/server/project-api-keys/runtime";
import { getProjectAuthService } from "@/lib/server/project-auth/runtime";
import type { ProjectAuthService } from "@/lib/server/project-auth/service";
import { admitApiRequest } from "@/lib/server/usage/api-requests";
// Welche Rolle ein Public oder Service Key setzt, steht in lib/data-api-limits.ts; die Console zeigt denselben Wert.
import { DATA_API_LIMITS, type DataApiKeyClaim } from "@/lib/data-api-limits";

export type GeneratedDataScope = { projectId: string; environment: Environment };

export type ProjectApplicationPrincipal = {
  organizationId: string;
  actorRef: string;
  role: "authenticated" | DataApiKeyClaim;
  subject: string;
  claims: GeneratedDataContext["claims"];
};

/**
 * Ein Token eines fremden Anbieters (2.80), in einen Aufrufer der Data API
 * uebersetzt.
 *
 * Der Unterschied zum eigenen Token steht in jedem Feld:
 *
 * - `actorRef` beginnt mit `project-auth-third-party:` und traegt den Namen des
 *   Anbieters und das Subjekt beim Anbieter. Es gibt keine Nutzer-ID von QKERN,
 *   weil es keinen Nutzer gibt. Wer im Audit oder im Data-API-Log sucht, soll
 *   nicht nach einem Konto suchen, das nie existiert hat.
 * - `claims.issuer` ist gesetzt, und zwar nur hier. Eine Policy kann damit
 *   pruefen, dass eine Zeile einem fremden Konto gehoert und nicht einem
 *   eigenen; ohne diesen Anspruch waeren die beiden Faelle in
 *   `request.jwt.claims` nicht auseinanderzuhalten.
 * - Kein `sessionId`, kein `aal`, kein `email_verified`. Alle drei sind Zusagen
 *   ueber eine Sitzung und ein Konto von QKERN. Ein `aal1` hier hinzuschreiben
 *   waere erfunden: QKERN weiss nicht, wie sich dieser Mensch beim fremden
 *   Dienst angemeldet hat.
 *
 * **Die Rolle kommt aus dem Eintrag und nie aus dem Token allein**, und sie ist
 * hoechstens `authenticated`. `service_role` kann hier nicht herauskommen: Die
 * Pruefung gibt sie nicht her, die Datenbank laesst sie nicht eintragen, und
 * `assertRequest` in der Data API weist ein fremdes Token mit dieser Rolle
 * zusaetzlich ab.
 */
async function thirdPartyPrincipal(
  service: ProjectAuthService,
  authScope: { organizationId: string; projectId: string; environment: Environment },
  token: string,
): Promise<ProjectApplicationPrincipal> {
  let verdict: Awaited<ReturnType<ProjectAuthService["verifyThirdPartyToken"]>>;
  try {
    verdict = await service.verifyThirdPartyToken(authScope, token);
  } catch {
    throw new RequestAuthenticationError();
  }
  // Der Grund bleibt drinnen. Ein Aufrufer, der erfaehrt, ob sein Publikum oder
  // seine Unterschrift nicht gepasst hat, bekommt ein Werkzeug zum Probieren;
  // wer den Grund braucht, ist der Betreiber, und der liest ihn im Log.
  if (!verdict.ok) throw new RequestAuthenticationError();
  const identity = verdict.identity;
  return {
    organizationId: authScope.organizationId,
    actorRef: `project-auth-third-party:${identity.providerName}:${identity.subject}`.slice(0, 320),
    role: identity.role,
    subject: identity.subject,
    claims: {
      role: identity.role,
      subject: identity.subject,
      issuer: identity.issuer,
      external: identity.claims,
    },
  };
}

export function presentedProjectApiKey(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const rawBearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  const bearer = rawBearer?.startsWith("qk_") ? rawBearer : null;
  const explicit = request.headers.get("x-qkern-key")?.trim() || null;
  if (explicit && !explicit.startsWith("qk_")) throw new RequestAuthenticationError();
  if (bearer && explicit && bearer !== explicit) throw new RequestAuthenticationError();
  const key = bearer ?? explicit;
  return key ?? null;
}

export async function generatedDataContext(
  request: NextRequest,
  scope: GeneratedDataScope,
  write: boolean,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
): Promise<GeneratedDataContext> {
  const application = await projectApplicationPrincipal(request, scope, keys, projectAuth);
  if (application) {
    await admitApiRequest("generated_data_api", { organizationId: application.organizationId, ...scope });
    return {
      organizationId: application.organizationId,
      actorRef: application.actorRef,
      claims: application.claims,
    };
  }

  const principal = await authenticatedContext(request);
  requireCapability(principal, write ? "project_data_mutate" : "read");
  const organizationId = principal.membership.organization.id;
  await admitApiRequest("generated_data_api", { organizationId, ...scope });
  return {
    organizationId,
    actorRef: principal.user.email,
    claims: { role: "authenticated", subject: principal.user.id },
  };
}

export async function projectApplicationPrincipal(
  request: NextRequest,
  scope: GeneratedDataScope,
  keys: ProjectApiKeyService = projectApiKeyService,
  projectAuth?: ProjectAuthService,
): Promise<ProjectApplicationPrincipal | null> {
  const presented = presentedProjectApiKey(request);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  const appAccessToken = bearer && !bearer.startsWith("qk_") ? bearer : null;
  if (appAccessToken) {
    if (!presented) throw new RequestAuthenticationError();
    const keyPrincipal = await keys.authenticate(presented);
    if (!keyPrincipal) throw new RequestAuthenticationError();
    if (keyPrincipal.projectId !== scope.projectId || keyPrincipal.environment !== scope.environment) {
      throw new RequestAuthorizationError();
    }
    const authScope = {
      organizationId: keyPrincipal.organizationId,
      projectId: scope.projectId,
      environment: scope.environment,
    };
    const service = projectAuth ?? getProjectAuthService();
    try {
      const principal = await service.verifyAccess(authScope, appAccessToken);
      return {
        organizationId: authScope.organizationId,
        actorRef: `project-auth-user:${principal.user.id}`,
        role: "authenticated",
        subject: principal.user.id,
        claims: {
          role: "authenticated", subject: principal.user.id, email: principal.user.email,
          emailVerified: Boolean(principal.user.emailVerifiedAt), assurance: principal.session.assurance,
          sessionId: principal.session.id, userMetadata: principal.user.userMetadata,
          appMetadata: principal.user.appMetadata,
        },
      };
    } catch {
      // Kein eigenes Token dieser Umgebung. Bevor das eine Ablehnung wird,
      // bekommt der Weg fuer fremde Anbieter (2.80) seinen Versuch.
      //
      // **Die Reihenfolge ist Absicht und keine Bequemlichkeit.** Ein eigenes
      // Token wird immer zuerst als eigenes geprueft. Nur so kann kein
      // hinterlegter fremder Anbieter einem Token von QKERN eine andere
      // Bedeutung geben, auch dann nicht, wenn er denselben Aussteller nennt.
      //
      // **Warum der Projekt-Key trotzdem verlangt wird:** Er steht oben, bevor
      // ueberhaupt ein Token angesehen wird, und das bleibt so. Ein fremdes
      // Token allein soll die Data API dieses Projekts nicht oeffnen: Es sagt,
      // wer der Aufrufer ist, nicht, dass er an dieser Tuer etwas zu suchen hat.
      // Der Key ist die Zusage des Projekts, dass diese Anwendung hier anklopfen
      // darf, und er ist widerrufbar; das fremde Token ist es nicht.
      return await thirdPartyPrincipal(service, authScope, appAccessToken);
    }
  }
  if (presented) {
    const principal = await keys.authenticate(presented);
    if (!principal) throw new RequestAuthenticationError();
    if (principal.projectId !== scope.projectId || principal.environment !== scope.environment) {
      throw new RequestAuthorizationError();
    }
    return {
      organizationId: principal.organizationId,
      actorRef: `project-api-key:${principal.id}`,
      role: principal.kind === "service" ? DATA_API_LIMITS.keyClaims.service : DATA_API_LIMITS.keyClaims.public,
      subject: principal.id,
      claims: {
        role: principal.kind === "service" ? DATA_API_LIMITS.keyClaims.service : DATA_API_LIMITS.keyClaims.public,
        subject: principal.id,
        keyId: principal.id,
      },
    };
  }
  return null;
}
