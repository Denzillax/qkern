# Die Lücke zu Supabase, vermessen

> Stand: `2.66.0`, 29. September 2026. Diese Datei wird bei jedem Release
> nachgeführt, das eine Zeile verändert. Zwischen `1.91.0` und `2.64.0` ist
> das nicht geschehen; die Leiter stand 73 Releases lang auf dem Stand vom
> 24. September. Was in dieser Zeit dazugekommen ist, steht jetzt hier, und
> `docs/QA.md` nennt den Ausfall.

„QKERN auf Supabase-Niveau in einem Rutsch" ist keine Aufgabe, sondern ein
Missverständnis über Software: Ein Sprint hat **achtmal** ein Modul gefunden,
das gebaut, dokumentiert und als Bibliothek grün war, und im Betrieb nichts
tat. Ein Rutsch erzeugt genau solche Module, nur flächendeckend. Was es
stattdessen gibt: diese Leiter. Jede Zeile nennt, was steht, was fehlt und was
der nächste belastbare Slice wäre. Jeder Schritt zertifiziert gegen echte
Dienste, mit Mutationsprobe, zweimal reproduziert.

**Messvorschrift:** „steht" heisst *implementiert und zertifiziert* im Sinn von
`STATUS.md`: gegen echte Dienste gelaufen, Lauf archiviert. Nichts anderes
zählt. Ein Wert in Prozent steht hier absichtlich nicht; er misst Fläche
statt Tiefe.

## Die Leiter

| Fähigkeit | Supabase | QKERN heute | Was fehlt |
| --- | --- | --- | --- |
| Postgres-Datenbank je Projekt | ja | Provisioning-Kette bis zur Bindung zertifiziert (`1.62.0`); Migrationen in echte Projektdatenbank (`1.49.0`); Einstellungen, Rollen und TLS-Zustand lesbar (`2.53.0`); Replikation mit Publikationen, Abonnements und Slot-Rückstand lesbar (`2.58.0`); drei feste Umgebungen mit echten Zahlen (`2.60.0`) | ein Broker, der wirklich Datenbanken einrichtet (die Provisioniererrolle hat `NOCREATEDB`, im Produktquelltext steht kein `CREATE DATABASE`); freie Zweige; Wiederherstellung in ein neues Projekt (drei von vier Gliedern fehlen, `2.62.0`) |
| Auth | E-Mail, Magic Link, MFA, OAuth/OIDC, SAML, SMS, Social, Passkeys, Hooks | E-Mail/Passwort, Magic Link, Reset, TOTP/Recovery-MFA, OIDC/PKCE gegen zwei getrennte Gegenstellen, JWKS; Sitzungen sehen und beenden (`2.34.0`); Audit-Kette in Zeitreihenfolge (`2.35.0`, `2.36.0`); MFA-Erzwingung mit Einrichtungsschein (`2.50.0`); Rate Limits in der Datenbank (`2.52.0`); Leckliste lokal (`2.53.0`); Auth-Hooks, die geschlossen fallen (`2.59.0`); Passkeys mit WebAuthn ohne fremde Bibliothek (`2.60.0`); fremde Aussteller an der Data API (`2.60.0`); eigener OAuth-Server mit PKCE (`2.61.0`) und Zustimmung als Zeile (`2.64.0`); Zustimmungen nach Nutzer geordnet mit Widerruf je Token (`2.65.0`); Aufräumer für abgelaufene Artefakte (`2.63.0`) | SAML, SMS, kommerzielle Provider mit echten Konten; eine Seite, auf der ein Nutzer seine **eigenen** Erlaubnisse sieht |
| Data API | REST/PostgREST: CRUD, RPC, Views, Aggregate, eingebettete Joins; GraphQL | CRUD mit Live-Schema, RLS, Filtern, Cursor-Pagination, OpenAPI; `security_invoker`-Views (`1.71.0`), RPC (`1.72.0`), Aggregate unter RLS (`1.86.0`); der ganze Katalog lesbar: Trigger, Funktionen, Indizes, Policies, Enums, Erweiterungen, Rollen, Publikationen, Spaltenrechte (`2.9.0` bis `2.20.0`); Namen mit Grossbuchstaben (`2.26.0`, `2.33.0`); GraphQL lesend mit harten Grenzen, ohne fremde Bibliothek (`2.61.0`); ein OpenAPI-Vertrag über Pfade und Verben in beide Richtungen (`2.59.0`); eingebettete Joins über Fremdschlüssel, eine Ebene tief, unter der RLS beider Tabellen (`2.66.0`); GraphQL schreibend über denselben Schreibweg wie REST, alle Mutationen einer Anfrage in einer Transaktion, Ändern und Löschen nur mit Bedingung (`2.67.0`) | Joins tiefer als eine Ebene und über Schemagrenzen; GraphQL-Upsert und Beziehungen in Mutationen |
| Storage | Buckets, signierte URLs, Multipart/Resumable, Transforms, CDN, S3-Protokoll, Analytics- und Vektor-Buckets | Buckets, Policies, Quota, signierte Grants, Virenprüfung, Lifecycle gegen versitygw/ClamAV; Multipart/Resumable (`1.70.0`); Regeln und Grenzen je Bucket (`2.27.0`); Scanner-Log (`2.49.0`); S3-Schlüsselpaare, genau einmal gezeigt und widerrufbar (`2.59.0`); S3-Endpunkt `/s3` mit SigV4 für ListBuckets, ListObjectsV2, Head/Get/Put/DeleteObject durch denselben Dienst (`2.66.0`); Presigned URLs, aws-chunked, Range, CopyObject, DeleteObjects (`2.67.0`) | Bildtransformation, CDN; am S3-Endpunkt fehlen Multipart und ListObjects v1, mit 501 benannt (Presigned URLs, Range, CopyObject, DeleteObjects und aws-chunked seit `2.67.0`); kein Vektortyp im Stack-Image, die Seite dazu sagt es aus dem Katalog (`2.65.0`); Analytics-Buckets (Iceberg): kein Katalog, keine Engine, die Seite sagt es (`2.67.0`), kein Platzhalter mehr in der Console |
| Realtime | Broadcast, Presence, CDC, produktiv, skaliert | Broadcast, Presence, CDC, Ordering, Replay, zertifiziert mit zwei Instanzen; Tor mit benannten Bedingungen statt Production-Verbot (`1.73.0`); Grenzen und Rechtematrix in der Console (`2.47.0`); Berichte und Log (`2.49.0`, `2.62.0`) | belegter Production-Start gegen SSL-PostgreSQL; persistente Presence und History; Lastprofil jenseits Soak; das Log kennt nur Broadcasts, nicht die zugestellten Änderungen |
| Edge Functions | Deploy, Logs, Marktplatz | Functions/Cron/Webhooks als Verträge: digest-gepinnte Images, Egress-Policy, Vault-Signatur, Kette Queue→Container in einem Lauf; Image-Deployments mit Historie und Rollback (`1.74.0`); Aufrufprotokoll je Function (`1.89.0`); Secrets nur als Referenz (`2.38.0`); Datenbank-Webhooks über den Change Feed als eigener Prozess (`2.50.0`, `2.51.0`); Dashboard-Webhooks über dieselbe Kette (`2.58.0`); Inhaltslogs je Aufruf mit Grenzen, ohne Streichen, weil der Prozess keinen Geheimniswert kennt (`2.67.0`, Migration 0069) | Scope-Entdeckung statt `SCOPES_JSON`; Zustellung ist at-least-once; Inhaltslogs erreichen keinen Log-Drain |
| Queues | pgmq, neu | Scope-Isolation, Dedupe, Leases, Fencing, Dead Letters, Multi-Instanz unter Last, arbeitender Wirt (`1.44.0`); Metrics im Prometheus-Textformat (`1.88.0`); Console (`2.6.0`) | **vor** Supabase-Stand; offen nur Tracing |
| Cron | pg_cron-basiert | eigener Prozess, dispatcht zertifiziert (`1.45.0`); die ganze Fünf-Feld-Grammatik (`1.87.0`); Log mit vier Zuständen und benanntem Dedupe-Schlüssel (`2.42.0`); Namen (JAN, MON), die `@`-Kürzel, eine IANA-Zeitzone je Zeitplan mit geprüftem Sommerzeitwechsel sowie `L`, `W` und `#` (`2.66.0`) | pg_cron selbst kennt `L`/`W`/`#` nicht; QKERN hat hier mehr |
| Usage/Billing | Preise, Rechnungen, Zahlung | alle sechs Metriken melden; Preisblatt und Monatsprojektion (`1.67.0`); Rechnungslauf als Prozess (`1.68.0`) mit lückenlosem Nummernkreis (`1.81.0`); Console liest Rechnungen (`1.82.0`, `2.37.0`); Verlauf über 48 Stunden oder 90 Tage, aggregiert in der Datenbank (`2.45.0`) | Zahlungsanbindung; Add-ons (eine Rechnungszeile hat kein Feld für eine Bezeichnung, `2.62.0`) |
| Observability | Logs je Dienst, Explorer, Query Performance, Advisors, Berichte | Advisors Sicherheit, Leistung, Gesundheit (`2.39.0`, `2.40.0`, `2.44.0`); Berichte für Datenbank, Verbindungen, Auth, Realtime (`2.45.0` bis `2.49.0`); Log-Explorer über die drei Quellen mit Leseroute (`2.55.0`); Log-Drains als Prozess mit dauerhafter Position (`2.54.0`, `2.55.0`); `pg_stat_statements` ohne Abfragetext (`2.56.0`); Postgres-Zustand aus den Statistiksichten (`2.57.0`); Function-Inhaltslogs als vierte Quelle des Explorers (`2.67.0`) | ein Serverlog von PostgreSQL; API-Gateway- und Pooler-Zahlen (die Seiten sagen ehrlich, dass es keine gibt, `2.61.0`) |
| Console/Dashboard | vollflächig, im Browser | das Menü von Supabase (`2.0.0`) in vier Sprachen (`2.3.0`); Darstellung je Person in der Datenbank (`2.55.0`); von 26 Platzhaltern sind 2 übrig (`2.37.0` bis `2.62.0`); Table Editor schreibend über Change Sets (`2.48.0`); read-only SQL-Editor mit Vorlagen (`1.75.0`, `2.54.0`); Render-Vertrag für jede Ansicht in vier Sprachen (`2.63.0`), erreicht seit `2.64.0` alle Ansichten und fährt seit `2.65.0` auch `ready` und `error` | **im Browser nie gesehen**, in keinem Release; eine Tabelle mit echten Zeilen sieht der Vertrag nicht; ein Platzhalter |
| Remote-MCP | MCP-Server mit OAuth | Remote-MCP über OAuth, vier Werkzeuge nach Bereichen, zwölf gar nicht angemeldet (`2.64.0`); statischer Bearer nur lokal | Werkzeuge für Control Plane, Storage, Queues und Migrationen haben keinen Bereich, der sie beschreibt |
| SDK/CLI | npm, weit | typisiertes SDK, secretfreie CLI; Fresh-Smoke auf Linux, Windows und macOS auf GitHub-Runnern (`2.15.0`); Tarball-Prüfung auf allen drei (`2.14.0`, `2.15.0`) | Registry-Publishing; Upgrade-E2E |
| Betrieb (Managed) | HA, PITR, Backups, Restore, Support | Backup und Restore gegen TLS-PostgreSQL mit WAL-Archiv, bis zu einem Zeitpunkt, Evidenz vom Produkt-Verifier geprüft (`2.29.0`); PITR-Seite mit Drill-Evidenz (`2.53.0`, `2.63.0`) | **im Grunde alles**: Der Drill stellt die Kontrollebene wieder her, nicht eine Projektdatenbank; QKERN kann kein Backup einer Projektdatenbank anstossen und führt keinen Katalog seiner Backups; Provider-Onboarding, HA, Support. **Grösste Lücke, nicht im Docker-Stack zertifizierbar.** |

## Reihenfolge des Abbaus

Erledigt seit `1.67.0`: Preisblatt und Projektion, Rechnungslauf,
Multipart/Resumable, Views und RPC, Realtime-Tor, Image-Deployments, erster
Social-Provider, SQL-Editor, Multi-OS-Evidenz über CI (`2.15.0`), Backup und
Restore lokal (`2.29.0`), 24 von 26 Platzhaltern, der Render-Vertrag, der
OAuth-Server mit Zustimmung und der MCP-Riegel.

Was auf dieser Maschine noch geht, in dieser Reihenfolge:

1. ~~Console: die Zustände nach dem Laden prüfen~~ **erledigt in `2.65.0`**
   (`ready` und `error` in vier Sprachen, ohne neue Abhängigkeit).
2. ~~Auth: Zustimmungsseite und Widerruf je Token~~ **erledigt in `2.65.0`**;
   die Seite gehört dem Betreiber, nicht dem Nutzer.
3. ~~Storage: Vektor-Buckets~~ **erledigt in `2.65.0`** als ehrliche Seite:
   kein `pgvector` im Stack-Image.
4. ~~Data API: eingebettete Joins~~ **erledigt in `2.66.0`**: `select=*,autor:autoren(name)`
   über genau einen Fremdschlüssel, lesend, mit benannten Grenzen.
5. ~~Storage: ein S3-Endpunkt~~ **erledigt in `2.66.0`**: `/s3` prüft SigV4
   gegen die Paare aus `2.59.0`, das Geheimnis liegt verschlüsselt, und die
   Seite nennt jede Operation, die fehlt.
6. ~~Cron: Namen, `@daily`, Zeitzonen~~ **erledigt in `2.66.0`**, dazu
   `L`, `W` und `#`.
7. ~~Storage: Analytics-Buckets~~ **erledigt in `2.67.0`** als ehrliche Seite
   wie die Vektoren: kein Katalog, keine Engine, Multipart am S3-Endpunkt
   fehlt; das Urteil über den Server kommt aus dem Katalog. Kein Platzhalter
   mehr in der Console.
8. **Auth: SAML.** SMS braucht einen echten Anbieter und liegt dahinter.

Was Infrastruktur ausserhalb dieser Maschine braucht, und an dem der
Abbau hier endet:

- ein Broker, der wirklich Datenbanken einrichtet, gegen einen echten
  Anbieter;
- ein Backup einer Projektdatenbank und ein Restore-Drill dagegen;
- der Production-Start von Realtime gegen SSL-PostgreSQL;
- Registry-Publishing des SDK;
- kommerzielle Auth-Provider mit echten Konten;
- CDN und Bildtransformation;
- Zahlungsanbindung.

## Was diese Datei nicht ist

Kein Versprechen und kein Fortschrittsbalken. Ein einzelner Prozentwert wurde
in `1.9` aus gutem Grund abgeschafft: Er mass Fläche statt Tiefe. Diese Leiter
misst Tiefe, Zeile für Zeile, mit Belegen in `docs/evidence/`.
