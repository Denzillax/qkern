#!/usr/bin/env bash
set -Eeuo pipefail

# Zweiter Init-Schritt, ausschliesslich fuer den Realtime-Production-Stack.
#
# `000-certification-init.sh` legt die Control Plane an und ruft am Ende
# `998-project-database.sh`; danach steht `project_database` mit
# `qkern_ledger_owner`, `qkern_project_reader` und Rechten fuer
# `qkern_project_api_app`. Was dort noch fehlt, ist der Inhalt einer
# bereitgestellten Projektdatenbank: Ledger, Zaun und der Aenderungs-Feed aus
# `db/project`. Ohne ihn gibt es keinen Change Feed, und der Stack koennte den
# Weg unter Production nicht belegen.
#
# Kein zweites Mount in `/docker-entrypoint-initdb.d`: Diese Datei liegt dort
# einzeln, `db` selbst haengt unter `/qkern/db`. Dieselbe Regel wie in
# `000-certification-init.sh` und aus demselben Grund.

readonly PROJECT_DIR="/qkern/db/project"
readonly PROJECT_DATABASE="project_database"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "realtime-project-database: ${PROJECT_DIR} is not mounted" >&2
  exit 1
fi

: "${QKERN_PROJECT_MIGRATOR_DB_PASSWORD:?QKERN_PROJECT_MIGRATOR_DB_PASSWORD is required}"

# `db/project/0001` prueft die Migrationsrolle ausdruecklich: anmeldefaehig,
# unprivilegiert und **kein** Mitglied des Ledger-Eigentuemers. Genau so wird
# sie hier angelegt, damit die Pruefung etwas zu pruefen hat.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 \
  --set=migrator_password="$QKERN_PROJECT_MIGRATOR_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_project_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'migrator_password';
SQL

psql --username "$POSTGRES_USER" --dbname "$PROJECT_DATABASE" --no-psqlrc --set ON_ERROR_STOP=1 <<SQL
GRANT CONNECT ON DATABASE ${PROJECT_DATABASE} TO qkern_project_migrator;
SQL

applied=0
for migration in "$PROJECT_DIR"/*.sql; do
  [[ -f "$migration" ]] || continue
  echo "realtime-project-database: applying $(basename "$migration")"
  psql \
    --username "$POSTGRES_USER" \
    --dbname "$PROJECT_DATABASE" \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$migration"
  applied=$((applied + 1))
done

if [[ "$applied" -eq 0 ]]; then
  echo "realtime-project-database: no project migration was applied" >&2
  exit 1
fi

# Ohne Feed ist der ganze Stack fuer diesen Zweck wertlos, also wird er
# nachgesehen statt angenommen.
present="$(psql --username "$POSTGRES_USER" --dbname "$PROJECT_DATABASE" --tuples-only --no-align \
  --command "SELECT to_regclass('qkern_internal.change_feed') IS NOT NULL")"
if [[ "$present" != "t" ]]; then
  echo "realtime-project-database: qkern_internal.change_feed is missing" >&2
  exit 1
fi

echo "realtime-project-database: applied ${applied} project migrations, change feed present"
