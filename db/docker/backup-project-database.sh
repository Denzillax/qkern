#!/usr/bin/env bash
set -Eeuo pipefail

# Zweiter Init-Schritt, ausschliesslich fuer den Backup-/Restore-Stack (2.126).
#
# `000-certification-init.sh` legt die Control Plane an und ruft am Ende
# `998-project-database.sh`; danach steht `project_database` mit
# `qkern_ledger_owner`, `qkern_project_reader` und Rechten fuer
# `qkern_project_api_app`. Dieses Script bringt zwei Dinge dazu:
#
# 1. Den Inhalt einer bereitgestellten Projektdatenbank aus `db/project`:
#    Ledger, Zaun und Aenderungs-Feed. Ohne ihn waere die Datenbank, die
#    gesichert wird, keine Projektdatenbank, sondern eine leere.
# 2. Die **zwei** Rollen, die der Backup-Weg braucht, und sie sind absichtlich
#    zwei und nicht eine:
#
#    - `qkern_project_backup` liest. `BYPASSRLS`, weil ein Backup alles sichern
#      muss und nicht die Schnittmenge der Sichtbarkeiten; `pg_read_all_data`,
#      damit es auch eine Tabelle liest, die es beim Anlegen der Rolle noch
#      nicht gab. **`NOCREATEDB`, `NOCREATEROLE`, kein Schreibrecht.** Ein
#      Backup, dessen Rolle schreiben darf, ist ein Weg, eine Projektdatenbank
#      aus dem Backup-Pfad heraus zu aendern.
#    - `qkern_project_restore_admin` legt die Zieldatenbank an und spielt den
#      Dump hinein. `CREATEDB`, und Mitglied von `qkern_ledger_owner`, weil ein
#      Dump `ALTER ... OWNER TO qkern_ledger_owner` enthaelt und das die
#      Mitgliedschaft verlangt. **NOSUPERUSER**: die Wiederherstellung soll
#      ohne Superuser gehen, sonst belegt der Fall einen Weg, den ein Betreiber
#      so nicht fahren darf.
#
#    Beide bekommen hier ein Startpasswort. Im Betrieb dreht der Vault es (die
#    statischen Rollen im Stack tun das beim Seed), und der Dienst holt es
#    ueber den Verbindungskatalog; das Passwort hier verlaesst den Stack nicht.
#
# Kein zweites Mount in `/docker-entrypoint-initdb.d`: Diese Datei liegt dort
# einzeln, `db` selbst haengt unter `/qkern/db`. Dieselbe Regel wie in
# `000-certification-init.sh` und aus demselben Grund.

readonly PROJECT_DIR="/qkern/db/project"
readonly PROJECT_DATABASE="project_database"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "backup-project-database: ${PROJECT_DIR} is not mounted" >&2
  exit 1
fi

: "${QKERN_PROJECT_MIGRATOR_DB_PASSWORD:?QKERN_PROJECT_MIGRATOR_DB_PASSWORD is required}"
: "${QKERN_PROJECT_BACKUP_DB_PASSWORD:?QKERN_PROJECT_BACKUP_DB_PASSWORD is required}"
: "${QKERN_PROJECT_RESTORE_ADMIN_DB_PASSWORD:?QKERN_PROJECT_RESTORE_ADMIN_DB_PASSWORD is required}"

# `db/project/0001` prueft die Migrationsrolle ausdruecklich: anmeldefaehig,
# unprivilegiert und **kein** Mitglied des Ledger-Eigentuemers.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 \
  --set=migrator_password="$QKERN_PROJECT_MIGRATOR_DB_PASSWORD" \
  --set=backup_password="$QKERN_PROJECT_BACKUP_DB_PASSWORD" \
  --set=restore_password="$QKERN_PROJECT_RESTORE_ADMIN_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_project_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'migrator_password';
-- INHERIT, und das ist keine Nachlaessigkeit: ohne sie wirkt `pg_read_all_data`
-- erst nach einem `SET ROLE`, und `pg_dump` setzt keine Rolle.
CREATE ROLE qkern_project_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'backup_password';
GRANT pg_read_all_data TO qkern_project_backup;
CREATE ROLE qkern_project_restore_admin LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'restore_password';
GRANT qkern_ledger_owner TO qkern_project_restore_admin;
SQL

psql --username "$POSTGRES_USER" --dbname "$PROJECT_DATABASE" --no-psqlrc --set ON_ERROR_STOP=1 <<SQL
GRANT CONNECT ON DATABASE ${PROJECT_DATABASE} TO qkern_project_migrator, qkern_project_backup, qkern_project_restore_admin;
-- Der Leser braucht USAGE auf den Schemata; pg_read_all_data bringt es
-- clusterweit mit, aber nicht fuer ein Schema, dem PUBLIC ausdruecklich
-- entzogen wurde. Darum hier noch einmal und ausdruecklich.
-- (Keine Backticks in diesem Heredoc: es ist unquoted, damit
-- ${PROJECT_DATABASE} eingesetzt wird, und eine Backtick-Folge waere dann eine
-- Kommandosubstitution. Der erste Lauf hat genau das vorgefuehrt.)
GRANT USAGE ON SCHEMA public TO qkern_project_backup;
SQL

applied=0
for migration in "$PROJECT_DIR"/*.sql; do
  [[ -f "$migration" ]] || continue
  echo "backup-project-database: applying $(basename "$migration")"
  psql \
    --username "$POSTGRES_USER" \
    --dbname "$PROJECT_DATABASE" \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$migration"
  applied=$((applied + 1))
done

if [[ "$applied" -eq 0 ]]; then
  echo "backup-project-database: no project migration was applied" >&2
  exit 1
fi

psql --username "$POSTGRES_USER" --dbname "$PROJECT_DATABASE" --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA qkern_internal TO qkern_project_backup;
SQL

# Ohne diese Rollen ist der ganze Stack fuer seinen Zweck wertlos, also werden
# sie nachgesehen statt angenommen. Besonders `BYPASSRLS`: ein Backup mit einer
# Rolle ohne es sichert die Schnittmenge der Sichtbarkeiten und sieht dabei aus
# wie ein Backup.
checked="$(psql --username "$POSTGRES_USER" --dbname "$PROJECT_DATABASE" --tuples-only --no-align \
  --command "SELECT (SELECT rolbypassrls AND rolcanlogin AND NOT rolcreatedb AND NOT rolsuper FROM pg_roles WHERE rolname = 'qkern_project_backup')
                AND (SELECT rolcreatedb AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = 'qkern_project_restore_admin')
                AND pg_has_role('qkern_project_restore_admin', 'qkern_ledger_owner', 'MEMBER')
                AND pg_has_role('qkern_project_backup', 'pg_read_all_data', 'MEMBER')
                AND to_regclass('qkern_internal.migration_ledger') IS NOT NULL")"
if [[ "$checked" != "t" ]]; then
  echo "backup-project-database: the backup roles or the project ledger are missing" >&2
  exit 1
fi

echo "backup-project-database: applied ${applied} project migrations, backup and restore roles present"
