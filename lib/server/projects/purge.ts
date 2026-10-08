import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { ProjectStorageProvider } from "@/lib/server/project-storage/provider";

/**
 * Der Abraeumer fuer geloeschte Projekte, erster Teil (2.175).
 *
 * Entschieden von Denzil (docs/PROJEKT_LOESCHEN.md): Ein geloeschtes Projekt
 * ist sieben Tage zurueckholbar und wird danach abgeraeumt; das Audit-Log und
 * die Abrechnung bleiben, die Zeile in `projects` bleibt als Huelle mit
 * `purged_at`.
 *
 * **Was er abraeumt.** Die Backups, auf demselben Weg wie das Ende ihrer
 * Aufbewahrung: erst das Objekt, dann verliert der Katalogeintrag
 * Objektverweis und Schluessel (`forget`). Seit 2.176 ebenso Storage: erst die
 * Datei beim Anbieter (ein offener Multipart-Upload wird abgebrochen), dann
 * vermerkt `qkern_forget_project_purge_storage` sie als weg. Danach loescht
 * `qkern_purge_project` die Buckets, widerruft die Keys und setzt
 * `purged_at`, aber nur, wenn kein Backup mehr lesbar ist oder laeuft und
 * beim Anbieter nichts mehr liegt, das der Katalog kennt. Der Abbau der
 * Datenbank ueber den Broker kommt mit 2.177.
 *
 * **Ohne Storage-Zugang** (Project Storage in diesem Prozess nicht
 * eingestellt) laesst der Abraeumer den Storage-Schritt aus. Hat das Projekt
 * dann noch Dateien, bleibt es stehen und wartet; geloescht wird nichts, was
 * beim Anbieter noch liegen koennte.
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
  /** Dateien und offene Uploads, die diese Runde beim Anbieter entfernt hat (2.176). */
  storageRemoved: number;
  /** `true`, wenn das Projekt in dieser Runde zur Huelle wurde. */
  purged: boolean;
  apiKeysRevoked: number;
  s3KeysRevoked: number;
  bucketsRemoved: number;
}>;

export type ProjectPurgeDependencies = Readonly<{
  database: Pick<PostgresControlPlane, "withTenant">;
  organizationId: string;
  /** Der Backup-Speicher; ein fehlendes Objekt gilt als geloescht. */
  objects: { delete(objectKey: string): Promise<void> };
  /** Der Backup-Katalog; `forget` ist derselbe Schritt wie bei `pruneExpired`. */
  backups: { forget(backupId: string): Promise<void> };
  /**
   * Der Storage-Anbieter (2.176). Fehlt er, laesst die Runde den Schritt aus,
   * und ein Projekt mit Dateien wartet.
   */
  storage?: Pick<ProjectStorageProvider, "deleteObject" | "abortMultipartUpload" | "listMultipartUploads">;
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

    const storageRemoved = await this.purgeStorage(due);

    return database.withTenant({ organizationId, actorRef: this.actorRef }, async (repositories) => {
      const result = await repositories.transaction.query(
        "SELECT purged_at, api_keys_revoked, s3_keys_revoked, buckets_removed FROM qkern_purge_project($1)",
        [due],
      );
      const row = result.rows[0];
      const purged = Boolean(row);
      const apiKeysRevoked = row ? Number(row.api_keys_revoked) : 0;
      const s3KeysRevoked = row ? Number(row.s3_keys_revoked) : 0;
      const bucketsRemoved = row ? Number(row.buckets_removed) : 0;
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
            backupsRemoved: backups.length, storageRemoved, bucketsRemoved, apiKeysRevoked, s3KeysRevoked,
            // Was der Abraeumer noch nicht abraeumt, steht im Eintrag selbst.
            pending: ["project_databases"],
          },
        });
      }
      return {
        projectId: due, backupsRemoved: backups.length, storageRemoved, purged,
        apiKeysRevoked, s3KeysRevoked, bucketsRemoved,
      };
    });
  }

  /**
   * Der Storage-Schritt (2.176): Was der Katalog noch kennt, verschwindet erst
   * beim Anbieter und wird dann vermerkt. Begonnene Multipart-Uploads unter
   * dem Praefix des Projekts, die der Katalog nicht kennt, bricht er ebenfalls
   * ab; nach der Frist gehoert dort keiner mehr zu einem lebenden Upload.
   */
  private async purgeStorage(projectId: string): Promise<number> {
    const storage = this.dependencies.storage;
    if (!storage) return 0;
    const { database, organizationId } = this.dependencies;
    const entries = await database.withTenant({ organizationId, actorRef: this.actorRef, readOnly: true }, async (repositories) => {
      const result = await repositories.transaction.query(
        "SELECT kind, id, provider_key, provider_upload_id FROM qkern_list_project_purge_storage($1, $2)",
        [projectId, this.batchSize],
      );
      return result.rows.map((row) => ({
        kind: String(row.kind),
        id: String(row.id),
        providerKey: String(row.provider_key),
        providerUploadId: row.provider_upload_id === null ? null : String(row.provider_upload_id),
      }));
    });
    let removed = 0;
    for (const entry of entries) {
      if (entry.providerUploadId) {
        await storage.abortMultipartUpload({ providerKey: entry.providerKey, uploadId: entry.providerUploadId });
      } else {
        await storage.deleteObject(entry.providerKey);
      }
      const forgotten = await database.withTenant({ organizationId, actorRef: this.actorRef }, async (repositories) => {
        const result = await repositories.transaction.query(
          "SELECT qkern_forget_project_purge_storage($1, $2, $3) AS forgotten",
          [projectId, entry.kind, entry.id],
        );
        return result.rows[0]?.forgotten === true;
      });
      if (forgotten) removed += 1;
    }
    for (const started of await storage.listMultipartUploads({ keyPrefix: `${organizationId}/${projectId}/` })) {
      await storage.abortMultipartUpload({ providerKey: started.providerKey, uploadId: started.uploadId });
    }
    return removed;
  }
}
