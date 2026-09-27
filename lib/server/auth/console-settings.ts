import {
  CONSOLE_DISPLAY_DEFAULTS,
  validateConsoleDisplaySettings,
  type ConsoleDisplaySettings,
} from "@/lib/console/display-settings";
import { InvalidRecordError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlValue } from "@/lib/server/db/sql";

/**
 * Die eigene Darstellung der Console (2.55), gespeichert je Person.
 *
 * Der Ablageort ist die Anmeldegrenze, nicht die Laufzeitgrenze: Die
 * Darstellung gehoert zur Person und nicht zur Organisation, und sie muss
 * lesbar sein, bevor eine Organisation gewaehlt ist. Migration 0055 legt
 * `user_console_settings` darum neben `users` und gibt `qkern_auth` genau
 * darauf SELECT, INSERT und UPDATE -- und weiterhin kein UPDATE auf `users`.
 *
 * Keine Zeile und eine Zeile mit lauter Vorgaben bedeuten dasselbe. Wer nie
 * etwas eingestellt hat, bekommt `CONSOLE_DISPLAY_DEFAULTS`, und das ist genau
 * das Verhalten vor 2.55.
 */
export interface ConsoleDisplaySettingsRepository {
  find(userId: string): Promise<ConsoleDisplaySettings>;
  save(userId: string, settings: ConsoleDisplaySettings): Promise<ConsoleDisplaySettings>;
}

type DbRow = Record<string, unknown>;

function fromRow(row: DbRow): ConsoleDisplaySettings {
  try {
    return validateConsoleDisplaySettings({
      language: row.language,
      formatLocale: row.format_locale,
      timeZone: row.time_zone,
      startView: row.start_view,
      theme: row.theme,
    });
  } catch {
    // Eine Zeile, die das Modul nicht mehr versteht, ist ein Fehler der
    // Ablage und keine Anzeige. Sie faellt auf, statt die Console mit einem
    // halben Zustand zu rendern.
    throw new InvalidRecordError("The database returned invalid console display settings.");
  }
}

export class PostgresConsoleDisplaySettingsRepository implements ConsoleDisplaySettingsRepository {
  constructor(private readonly pool: SqlPool) {}

  async find(userId: string): Promise<ConsoleDisplaySettings> {
    try {
      const result = await this.pool.query<DbRow>(
        `SELECT language, format_locale, time_zone, start_view, theme
           FROM user_console_settings WHERE user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? fromRow(row) : { ...CONSOLE_DISPLAY_DEFAULTS };
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  async save(userId: string, settings: ConsoleDisplaySettings): Promise<ConsoleDisplaySettings> {
    const values: SqlValue[] = [
      userId, settings.language, settings.formatLocale,
      settings.timeZone, settings.startView, settings.theme,
    ];
    try {
      const result = await this.pool.query<DbRow>(
        `INSERT INTO user_console_settings
           (user_id, language, format_locale, time_zone, start_view, theme)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           language = EXCLUDED.language,
           format_locale = EXCLUDED.format_locale,
           time_zone = EXCLUDED.time_zone,
           start_view = EXCLUDED.start_view,
           theme = EXCLUDED.theme
         RETURNING language, format_locale, time_zone, start_view, theme`,
        values,
      );
      const row = result.rows[0];
      if (!row) throw new InvalidRecordError("The database stored no console display settings.");
      return fromRow(row);
    } catch (error) {
      throw mapPostgresError(error);
    }
  }
}

export class InMemoryConsoleDisplaySettingsRepository implements ConsoleDisplaySettingsRepository {
  private readonly byUser = new Map<string, ConsoleDisplaySettings>();

  async find(userId: string): Promise<ConsoleDisplaySettings> {
    return { ...(this.byUser.get(userId) ?? CONSOLE_DISPLAY_DEFAULTS) };
  }

  async save(userId: string, settings: ConsoleDisplaySettings): Promise<ConsoleDisplaySettings> {
    this.byUser.set(userId, { ...settings });
    return { ...settings };
  }
}
