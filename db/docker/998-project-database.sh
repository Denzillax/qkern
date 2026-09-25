#!/usr/bin/env bash
set -Eeuo pipefail

# Lokale Projektdatenbank fuer den Schnellstart (2.30). Nur im Dev-Compose:
# eine zweite Datenbank im selben Cluster, ein Ledger-Owner, ein Lese-Login
# und Rechte fuer den bestehenden Data-API-Login. In Produktion legt der
# Provisionierer das auf einem eigenen Server an; die Grenzen sind dieselben.
if [[ -z "${QKERN_PROJECT_LEDGER_DB_PASSWORD:-}" || -z "${QKERN_PROJECT_READER_DB_PASSWORD:-}" ]]; then
  echo "project-database: keine Passwoerter gesetzt, lokale Projektdatenbank wird nicht angelegt"
  exit 0
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set=ledger_password="$QKERN_PROJECT_LEDGER_DB_PASSWORD" \
  --set=reader_password="$QKERN_PROJECT_READER_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_ledger_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'ledger_password';
CREATE ROLE qkern_project_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'reader_password';
CREATE DATABASE project_database OWNER qkern_ledger_owner;
SQL

psql --username "$POSTGRES_USER" --dbname project_database --set ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO qkern_ledger_owner;
GRANT USAGE ON SCHEMA public TO qkern_project_reader, qkern_project_api_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT SELECT ON TABLES TO qkern_project_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qkern_project_api_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO qkern_project_api_app;
ALTER ROLE qkern_project_reader SET statement_timeout = '10s';
ALTER ROLE qkern_project_api_app IN DATABASE project_database SET statement_timeout = '10s';
SQL
echo "project-database: project_database mit qkern_ledger_owner, qkern_project_reader und qkern_project_api_app angelegt"
