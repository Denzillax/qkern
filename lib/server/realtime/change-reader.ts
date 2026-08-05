import type {
  GeneratedDataApiService,
  GeneratedDataContext,
  GeneratedDataFilter,
} from "@/lib/server/data-plane/generated-api";
import type { ProjectDataPlaneScope } from "@/lib/server/data-plane/service";
import type { RealtimeJson } from "@/lib/server/realtime/model";
import type {
  RealtimeChange,
  RealtimeChangeReader,
  RealtimeSubscriberClaims,
} from "@/lib/server/realtime/change-source";

/**
 * Liest die geänderte Zeile durch die Generated Data API — mit den Claims des
 * jeweiligen Abonnenten.
 *
 * Bewusst keine eigene Abfrage: Die Generated Data API prüft bereits das Live-
 * Schema, erzwingt Primärschlüssel und RLS, verifiziert Rolle, Datenbank und
 * Read-only-Zustand der Verbindung, parametrisiert jeden Wert und entfernt
 * Spalten mit sensitivem Namen. Diese Logik hier zu wiederholen hieße, eine
 * zweite Kopie einer Sicherheitsgrenze zu pflegen, die bereits zertifiziert ist.
 *
 * Ergebnis: Row Level Security autorisiert und erzeugt die Nutzlast in einem
 * Schritt. Kommt keine Zeile zurück, darf der Abonnent sie nicht sehen — oder
 * sie existiert nicht mehr. Beides führt zu `null`.
 */
export class GeneratedApiRealtimeChangeReader implements RealtimeChangeReader {
  constructor(private readonly api: GeneratedDataApiService) {}

  async read(
    change: RealtimeChange,
    subscriber: RealtimeSubscriberClaims,
  ): Promise<Record<string, RealtimeJson> | null> {
    // Nach einem DELETE existiert die Zeile nicht mehr; RLS kann nicht mehr
    // beantworten, wer sie hätte sehen dürfen. Der Schlüssel allein an alle
    // Kanalabonnenten zu melden würde seine Existenz offenlegen. Nur
    // service_role erfährt davon.
    if (change.operation === "delete") {
      return subscriber.role === "service_role" ? { ...change.key } : null;
    }

    const filters = Object.entries(change.key).map(([column, value]): GeneratedDataFilter => ({
      column, operator: "eq", value,
    }));
    if (filters.length === 0 || filters.length > 8) return null;

    const context: GeneratedDataContext = {
      // Die Organisation kommt aus der Aenderung, nicht aus dem Konstruktor:
      // eine Reader-Instanz bedient in der Runtime alle beobachteten Projekte,
      // und ein fester Wert wuerde fuer fremde Mandanten den falschen
      // Tenantkontext setzen.
      organizationId: change.organizationId,
      actorRef: `realtime:${subscriber.role}`,
      claims: {
        role: subscriber.role,
        // Ein anonymer Abonnent hat kein Subjekt. Die Data Plane verlangt das
        // Feld, deshalb steht dort ein fester, nicht auflösbarer Wert statt
        // eines geratenen.
        subject: subscriber.subject ?? "",
        ...(subscriber.claims ? { userMetadata: subscriber.claims } : {}),
      },
    };
    const scope: ProjectDataPlaneScope = {
      projectId: change.projectId,
      environment: change.environment,
    };

    try {
      const result = await this.api.listRows(context, scope, {
        schema: change.schema,
        table: change.table,
        filters,
        limit: 1,
      });
      const row = result.rows[0];
      return row ? (row as Record<string, RealtimeJson>) : null;
    } catch {
      // Fail-closed. Ein Fehler beim Lesen ist keine Erlaubnis.
      return null;
    }
  }
}
