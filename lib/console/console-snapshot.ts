import type { Approval, AuditEvent, ChangeSet, Project } from "@/lib/types";

/**
 * Die eine Antwort, die die Console beim Oeffnen holt (`/api/v1/console`).
 *
 * Der Typ stand in `console-app.tsx`. Er steht jetzt hier, weil die
 * Uebersicht in einer eigenen Datei liegt und ihn ebenfalls braucht; ein
 * Import aus der Schale heraus waere ein Kreis.
 */
export type Snapshot = { user: { id: string; email: string }; organization: { id: string; name: string; slug: string }; projects: Project[]; changeSets: ChangeSet[]; approvals: Approval[]; audit: AuditEvent[] };
