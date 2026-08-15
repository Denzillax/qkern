# Die Lücke zu Supabase, vermessen

> Stand: `1.73.0`, 16. August 2026. Diese Datei wird bei jedem Release
> nachgeführt, das eine Zeile verändert.

„QKERN auf Supabase-Niveau in einem Rutsch" ist keine Aufgabe, sondern ein
Missverständnis über Software: Diese Sprint hat **achtmal** ein Modul gefunden,
das gebaut, dokumentiert und als Bibliothek grün war — und im Betrieb nichts
tat. Ein Rutsch erzeugt genau solche Module, nur flächendeckend. Was es
stattdessen gibt: diese Leiter. Jede Zeile nennt, was steht, was fehlt und was
der nächste belastbare Slice wäre. Abgebaut wird sie in der Reihenfolge unten —
jeder Schritt zertifiziert gegen echte Dienste, mit Mutationsprobe, zweimal
reproduziert.

**Messvorschrift:** „steht" heisst *implementiert und zertifiziert* im Sinn von
`STATUS.md` — gegen echte Dienste gelaufen, Lauf archiviert. Nichts anderes
zählt.

## Die Leiter

| Fähigkeit | Supabase | QKERN heute | Was fehlt |
| --- | --- | --- | --- |
| Postgres-Datenbank je Projekt | ja | Provisioning-Kette bis zur Bindung zertifiziert (`1.62.0`); Migrationen in echte Projektdatenbank (`1.49.0`) | ein Broker, der wirklich Datenbanken einrichtet; Betrieb (unten) |
| Auth | E-Mail, Magic Link, MFA, OAuth/OIDC, SAML, SMS, Social | E-Mail/Passwort, Magic Link, Reset, TOTP/Recovery-MFA, OIDC/PKCE, JWKS — zertifiziert gegen echtes SMTP und echtes OIDC | Social-Provider-Katalog, SAML, SMS; jede Integration braucht eine echte Gegenstelle im Stack |
| Data API | REST/PostgREST: CRUD, RPC, Views, Aggregate | CRUD mit Live-Schema, RLS, Filtern, Cursor-Pagination, OpenAPI; seit `1.71.0` lesende `security_invoker`-Views, seit `1.72.0` RPC ueber SECURITY-INVOKER-Funktionen | Aggregate, eingebettete Joins, OpenAPI fuer Views und RPC |
| Storage | Buckets, signierte URLs, Multipart/Resumable, Transforms, CDN | Buckets, Policies, Quota, signierte Grants, Virenprüfung, Lifecycle — gegen echtes MinIO/ClamAV; seit `1.70.0` Multipart/Resumable ueber den ganzen Dienstweg, Ganzdatei-Pruefsumme vom Virenscanner verifiziert | Bildtransformation, CDN |
| Realtime | Broadcast, Presence, CDC — produktiv, skaliert | Broadcast, Presence, CDC, Ordering, Replay — zertifiziert mit zwei Instanzen; Prozessnachweis (`1.57.0`) | seit `1.73.0` ersetzt ein Tor mit benannten Bedingungen das Production-Verbot; offen: belegter Production-Start gegen SSL-PostgreSQL, persistente Presence/History, Lastprofil jenseits Soak |
| Edge Functions | Deploy, Logs, Marktplatz | Functions/Cron/Webhooks als Verträge: digest-gepinnte Images, Egress-Policy, Vault-Signatur, Kette Queue→Container in einem Lauf | Image-Deployment-Fluss, Function-Logs als Produktfläche, Scope-Entdeckung statt `SCOPES_JSON` |
| Queues | pgmq, neu | Scope-Isolation, Dedupe, Leases, Fencing, Dead Letters, Multi-Instanz unter Last, arbeitender Wirt (`1.44.0`) | Metrics-Export; sonst **vor** Supabase-Stand |
| Cron | pg_cron-basiert | eigener Prozess, dispatcht zertifiziert (`1.45.0`) | Cron-Ausdrücke jenseits `*/N` und `M H * * *` |
| Usage/Billing | Preise, Rechnungen, Zahlung | alle sechs Metriken melden, Quotas mit `enforce`, Projektion in REST/Console; seit `1.67.0` append-only Preisblatt und Monatsprojektion in Geld; seit `1.68.0` fakturiert ein eigener Prozess abgeschlossene Monate idempotent | Rechnungsnummernkreis, Lesefläche, Zahlungsanbindung |
| Console/Dashboard | vollflächig | Table Editor, Change Sets, Queues, Usage, Compute-Verwaltung | SQL-Editor, Auth-/Storage-/Realtime-Flächen, Logs |
| SDK/CLI | npm, weit | typisiertes SDK, secretfreie CLI, Fresh-Smoke Linux | Registry-Publishing, Windows/macOS-Evidenz, Upgrade-E2E |
| Betrieb (Managed) | HA, PITR, Backups, Restore, Support | Nachweisverträge und Provisioning-Sicherheitsverträge | im Grunde alles: Provider-Onboarding, HA, PITR, Restore-Drills — **grösste Lücke, nicht im Docker-Stack zertifizierbar** |

## Reihenfolge des Abbaus

1. ~~Billing: Preisblatt und Monatsprojektion~~ — **erledigt in `1.67.0`.**
2. ~~Billing: Rechnungslauf als Prozess mit Periodenabschluss~~ — **erledigt in `1.68.0`.**
3. ~~Storage: Multipart/Resumable~~ — **erledigt in `1.70.0`** (Provider-Schicht `1.69.0`, Dienstweg `1.70.0`).
4. ~~Data API: Views und RPC~~ — **erledigt** (Views `1.71.0`, RPC `1.72.0`).
5. ~~Realtime: Production-Binding mit begründeter Aufhebung des Verbots~~ — **erledigt in `1.73.0`** (Tor statt Verbot; der belegte Production-Start braucht SSL-PostgreSQL und liegt bei Sprosse 10).
6. **Compute: Image-Deployment-Fluss — nächster Slice.**
7. SDK/CLI: Registry-Publishing und Multi-OS-Evidenz über CI.
8. Auth: erster Social-Provider gegen echte Gegenstelle.
9. Console: SQL-Editor (read-only beginnend).
10. Betrieb: PITR-/Restore-Drill gegen echtes WAL-Archiv — der erste Schritt,
    der eine Infrastruktur ausserhalb des Wegwerfstacks braucht.

## Was diese Datei nicht ist

Kein Versprechen und kein Fortschrittsbalken. Ein einzelner Prozentwert wurde
in `1.9` aus gutem Grund abgeschafft: Er mass Fläche statt Tiefe. Diese Leiter
misst Tiefe — Zeile für Zeile, mit Belegen in `docs/evidence/`.
