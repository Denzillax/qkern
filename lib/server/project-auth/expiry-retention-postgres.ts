import { InvalidRecordError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlValue } from "@/lib/server/db/sql";
import type { ProjectAuthScope } from "@/lib/server/project-auth/model";
import type { ProjectAuthExpiryStore } from "@/lib/server/project-auth/expiry-retention";

/**
 * Der Aufraeumer an der echten Datenbank.
 *
 * **Er laeuft ueber die Auth-Verbindung**, also unter `qkern_auth`. Das ist die
 * einzige Rolle, die diese vier Tabellen ueberhaupt sieht; 0063 gibt genau ihr
 * das DELETE auf den ersten drei, 0070 auf der Assertionstabelle. Der
 * Compute-Prozess betreibt ihn zwar, aber er reicht ihm
 * dafuer die Auth-Verbindung und nicht seine eigene: Eine zweite Rolle an
 * diesen Tabellen waere eine Aenderung an der Auth-Grenze, und die verdient
 * eine eigene Entscheidung.
 *
 * ## Warum `ctid IN (SELECT ... LIMIT ...)`
 *
 * Ein `DELETE ... WHERE expires_at < $4` ohne Grenze faende beim ersten Lauf
 * gegen eine gewachsene Tabelle alles auf einmal, haette eine entsprechend
 * lange Transaktion und hielte so lange Sperren. Der Umweg ueber eine Auswahl
 * mit `LIMIT` macht aus einer langen Anweisung viele kurze.
 *
 * ## Warum kein `FOR UPDATE SKIP LOCKED`
 *
 * Es stand hier, und es musste wieder weg: PostgreSQL verlangt fuer `FOR
 * UPDATE` das **UPDATE**-Recht, und `qkern_auth` hat auf
 * `project_auth_oauth_tokens` keines. Das ist kein Versehen in 0062, sondern
 * dessen Aussage: Ein ausgegebenes Token aendert sich nicht. Der Fall (2.89)
 * hat das an der echten Datenbank gezeigt ("permission denied for table
 * project_auth_oauth_tokens"), und die Antwort darauf ist, die Sperrklausel
 * fallen zu lassen und nicht das Recht auszuweiten: Ein Aufraeumer ist kein
 * Grund, eine Tabelle schreibbar zu machen.
 *
 * Ohne die Klausel wartet eine Portion im ungluecklichen Fall kurz auf eine
 * Zeile, die jemand gerade in der Hand hat. Das ist zu verschmerzen: Ein
 * Einloesen haelt seine Zeile den Bruchteil einer Anweisung lang, und die
 * Portion ist klein. Eine Zeile, die inzwischen ein anderer geloescht oder
 * veraendert hat, faellt beim erneuten Pruefen unter der Sperre einfach aus
 * der Auswahl heraus.
 */
export class PostgresProjectAuthExpiryStore implements ProjectAuthExpiryStore {
  constructor(private readonly pool: SqlPool) {}

  /**
   * Einmal-Token aller Zwecke, einschliesslich der Passkey-Herausforderungen
   * aus 0060.
   *
   * Der Stichtag geht auf `expires_at` und nicht auf `consumed_at`: Ein
   * verbrauchtes, noch nicht abgelaufenes Token ist die Zeile, an der ein
   * zweites Einloesen auffliegt.
   */
  deleteExpiredOneTimeTokens(scope: ProjectAuthScope, expiredBefore: Date, limit: number) {
    return this.deleteBatch(
      `DELETE FROM project_auth_one_time_tokens
        WHERE ctid IN (
          SELECT ctid FROM project_auth_one_time_tokens
           WHERE organization_id = $1 AND project_id = $2 AND environment = $3
             AND expires_at < $4
           ORDER BY expires_at
           LIMIT $5
        )`,
      scope, expiredBefore, limit,
    );
  }

  /** OAuth-Token. Sie haben keinen Verbrauchsvermerk; sie gelten bis zum Ablauf. */
  deleteExpiredOAuthTokens(scope: ProjectAuthScope, expiredBefore: Date, limit: number) {
    return this.deleteBatch(
      `DELETE FROM project_auth_oauth_tokens
        WHERE ctid IN (
          SELECT ctid FROM project_auth_oauth_tokens
           WHERE organization_id = $1 AND project_id = $2 AND environment = $3
             AND expires_at < $4
           ORDER BY expires_at
           LIMIT $5
        )`,
      scope, expiredBefore, limit,
    );
  }

  /**
   * OAuth-Codes, und zwar **nur solche, an denen kein Token mehr haengt**.
   *
   * `project_auth_oauth_tokens.code_id` haengt mit ON DELETE CASCADE am Code.
   * Ein Code lebt Minuten, das Token daraus bis zu zwoelf Stunden; ohne diese
   * Bedingung risse der Aufraeumer nach seiner Frist ein Token mit, das noch
   * gilt. Die Bedingung steht hier und nicht in der Reihenfolge allein, weil
   * die Reihenfolge nur die abgelaufenen Token entfernt: Ein Code mit einem
   * frischen Token bleibt so stehen, bis auch dieses Token weg ist.
   */
  deleteExpiredOAuthCodes(scope: ProjectAuthScope, expiredBefore: Date, limit: number) {
    return this.deleteBatch(
      `DELETE FROM project_auth_oauth_codes
        WHERE ctid IN (
          SELECT code.ctid FROM project_auth_oauth_codes AS code
           WHERE code.organization_id = $1 AND code.project_id = $2 AND code.environment = $3
             AND code.expires_at < $4
             AND NOT EXISTS (
               SELECT 1 FROM project_auth_oauth_tokens AS token WHERE token.code_id = code.id
             )
           ORDER BY code.expires_at
           LIMIT $5
        )`,
      scope, expiredBefore, limit,
    );
  }

  /**
   * Gemerkte SAML-Assertions aus 0070.
   *
   * Der Stichtag geht auf `expires_at`, also auf das `NotOnOrAfter` der
   * Assertion, und ausdruecklich **nicht** auf `used_at`. Die Spalte `used_at`
   * sagt, wann diese Zeile entstanden ist; sie ist kein Verbrauchsvermerk,
   * sondern der Anfang der Aufgabe. Warum die Frist trotzdem laenger sein muss
   * als bis `expires_at`, steht am Aufraeumer: Eine Assertion gilt noch
   * `SAML_CLOCK_SKEW_MS` darueber hinaus.
   *
   * 0070 hat der Auth-Rolle das DELETE auf dieser Tabelle schon gegeben und
   * den Index `project_auth_saml_assertions_expiry_idx` mit genau der Spalten-
   * folge angelegt, die diese Auswahl braucht. Es fehlte nur der Aufruf.
   */
  deleteExpiredSamlAssertions(scope: ProjectAuthScope, expiredBefore: Date, limit: number) {
    return this.deleteBatch(
      `DELETE FROM project_auth_saml_assertions
        WHERE ctid IN (
          SELECT ctid FROM project_auth_saml_assertions
           WHERE organization_id = $1 AND project_id = $2 AND environment = $3
             AND expires_at < $4
           ORDER BY expires_at
           LIMIT $5
        )`,
      scope, expiredBefore, limit,
    );
  }

  private async deleteBatch(
    text: string, scope: ProjectAuthScope, expiredBefore: Date, limit: number,
  ): Promise<number> {
    const values: SqlValue[] = [
      scope.organizationId, scope.projectId, scope.environment, expiredBefore, limit,
    ];
    let result;
    try {
      result = await this.pool.query(text, values);
    } catch (error) {
      throw mapPostgresError(error);
    }
    // `rowCount` ist bei node-postgres fuer ein DELETE immer eine Zahl. Ist es
    // das nicht, ist die Zahl geraten, und eine geratene Zahl in einer Meldung
    // ueber geloeschte Zeilen ist schlimmer als ein Fehlschlag.
    if (typeof result.rowCount !== "number" || result.rowCount < 0) {
      throw new InvalidRecordError("The database did not report how many rows were removed.");
    }
    return result.rowCount;
  }
}
