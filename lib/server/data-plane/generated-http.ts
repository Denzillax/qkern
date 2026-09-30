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
import {
  projectAuthOAuthAllows,
  PROJECT_AUTH_OAUTH_TOKEN,
  type ProjectAuthOAuthScope,
} from "@/lib/server/project-auth/oauth";
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
  /**
   * Gesetzt, wenn dieser Aufrufer ein OAuth-Token vorgelegt hat (2.82): der Name
   * des Clients und die Bereiche, denen der Nutzer zugestimmt hat.
   *
   * Es steht hier und nicht in `claims`, weil es eine Angabe fuer die Route ist
   * und nicht fuer eine Policy. Was die Policy sieht, steht in
   * `claims.external`, und dort steht es zusaetzlich.
   */
  oauth?: { clientName: string; scopes: readonly ProjectAuthOAuthScope[] };
};

/**
 * Welche OAuth-Token eine Tuer annimmt (2.82).
 *
 * Die Vorgabe ist `reject`, und das ist die tragende Entscheidung dieser Zeile.
 * `projectApplicationPrincipal` wird nicht nur von der Data API benutzt, sondern
 * auch von den Queues (`lib/server/project-queues/http.ts`) und den
 * Function-Definitionen (`lib/server/compute/definitions-http.ts`). Ein Token,
 * das an diesen Tueren einfach mitgelaufen waere, haette eine Erlaubnis gehabt,
 * die an dieser Tuer niemand geprueft hat.
 *
 * Darum muss eine Tuer ein OAuth-Token ausdruecklich zulassen, und sie sagt
 * dabei, was sie tut: `read` verlangt `data:read`, `write` verlangt
 * `data:write`. Wer eine neue Tuer baut und nichts angibt, bekommt die
 * geschlossene, und das ist die richtige Richtung.
 *
 * Seit Migration 0073 gibt es Bereiche, die eine Queue und einen Bucket
 * beschreiben (`queues:read`, `queues:write`, `storage:read`), und an dieser
 * Vorgabe aendert das nichts. Sie wirken am entfernten MCP-Server
 * (`mcp/tool-scopes.ts`) und nicht hier: Eine Tuer aufzumachen heisst, ihre
 * Ansprueche, ihre Rolle und ihre Ablehnungen zu pruefen, und das ist je Tuer
 * ein eigener Schnitt. Ein vorhandener Bereich ist der Satz, den eine solche
 * Tuer dann verlangen kann, und keine Zulassung im Vorbeigehen.
 */
export type ProjectOAuthAdmission = "reject" | "read" | "write";

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

/**
 * Die Form eines Projekt-Keys auf der Leitung (`lib/server/project-api-keys/service.ts`).
 *
 * Bis 2.82 stand hier `startsWith("qk_")`, und das war zu weit. Jeder
 * undurchsichtige Bezeichner dieses Produkts beginnt mit `qk_`, und seit es ein
 * OAuth-Token gibt (`qk_oauth_…`), waere ein solches Token als Projekt-Key
 * gelesen worden und damit an der falschen Tuer gescheitert. Geprueft wird darum
 * die Art und nicht bloss das Praefix: Ein Bearer, der kein Key ist, ist ein
 * Token, und ueber Token entscheidet eine Ebene weiter unten.
 */
const PROJECT_API_KEY_BEARER = /^qk_(public|service)_/;

/**
 * Ein Token, das QKERN selbst an einen fremden Client ausgegeben hat (2.82), in
 * einen Aufrufer der Data API uebersetzt.
 *
 * Der Unterschied zum Token der eigenen Anmeldung steht in jedem Feld:
 *
 * - `actorRef` beginnt mit `project-auth-oauth:` und traegt den Namen des
 *   Clients und die Kennung des Nutzers. Wer im Log sucht, soll sehen, dass hier
 *   eine fremde Anwendung geschrieben hat und nicht die eigene.
 * - `claims.external` traegt `token_use: "oauth"`, den Namen des Clients und die
 *   Bereiche. Eine Policy kann damit einem fremden Client weniger erlauben als
 *   der eigenen Anwendung, obwohl beide denselben Nutzer nennen. Ohne diese
 *   Angaben waeren die beiden Faelle in `request.jwt.claims` nicht
 *   auseinanderzuhalten, und genau das ist die Unterscheidung, die eine Policy
 *   treffen koennen muss.
 * - Kein `sessionId`, kein `aal`, keine Metadaten. Alle drei sind Zusagen ueber
 *   eine Sitzung der eigenen Anmeldung. Ein OAuth-Token haengt an keiner
 *   Sitzung: Es ueberlebt die Abmeldung des Nutzers in der eigenen Anwendung, und
 *   ein `aal2` hier hinzuschreiben waere erfunden.
 * - `email` ist gesetzt, weil sie mit `identity:read` ohnehin abrufbar ist und
 *   eine Policy sie oft braucht. Ist `identity:read` nicht zugestimmt, ist sie
 *   auch hier nicht dabei: Ein Bereich, der an einer Stelle gilt und an einer
 *   anderen nicht, waere kein Bereich.
 *
 * **Die Rolle ist `authenticated`, und sie wird gesetzt und nicht gelesen.**
 * `service_role` kann hier nicht herauskommen: Der Dienst gibt sie nicht her, es
 * gibt in Migration 0062 keine Spalte, die sie tragen koennte, und
 * `assertRequest` in der Data API weist sie zusaetzlich ab.
 */
async function oauthPrincipal(
  service: ProjectAuthService,
  authScope: { organizationId: string; projectId: string; environment: Environment },
  token: string,
  admission: Exclude<ProjectOAuthAdmission, "reject">,
): Promise<ProjectApplicationPrincipal> {
  let verdict: Awaited<ReturnType<ProjectAuthService["verifyOAuthToken"]>>;
  try {
    verdict = await service.verifyOAuthToken(authScope, token);
  } catch {
    throw new RequestAuthenticationError();
  }
  // Der Grund bleibt drinnen, wie bei den fremden Anbietern: Ein Aufrufer, der
  // erfaehrt, ob sein Token unbekannt oder abgelaufen ist, bekommt ein Werkzeug
  // zum Probieren. Der Betreiber liest den Grund im Log.
  if (!verdict.ok) throw new RequestAuthenticationError();
  const identity = verdict.identity;
  const needed: ProjectAuthOAuthScope = admission === "write" ? "data:write" : "data:read";
  // Ein fehlender Bereich ist keine Authentifizierungsfrage, sondern eine
  // Rechtefrage: Das Token ist echt, der Nutzer hat nur nicht zugestimmt. Darum
  // die Autorisierungsablehnung und nicht die andere.
  if (!projectAuthOAuthAllows(identity.scopes, needed)) throw new RequestAuthorizationError();
  const identityRead = projectAuthOAuthAllows(identity.scopes, "identity:read");
  return {
    organizationId: authScope.organizationId,
    actorRef: `project-auth-oauth:${identity.clientName}:${identity.userId}`.slice(0, 320),
    role: identity.role,
    subject: identity.userId,
    claims: {
      role: identity.role,
      subject: identity.userId,
      ...(identityRead ? { email: identity.email } : {}),
      external: {
        token_use: "oauth",
        client_id: identity.clientName,
        scope: identity.scopes.join(" "),
      },
    },
    oauth: { clientName: identity.clientName, scopes: identity.scopes },
  };
}

export function presentedProjectApiKey(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const rawBearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  const bearer = rawBearer && PROJECT_API_KEY_BEARER.test(rawBearer) ? rawBearer : null;
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
  // Die einzige Tuer, die OAuth-Token annimmt (2.82), und sie sagt mit dem
  // letzten Argument, welchen Bereich sie verlangt. `write` kommt von der Route
  // und nicht aus dem Token: Eine Route weiss, ob sie schreibt.
  const application = await projectApplicationPrincipal(
    request, scope, keys, projectAuth, write ? "write" : "read",
  );
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
  oauth: ProjectOAuthAdmission = "reject",
): Promise<ProjectApplicationPrincipal | null> {
  const presented = presentedProjectApiKey(request);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
  const appAccessToken = bearer && !PROJECT_API_KEY_BEARER.test(bearer) ? bearer : null;
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
    // Ein OAuth-Token (2.82) wird an seiner Form erkannt und nicht durch einen
    // gescheiterten Versuch als eigenes Token. Das ist keine Abkuerzung: Ein
    // Token der eigenen Anmeldung ist ein JWT mit drei Teilen und kann diese Form
    // nie haben, also gibt es hier nichts zu verwechseln. Wer es anders herum
    // baute, laese jedes OAuth-Token erst als JWT, faende dort Muell und muesste
    // aus dem Misserfolg raten, was gemeint war.
    if (PROJECT_AUTH_OAUTH_TOKEN.test(appAccessToken)) {
      // Diese Tuer nimmt keine OAuth-Token. Kein Durchfallen zu den fremden
      // Anbietern: Das Token ist erkannt, und die Antwort ist eine Ablehnung und
      // kein zweiter Versuch mit einer anderen Bedeutung.
      if (oauth === "reject") throw new RequestAuthenticationError();
      return await oauthPrincipal(service, authScope, appAccessToken, oauth);
    }
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
