# QKERN 1.2 Alpha 1 — Generated Data API

1.2 Alpha 1 liefert den ersten belastbaren Tabellen-API-Slice. Der Release ist
weiterhin Product Preview und behauptet weder vollständige Supabase-Parität noch
Managed-Production-Reife.

## Neu

- Live-schema-gebundene REST-Operationen für List, Insert, Update und Delete
- Erlaubte `select`-Spalten, bis zu zehn parametrisierte Filter, Sortierung und
  opake Cursor-Pagination bis maximal 100 Zeilen
- Update und Delete ausschließlich mit dem exakten realen Primärschlüssel
- RLS als zwingende Freigabebedingung; Tabellenowner ohne `FORCE ROW LEVEL
  SECURITY`, Rollenmitgliedschaften, Superuser und `BYPASSRLS` werden abgewiesen
- Separater unprivilegierter Projekt-API-Login für CRUD; die bestehende Lese-
  Data-Plane bleibt davon getrennt
- Serverseitig gesetzte `authenticated`, `anon` oder `service_role` Claims; keine
  Caller-gelieferten freien Claims
- Ablaufende Public-/Service-Projekt-Keys, Secret nur einmal ausgegeben, SHA-256-
  Verifier statt Raw-Key, irreversible Sperrung und Audit Events
- Dynamische OpenAPI-3.1-Dokumente aus dem realen freigegebenen Projektschema
- Console Table Editor und API-Key-Verwaltung ohne Beispieldaten
- MCP-Tools für Tabellen-List/Insert/Update/Delete mit Read-/Destructive-
  Annotationen und derselben Generated-API-Grenze
- Migration `0023_project_api_keys.sql` und optionaler echter PostgreSQL-17-
  RLS-/CRUD-/SQLi-Zertifizierungstest

## Sicherheitssemantik

Spalten werden aus PostgreSQL-Metadaten erlaubt, Bezeichner streng geprüft und
alle Datenwerte als Parameter gebunden. Spaltennamen mit Secret-/Token-/Passwort-
Mustern werden weder gelesen noch zurückgegeben oder mutiert. Jede Operation läuft
mit festen Statement-, Lock-, Transaktions-, Zeilen-, Spalten-, Payload- und
Antwortgrößenlimits.

`public` setzt den Datenbank-Claim `anon`, `service` setzt `service_role`. Beide
verwenden denselben unprivilegierten API-Login und bleiben in diesem Alpha RLS-
pflichtig. Ein Service-Key ist daher kein versteckter `BYPASSRLS`-Schlüssel.

## Noch offen

Stufe 1.3 ergänzt echte Projekt-App-User, Passwort/Magic-Link/OAuth/OIDC/MFA,
signierte JWT/JWKS, Rotation und Revocation. Erst dann können verifizierte
Endnutzer-Claims statt des statischen Key-Subjekts in Projekt-RLS-Policies fließen.
Storage, Realtime, Functions/Jobs/Queues/Webhooks, SDK/CLI, Usage/Billing und
zertifizierte Managed Operations bleiben weitere Roadmap-Stufen.
