#!/usr/bin/env bash
set -Eeuo pipefail

# Lokale Projektdatenbank fuer den Schnellstart (2.30). Nur im Dev-Compose:
# eine zweite Datenbank im selben Cluster, ein Ledger-Owner, ein Lese-Login
# und Rechte fuer den bestehenden Data-API-Login. Der Ledger-Owner kann sich
# wie in Produktion nicht anmelden; der Schnellstart legt Tabellen als `qkern`
# mit `SET ROLE qkern_ledger_owner` an.
if [[ -z "${QKERN_PROJECT_READER_DB_PASSWORD:-}" ]]; then
  echo "project-database: kein Passwort gesetzt, lokale Projektdatenbank wird nicht angelegt"
  exit 0
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 \
  --set=reader_password="$QKERN_PROJECT_READER_DB_PASSWORD" <<'SQL'
CREATE ROLE qkern_ledger_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE qkern_project_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD :'reader_password';
CREATE DATABASE project_database OWNER qkern_ledger_owner;
SQL

psql --username "$POSTGRES_USER" --dbname project_database --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON DATABASE project_database FROM PUBLIC;
GRANT CONNECT ON DATABASE project_database TO qkern_project_reader, qkern_project_api_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO qkern_ledger_owner;
GRANT USAGE ON SCHEMA public TO qkern_project_reader, qkern_project_api_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT SELECT ON TABLES TO qkern_project_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qkern_project_api_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qkern_ledger_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO qkern_project_api_app;
ALTER ROLE qkern_project_reader IN DATABASE project_database SET statement_timeout = '10s';
ALTER ROLE qkern_project_reader IN DATABASE project_database SET lock_timeout = '3s';
ALTER ROLE qkern_project_reader IN DATABASE project_database SET idle_in_transaction_session_timeout = '30s';
SQL
echo "project-database: project_database mit qkern_ledger_owner, qkern_project_reader und qkern_project_api_app angelegt"
