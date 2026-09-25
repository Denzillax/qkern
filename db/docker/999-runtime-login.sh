#!/usr/bin/env bash
set -Eeuo pipefail

: "${QKERN_RUNTIME_DB_PASSWORD:?QKERN_RUNTIME_DB_PASSWORD is required}"
: "${QKERN_AUTH_DB_PASSWORD:?QKERN_AUTH_DB_PASSWORD is required}"
: "${QKERN_WORKER_DB_PASSWORD:?QKERN_WORKER_DB_PASSWORD is required}"
: "${QKERN_PROVISIONER_DB_PASSWORD:?QKERN_PROVISIONER_DB_PASSWORD is required}"
: "${QKERN_PROJECT_API_DB_PASSWORD:?QKERN_PROJECT_API_DB_PASSWORD is required}"

runtime_role_exists="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = 'qkern_app'")"
if [[ "$runtime_role_exists" != "1" ]]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=runtime_password="$QKERN_RUNTIME_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'runtime_password';
SQL
else
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=runtime_password="$QKERN_RUNTIME_DB_PASSWORD" <<'SQL'
ALTER ROLE qkern_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'runtime_password';
SQL
fi

worker_role_exists="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = 'qkern_worker_app'")"
if [[ "$worker_role_exists" != "1" ]]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=worker_password="$QKERN_WORKER_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_worker_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'worker_password';
SQL
else
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=worker_password="$QKERN_WORKER_DB_PASSWORD" <<'SQL'
ALTER ROLE qkern_worker_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'worker_password';
SQL
fi

auth_role_exists="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = 'qkern_auth_app'")"
if [[ "$auth_role_exists" != "1" ]]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=auth_password="$QKERN_AUTH_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_auth_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'auth_password';
SQL
else
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=auth_password="$QKERN_AUTH_DB_PASSWORD" <<'SQL'
ALTER ROLE qkern_auth_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'auth_password';
SQL
fi

provisioner_role_exists="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = 'qkern_provisioner_app'")"
if [[ "$provisioner_role_exists" != "1" ]]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=provisioner_password="$QKERN_PROVISIONER_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_provisioner_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'provisioner_password';
SQL
else
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=provisioner_password="$QKERN_PROVISIONER_DB_PASSWORD" <<'SQL'
ALTER ROLE qkern_provisioner_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD :'provisioner_password';
SQL
fi

project_api_role_exists="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = 'qkern_project_api_app'")"
if [[ "$project_api_role_exists" != "1" ]]; then
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=project_api_password="$QKERN_PROJECT_API_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_project_api_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'project_api_password';
SQL
else
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=project_api_password="$QKERN_PROJECT_API_DB_PASSWORD" <<'SQL'
ALTER ROLE qkern_project_api_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'project_api_password';
SQL
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
GRANT qkern_runtime TO qkern_app;
GRANT qkern_auth TO qkern_auth_app;
GRANT qkern_worker TO qkern_worker_app;
GRANT qkern_provisioner TO qkern_provisioner_app;
REVOKE qkern_auth FROM qkern_app;
REVOKE qkern_worker FROM qkern_app;
REVOKE qkern_provisioner FROM qkern_app;
REVOKE qkern_runtime FROM qkern_auth_app;
REVOKE qkern_worker FROM qkern_auth_app;
REVOKE qkern_provisioner FROM qkern_auth_app;
REVOKE qkern_runtime, qkern_auth, qkern_provisioner FROM qkern_worker_app;
REVOKE qkern_runtime, qkern_auth, qkern_worker FROM qkern_provisioner_app;
REVOKE qkern_runtime, qkern_auth, qkern_worker, qkern_provisioner FROM qkern_project_api_app;
ALTER ROLE qkern_app SET statement_timeout = '15s';
ALTER ROLE qkern_app SET lock_timeout = '3s';
ALTER ROLE qkern_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE qkern_auth_app SET statement_timeout = '10s';
ALTER ROLE qkern_auth_app SET lock_timeout = '3s';
ALTER ROLE qkern_auth_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE qkern_worker_app SET statement_timeout = '20s';
ALTER ROLE qkern_worker_app SET lock_timeout = '3s';
ALTER ROLE qkern_worker_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE qkern_provisioner_app SET statement_timeout = '20s';
ALTER ROLE qkern_provisioner_app SET lock_timeout = '3s';
ALTER ROLE qkern_provisioner_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE qkern_project_api_app SET statement_timeout = '10s';
ALTER ROLE qkern_project_api_app SET lock_timeout = '1s';
ALTER ROLE qkern_project_api_app SET idle_in_transaction_session_timeout = '15s';
SQL

bash /qkern/db/docker/998-project-database.sh
