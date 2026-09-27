import { NextRequest, NextResponse } from "next/server";
import { csrfRejected, hasTrustedOrigin, safeJson, sessionToken } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { isAuthError, type AuthService } from "@/lib/server/auth/service";
import type { ConsoleDisplaySettingsRepository } from "@/lib/server/auth/console-settings";
import { ConsoleDisplayError, validateConsoleDisplaySettings } from "@/lib/console/display-settings";

export const dynamic = "force-dynamic";

/**
 * Die eigene Darstellung der Console (2.55), durch dieselbe Tuer wie die
 * Nachbarrouten des Kontos: Session-Cookie, `authRuntime`, kein
 * Organisationsbezug. Eine Projektroute waere hier falsch -- die Einstellung
 * gehoert zur Person und gilt in jedem Projekt.
 *
 * `Cache-Control: private, no-store`. GET liest die geltenden Einstellungen
 * (und gibt die Vorgaben zurueck, wenn nie etwas eingestellt wurde), PUT
 * ersetzt sie vollstaendig. Ein Koerper, aus dem sich keine gueltige
 * Darstellung bauen laesst, wird mit 400 und dem Grund in Worten abgelehnt;
 * geprueft wird mit demselben reinen Modul, das die Ansicht schon vor dem
 * Absenden anwendet.
 *
 * Kein DELETE: Zurueckstellen heisst, die Vorgaben zu schreiben, und dafuer
 * gibt es PUT.
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function unauthorized(): NextResponse {
  return json({ error: "Authentication required" }, 401);
}

async function userId(request: NextRequest, auth: AuthService): Promise<string | null> {
  const token = sessionToken(request);
  if (!token) return null;
  try {
    return (await auth.getSession(token)).user.id;
  } catch (error) {
    if (isAuthError(error, "INVALID_SESSION")) return null;
    throw error;
  }
}

export function createConsoleSettingsHandlers(
  auth: AuthService,
  repository: ConsoleDisplaySettingsRepository,
) {
  return {
    GET: async (request: NextRequest) => {
      const id = await userId(request, auth);
      if (!id) return unauthorized();
      return json({ data: await repository.find(id) });
    },
    PUT: async (request: NextRequest) => {
      if (!hasTrustedOrigin(request)) return csrfRejected();
      const id = await userId(request, auth);
      if (!id) return unauthorized();
      let settings;
      try {
        settings = validateConsoleDisplaySettings(await safeJson(request));
      } catch (error) {
        if (error instanceof ConsoleDisplayError) return json({ error: error.reason }, 400);
        throw error;
      }
      return json({ data: await repository.save(id, settings) });
    },
  };
}

const handlers = () => createConsoleSettingsHandlers(authRuntime.service, authRuntime.consoleSettings);

export const GET = (request: NextRequest) => handlers().GET(request);
export const PUT = (request: NextRequest) => handlers().PUT(request);
