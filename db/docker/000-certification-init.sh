#!/usr/bin/env bash
set -Eeuo pipefail

# Einziger Init-Einstiegspunkt fuer den Dev-Compose (`docker-compose.yml`) und
# alle Zertifizierungs-Stacks. Der Dateiname bleibt aus historischen Gruenden,
# die Compose-Dateien verweisen darauf.
#
# Kein Stack darf `db/migrations` direkt nach `/docker-entrypoint-initdb.d`
# mounten: Ein zweites Mount in dieses read-only Verzeichnis hinein (fuer das
# Rollen-Script) scheitert auf Docker-Desktop-/WSL2-Hosts mit
# "make mountpoint: read-only file system". Stattdessen wird `db` an einen
# eigenen Pfad gemountet und ausschliesslich diese Datei liegt in
# `/docker-entrypoint-initdb.d`.
#
# Reihenfolge und Fehlerverhalten entsprechen exakt dem vorherigen Verhalten des
# offiziellen PostgreSQL-Entrypoints: alle `*.sql` lexikografisch sortiert mit
# ON_ERROR_STOP, danach die Rollenanlage.

readonly SOURCE_ROOT="/qkern/db"
readonly MIGRATIONS_DIR="${SOURCE_ROOT}/migrations"
readonly RUNTIME_LOGIN_SCRIPT="${SOURCE_ROOT}/docker/999-runtime-login.sh"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "certification-init: ${MIGRATIONS_DIR} is not mounted" >&2
  exit 1
fi

if [[ ! -f "$RUNTIME_LOGIN_SCRIPT" ]]; then
  echo "certification-init: ${RUNTIME_LOGIN_SCRIPT} is not mounted" >&2
  exit 1
fi

applied=0
for migration in "$MIGRATIONS_DIR"/*.sql; do
  [[ -f "$migration" ]] || continue
  echo "certification-init: applying $(basename "$migration")"
  psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
    --file "$migration"
  applied=$((applied + 1))
done

if [[ "$applied" -eq 0 ]]; then
  echo "certification-init: no migration was applied" >&2
  exit 1
fi

echo "certification-init: applied ${applied} migrations"

bash "$RUNTIME_LOGIN_SCRIPT"
