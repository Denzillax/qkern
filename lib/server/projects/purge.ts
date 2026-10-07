import type { PostgresControlPlane } from "@/lib/server/db/repositories";

/**
 * Der Abraeumer fuer geloeschte Projekte, erster Teil (2.175).
 *
 * Entschieden von Denzil (docs/PROJEKT_LOESCHEN.md): Ein geloeschtes Projekt
 * ist sieben Tage zurueckholbar und wird danach abgeraeumt; das Audit-Log und
 * die Abrechnung bleiben, die Zeile in `projects` bleibt als Huelle mit
 * `purged_at`.
 *
 * **Was dieser Teil abraeumt.** Die Backups, auf demselben Weg wie das Ende
 * ihrer Aufbewahrung: erst das Objekt, dann verliert der Katalogeintrag
 * Objektverweis und Schluessel (`forget`). Danach widerruft
 * `qkern_purge_project` die Keys und setzt `purged_at`, aber nur, wenn kein
 * Backup mehr lesbar ist und keines mehr laeuft. Buckets kommen mit 2.176, der
 * Abbau der Datenbank ueber den Broker mit 2.177.
 *
 * **Wiederaufnehmbar.** Jede Runde nimmt das Projekt mit der aeltesten
 * abgelaufenen Frist und so viele Backups, wie in eine Runde passen. Bricht
 * sie ab, ist nichts halb: Ein Objekt, das schon weg ist, meldet der Speicher
 * als erledigt (404 ist Erfolg), und ein Eintrag, der schon vergessen ist,
 * aendert `forget` nicht mehr. Die naechste Runde macht dort weiter.
 *
 * **Wo es laeuft.** In der Leerlaufrunde des Provisioners, neben dem
 * Backup-Zeitplan: Er ist der Prozess mit Zugang zum Backup-Speicher und mit
 * der Rolle, der die Funktion gehoert.
 */
export type ProjectPurgeRoundResult = Readonly<{
  projectId: string;
  backupsRemoved: number;
  /** `true`, wenn das Projekt in dieser Runde zur Huelle wurde. */
  purged: boolean;
  apiKeysRevoked: number;
  s3KeysRevoked: number;
}>;

export type ProjectPurgeDependencies = Readonly<{
  database: Pick<PostgresControlPlane, "withTenant">;
  organizationId: string;
  /** Der Backup-Speicher; ein fehlendes Objekt gilt als geloescht. */
  objects: { delete(objectKey: string): Promise<void> };
  /** Der Backup-Katalog; `forget` ist derselbe Schritt wie bei `pruneExpired`. */
  backups: { forget(backupId: string): Promise<void> };
  actorRef?: string;
  /** Wie viele Backups eine Runde hoechstens anfasst. */
  batchSize?: number;
}>;

export class ProjectPurgeRound {
  private readonly actorRef: string;
  private readonly batchSize: number;

  constructor(private readonly dependencies: ProjectPurgeDependencies) {
    this.actorRef = dependencies.actorRef ?? "project-purge";
    const batch = dependencies.batchSize ?? 20;
    this.batchSize = Number.isSafeInteger(batch) && batch >= 1 && batch <= 200 ? batch : 20;
  }

  /** Eine Runde. `null`, wenn kein Projekt faellig ist. */
  async runRound(): Promise<ProjectPurgeRoundResult | null> {
    const { database, organizationId } = this.dependencies;
    const due = await database.withTenant({ organizationId, actorRef: this.actorRef, readOnly: true }, async (repositories) => {
      const result = await repositories.transaction.query(
        `SELECT id FROM projects
         WHERE organization_id = $1 AND deleted_at IS NOT NULL
           AND delete_after <= now() AND purged_at IS NULL
         ORDER BY delete_after, id
         LIMIT 1`,
        [organizationId],
      );
      return result.rows[0] ? String(result.rows[0].id) : null;
    });
    if (!due) return null;

    const backups = await database.withTenant({ organizationId, actorRef: this.actorRef, readOnly: true }, async (repositories) => {
      const result = await repositories.transaction.query(
        `SELECT id, object_key FROM project_database_backups
         WHERE organization_id = $1 AND project_id = $2
           AND status = 'available' AND object_key IS NOT NULL
         ORDER BY created_at, id
         LIMIT $3`,
        [organizationId, due, this.batchSize],
      );
      return result.rows.map((row) => ({ id: String(row.id), objectKey: String(row.object_key) }));
    });
    for (const backup of backups) {
      await this.dependencies.objects.delete(backup.objectKey);
      await this.dependencies.backups.forget(backup.id);
    }

    return database.withTenant({ organizationId, actorRef: this.actorRef }, async (repositories) => {
      const result = await repositories.transaction.query(
        "SELECT purged_at, api_keys_revoked, s3_keys_revoked FROM qkern_purge_project($1)",
        [due],
      );
      const row = result.rows[0];
      const purged = Boolean(row);
      const apiKeysRevoked = row ? Number(row.api_keys_revoked) : 0;
      const s3KeysRevoked = row ? Number(row.s3_keys_revoked) : 0;
      if (purged) {
        await repositories.audit.append({
          projectId: due,
          environment: null,
          actorType: "provisioner",
          actorRef: this.actorRef,
          action: "project.purged",
          resourceRef: due,
          status: "succeeded",
          metadata: {
            backupsRemoved: backups.length, apiKeysRevoked, s3KeysRevoked,
            // Was dieser Teil noch nicht abraeumt, steht im Eintrag selbst.
            pending: ["storage_buckets", "project_databases"],
          },
        });
      }
      return { projectId: due, backupsRemoved: backups.length, purged, apiKeysRevoked, s3KeysRevoked };
    });
  }
}
