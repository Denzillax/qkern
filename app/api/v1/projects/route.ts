import { NextRequest, NextResponse } from "next/server";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { csrfRejected, hasTrustedOrigin, safeJson } from "@/lib/server/auth/http";
import { domainErrorCode } from "@/lib/server/domain-errors";
import { ProjectDraftError, validateProjectDraft } from "@/lib/console/project-draft";
import { asControlPlaneContext, authenticatedContext, RequestAuthenticationError, RequestAuthorizationError, requireCapability } from "@/lib/server/request-context";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "read");
    return NextResponse.json({ data: await controlPlaneService.listProjects(asControlPlaneContext(context)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json({ error: "Projects unavailable" }, { status: 500 });
  }
}

/**
 * Ein Projekt anlegen (2.147).
 *
 * Dieselbe Tuer wie bei den Nachbarrouten: Herkunftspruefung wie bei jeder
 * schreibenden Route, dann die Session, dann das Recht `project_create`. Die
 * Reihenfolge ist Absicht -- CSRF zuerst, weil eine Anfrage aus fremder
 * Herkunft gar nicht erst mit der Session verrechnet werden soll.
 *
 * Validiert wird mit demselben reinen Modul, das die Form im Projektwechsler
 * schon vor dem Absenden anwendet (`lib/console/project-draft`). Der Slug kommt
 * dort aus dem Namen; der Aufrufer schickt ihn nicht, damit es keine zweite
 * Quelle fuer dieselbe Regel gibt.
 *
 * Die Antwort ist 201 mit dem Projekt, dessen `status` `provisioning` sagt. Die
 * Antwort traegt ausserdem `environments`, naemlich die drei festen Umgebungen,
 * und `databaseProvisioned: false`: Dieses Anlegen bringt keine
 * Projektdatenbank mit, die Umgebungen warten auf die Bereitstellung. Das steht
 * hier und in der Oberflaeche, und nicht nur in der Dokumentation.
 *
 * Ablehnungen: 400 mit dem Grund in Worten, wenn aus der Eingabe kein Projekt
 * wird; 409, wenn die Kennung in dieser Organisation schon vergeben ist; 403,
 * wenn die Rolle das Recht nicht hat (und nicht 404 wie beim Lesen -- wer die
 * Liste sehen darf, weiss ohnehin, dass es Projekte gibt, und ein 404 auf dem
 * eigenen Pfad waere die unverstaendlichere Auskunft).
 */
export async function POST(request: NextRequest) {
  if (!hasTrustedOrigin(request)) return csrfRejected();
  let draft;
  try {
    draft = validateProjectDraft(await safeJson(request));
  } catch (error) {
    if (error instanceof ProjectDraftError) return NextResponse.json({ error: error.reason }, { status: 400 });
    throw error;
  }
  try {
    const context = await authenticatedContext(request);
    requireCapability(context, "project_create");
    const project = await controlPlaneService.createProject(asControlPlaneContext(context), draft);
    return NextResponse.json({
      data: project,
      // Die Umgebungen entstehen mit der Bereitstellung: Die Zeilen stehen da,
      // ihre Datenbankreferenz wartet. Darum sagt es diese Antwort und nicht
      // nur die Beschreibung.
      environments: ["development", "staging", "production"],
      databaseProvisioned: false,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof RequestAuthorizationError) {
      return NextResponse.json({ error: "This role may not create projects." }, { status: 403 });
    }
    const code = domainErrorCode(error);
    if (code === "PROJECT_SLUG_TAKEN") {
      return NextResponse.json({
        error: "A project with this identifier already exists in this organization. A deleted project keeps its identifier.",
      }, { status: 409 });
    }
    if (code === "INVALID_PROJECT_ACTOR") {
      return NextResponse.json({ error: "Only a signed-in person can create a project." }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not create project" }, { status: 500 });
  }
}
