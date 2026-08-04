# Sicherheitsmodell

## Unverhandelbare Grenzen

- Jede geschützte Anfrage bindet Actor, Organisation, Projekt und Umgebung. Unpassende IDs liefern 404 ohne Existenz-Leak.
- Neue Tabellen und Buckets sind private/default-deny. Öffentliche Bucket-Reads
  benötigen eine ausdrückliche Owner-/Administrator-Konfiguration und Auditspur;
  öffentliche Writes existieren nicht. Production-Migrationen, Drops, Restores,
  Secret-Änderungen und Rechteerhöhungen folgen ihren Approval-/Signaturgrenzen.
- MCP-Tools besitzen kleine Zod-Schemas, feste Result-Limits und explizite Annotationen. Es gibt kein universelles Shell-Tool und kein uneingeschränktes SQL.
- Agenten sehen `configured`, `managed` oder eine Secret-Referenz, niemals den Wert. Redaction geschieht vor Persistenz und vor Ausgabe.
- Datenbankwerte, Logs, Dateien, Webhooks, externe APIs und Supporttexte sind untrusted data — keine Instruktionen.

## Threats und Kontrollen

| Risiko | Primäre Kontrolle |
| --- | --- |
| IDOR/Cross-Tenant | Serverautorisation + tenantbezogene Query + RLS + negative Tests |
| Prompt Injection | Daten-/Instruktionstrennung, feste Tools, Scopes, Approval Gates |
| Secret Exfiltration | Inline-Credentials abweisen, öffentliche Statements redigieren, keine Secret-Read-API; Production-Projektpasswörter nur kurzlebig im Vault-Pool-Speicher |
| Approval Replay/TOCTOU | Action Hash, TTL, Einmaligkeit, atomare Transaktion |
| Apply-Queue Replay/Race | Expliziter Apply nach Approval, Tenant-Transaktion, Advisory Lock, Unique Constraints und idempotente Antwort |
| Staler/konkurrierender Worker | `FOR UPDATE SKIP LOCKED`, Worker-ID, zufälliges Lease-Token, Ablaufprüfung und gefencte Terminal-Updates |
| Überprivilegierter Worker | Dedizierte, startgeprüfte `qkern_worker`-DB-Grenze ohne Auth-/Web-Runtime-Mitgliedschaft; nur spaltenbezogene Queue-/Outbox-Übergänge |
| Unbekanntes Commit-Ergebnis | Gefencter Übergang in persistentes `reconciliation_required`; eigener Attempt-Zähler, ausschließlich read-only Ledger-Prüfung und auditiertes `review_required` statt blindem SQL-Retry |
| Missbrauch der Operator-Recovery | Owner-/Administrator-Capability, feste Reason-Codes, referenzbasiertes Command ohne SQL, Worker-Validierung, höchstens drei Review-Zyklen und vollständiges Audit |
| Verdeckter oder falsch gelöster Migration-Incident | Worker-only-Erzeugung, unveränderliche Evidenz, Support read-only, feste Quittierung, höchstens drei referenzbasierte Resolution-Commands und `resolved` ausschließlich nach Worker-bestätigtem Target-Ledger-Treffer |
| Verlorene/manipulierte Incident-Benachrichtigung | Incident und referenzbasiertes Outbox-Event atomar; Web-Runtime ohne Rechte; Worker-Role, RLS, SKIP LOCKED, zufälliges Lease-Token, Ablauf-Fencing, exaktes Event-ID-Ack und idempotenter Consumer-Vertrag |
| Veraltetes, ursachenfremdes oder per ABA wiederholtes Delivery-Recovery | Erwarteter Fehlercode und erwartete Retry-Generation plus kompatibler fester Grund, atomare Trigger-Bindung an den Dead-Letter-Snapshot und erneute Worker-Prüfung vor Zustandsänderung |
| Manipulierte Zielverbindung | Server-owned Exact-Match-Katalog für opaque Referenzen, Vault-Static-Role, erwartete Rolle/Datenbank/Ledger-Owner, Hostnamen-/CA-Prüfung, SHA-256-Leaf-Pin und kein URL-Fallback |
| Outbox-Doppelzustellung | At-least-once-Sink, Event-ID-Acknowledgement und gefenctes `markPublished`; Consumer muss Event-ID idempotent behandeln |
| Webhook-SSRF, Redirect, Signing-Key-Ausfall oder manipuliertes Ack | Exakte Host-Allowlist, Production-HTTPS auf Port 443, keine Credentials/Query/Fragmente, keine lokalen/literalen Ziele, `redirect: error`, pro Zustellung validierte Key-ID/Secret-Paare, begrenzte Antwort und exakte Event-ID |
| Öffentliche oder optimistische Worker-Health | Probe standardmäßig aus, fester Loopback-Host, feste secretfreie Antworten, Ready erst nach aktuellem erfolgreichem Poll; Fehler, Veraltung, Clock-Rollback und Shutdown schließen den Zustand |
| Privilegierte oder driftende Background-Deployments | Exakter v0.28-Bundle mit digest-gepinntem Image, Non-root/read-only/seccomp, Drop ALL, tokenlosen ServiceAccounts, getrennten Host-Namespaces, Einzel-Secret-Referenzen und ohne Service/Ingress; jede Abweichung scheitert geschlossen |
| Production-Apply durch Web-/MCP-Bypass, Queue-Injektion oder Fehlkonfiguration | Disabled-by-default Ed25519-Release-Autorisierung für genau Tenant/Projekt/Change Set/Approval/Ziel-/Statement-/Action-Bindung; Prüfung im gemeinsamen Enqueue-Service und erneut unmittelbar vor dem Worker-Executor; fünf unabhängige Evidenz-Pins und vierstündiges Fenster |
| SQL Injection | Parser/AST, parametrisierte Queries, DB-Rollen, Timeouts |
| Generated-API-SQLi oder Mass-Update | Live-Schema-/Spalten-Allowlist, Identifier-Grammatik, ausschließlich parametrisierte Werte, exakter Primärschlüssel für Update/Delete und feste Limits |
| RLS-Bypass über Tabellenowner oder Service-Key | RLS-Pflicht, Owner-Deny ohne FORCE RLS, eigener Login ohne Rollenmitgliedschaft/BYPASSRLS; `service_role` ist nur ein Claim und keine privilegierte DB-Rolle |
| Projekt-Key-Diebstahl, Replay oder Cross-Scope-Nutzung | 256-Bit-Key, nur SHA-256-Verifier, Ablauf, irreversible Sperrung, exakte Projekt-/Environment-Bindung, Secret nur einmal sichtbar und Audit Events |
| App-JWT-Cross-Project-/Environment-Replay | Exakte Issuer-/Audience-/Scope-Claims, passender Projekt-Key als zweite Bindung und serverseitige Session-/User-Prüfung |
| Refresh-Token-Diebstahl oder Replay | Opaque verifier-only Token, atomare Einmalrotation, Parent-/Familienbindung und vollständiger Familienwiderruf bei Replay |
| E-Mail-/Magic-/Reset-Token-Leak | Kurze TTL, nur Hash-Verifier, atomarer Einmalverbrauch, enumeration-safe Anforderung und Production-Delivery außerhalb der Response |
| MFA-Secret-/Recovery-Code-Diebstahl | AES-256-GCM für TOTP, HMAC-Verifier für Recovery Codes, AAL2-Session und einmalige Nutzung |
| OIDC-Code-, State-, Nonce- oder Provider-Manipulation | Authorization Code + PKCE, verschlüsselter State, exakte Nonce/Issuer/Audience, serverseitige Endpunkte, no-redirect, HTTPS und begrenzte Antworten |
| Project-Auth-Delivery-Ausfall oder Debug-Leak | Disabled-by-default Delivery, cause-freier Fehler, Debug-Tokens nur nach Entwicklungsflag und technischer Production-Deny |
| Storage-Cross-Tenant-/Policy-Bypass | Servergeprüfter Key/JWT-Principal, exakter Tenant-/Projekt-/Environment-Scope, Control-Plane-RLS, feste Policy-Enums und Owner-Filter bereits im Repository |
| Quota-Überbuchung oder verwaiste Reservierung | Bucket-Row-Lock, `used + reserved <= quota`, Ablaufbereinigung, verifier-gebundene Completion und Freigabe bei Cancel/Malware/Delete |
| Expiry-/Completion-Race oder verwaistes Provider-Object | Upload- und Bucket-Lock-Reihenfolge, idempotenter Existing-Object-Pfad; verliert der Commit gegen Expiry/Conflict, wird das Provider-Object best-effort gelöscht und jede noch pendente Reservation storniert |
| Doppeltes Delete/Lifecycle-Accounting | Object-Row-Lock, `deleted_at` als monotone Grenze und Usage-Freigabe nur beim ersten Übergang; konkurrierende Provider-Deletes müssen idempotent sein |
| Manipulierter Upload oder Content-Type-Smuggling | Signed POST bindet Key/MIME/SHA-256 und begrenzt Multipart; Provider-HEAD muss Bytezahl, normalisiertes MIME und Checksum vor Commit exakt bestätigen |
| Malware-Download | Default-Quarantäne, kein Download vor `clean`, Scanner-Urteil nicht requeststeuerbar, `infected` löscht Provider-Object und gibt Quota frei |
| Scanner-Bypass, TOCTOU oder ClamAV-Ausfall | Interner kurzlebiger GET, `redirect: error`, exakte Content-Length/MIME-Prüfung, beim Streamen neu berechnete Bytezahl und SHA-256, begrenztes clamd-`INSTREAM`; Fehler, Timeout, Drift oder unbekannte Antwort bleiben `pending` |
| Öffentliche ClamAV-Angriffsfläche | clamd-TCP ist nicht authentifiziert und bleibt in privatem Netz; der Zertifizierungsstack publiziert keinen Port, Development bindet ausschließlich Loopback, Production benötigt einen injizierten Scanner plus Egress-/Network-Policy |
| Storage-SSRF/Credential-Leak | Production-HTTPS-Origin, Path-Style-Key-Grammatik, no-redirect/Timeout, injizierte rotierende Credentials; öffentliche Antworten ohne Provider-Key oder Verifier |
| Realtime Cross-Tenant-/Cross-Project-Leak | serverseitig aus Project Key gebundener vollständiger Scope, scope-isolierter Channel-Key und negative Isolationstests |
| WebSocket-Credential-Leak oder CSWSH | keine Query-Credentials, Auth ausschließlich im ersten Frame, exakte Origin-Allowlist und Subprotocol, generische credential-freie Fehler |
| Manipulierter/fremder Realtime-Cursor | HMAC-SHA-256 über Organisation, Projekt, Environment, Channel und Sequenz mit konstantzeitiger Signaturprüfung |
| Realtime-Ordering-/Replay-Lücke | gemeinsame Channel-Serialisierung für Replay und Live; Stale/Overflow scheitert geschlossen und verlangt Full-Resync |
| Presence-Identitätsleck | HMAC-abgeleiteter Presence-Key statt User-/Connection-ID, begrenzter State und kein Presence-Recht für `anon`/`service_role` |
| Realtime-DoS/Slow Consumer | Connection-/Frame-/Rate-/Subscription-/JSON-/History-/Replay-Limits, Auth-Timeout, Heartbeat und Sendepuffer-Backpressure |
| SSRF | URL-Allowlist, DNS-/Redirect-Revalidierung, private Netzbereiche blockieren |
| Destruktive Migration | Diff, Lock-/Cost-Analyse, Dry Run, Approval, Backup, Rollback-Plan |
| Audit Manipulation | Append-only, Hash-Kette/WORM, getrennte Retention und Zugriffsrolle |

`lib/security.ts` parst SQL in einen AST, erzwingt genau ein Statement und blockiert mutierende CTEs, `SELECT INTO`, Inline-Credentials, Transaktions-/Rollensteuerung, das reservierte `qkern_internal`-Schema sowie ausgewählte missbrauchbare PostgreSQL-Funktionen. Der persistente Control-Plane-Pfad nutzt getrennte Auth-, Web-Runtime- und Worker-Logins, erzwungene RLS, zusammengesetzte Tenant-FKs, Statement-/Lock-Timeouts und tenantgebundene Transaktionen. Die lokale/E2E-Worker-Runtime wird nur nach explizitem Enablement und mit einem injizierten Zielverbindungskatalog aktiviert; der normale Web-/MCP-Prozess führt kein Projekt-SQL aus.

Die Generated Data API ist eine getrennte, standardmäßig deaktivierte Grenze. Sie
akzeptiert kein SQL und ermittelt Tabellen, Spalten, Rechte und Primärschlüssel aus
dem realen PostgreSQL-Katalog. Nur normale/partitionierte Tabellen mit aktivierter
RLS und einem unprivilegierten, nicht besitzenden API-Login werden freigegeben.
Bezeichner müssen der festen Identifier-Grammatik entsprechen; Datenwerte laufen
ausnahmslos als Treiberparameter. Update/Delete benötigen genau alle realen
Primärschlüsselspalten. Sensitive-Name-Spalten sind für Select, Filter, Sortierung
und Mutationen gesperrt. Claims werden ausschließlich aus Console-Session oder
persistierter Projekt-Key-Bindung erzeugt und per transaktionslokalem
`set_config` gesetzt; Caller-Header können keine freien Claims injizieren.

Projekt-Key-Secrets werden mit 256 Bit Zufall erzeugt und nie persistiert. Die
Control Plane speichert nur den base64url-codierten SHA-256-Verifier, Prefix,
Scope, Ablauf und Widerrufszeitpunkt. Eine schmale `SECURITY DEFINER`-Funktion
liefert der Auth-Rolle nur aktive Scope-Metadaten und niemals Verifier, Prefix,
Name oder Ersteller. Verwaltung läuft tenantgebunden unter RLS; Revocation ist
monoton. Public und Service unterscheiden den RLS-Claim, aber kein Key erhält
`BYPASSRLS` oder eine privilegierte Datenbankrolle.

Project Auth trennt App-User strukturell von QKERN-Control-Plane-Accounts. Jeder
Datensatz bindet Organisation, Projekt und Environment; ein Datenbanktrigger macht
diesen Scope unveränderlich. Password Hashes verwenden einen separaten Argon2id-
Pepper. Access-JWTs sind Ed25519-signiert, kurzlebig und exakt an Issuer, Audience,
Projekt, Environment, User, Session und Assurance gebunden. Die Verifikation prüft
zusätzlich den aktuellen User-/Sessionzustand, sodass Logout und Sperrung nicht erst
am JWT-Ablauf wirken. JWKS enthält keine privaten Schlüssel.

Refresh-, Verify-, Magic-Link- und Reset-Secrets werden nie roh persistiert. Refresh
rotiert atomar; ein erkanntes Alt-Token kompromittiert die gesamte Familie. E-Mail-
Anforderungen geben unabhängig vom Accountbestand denselben Erfolg zurück. Nur das
explizite Entwicklungsflag kann den Delivery-Token in einer Antwort zeigen, und
Production lehnt diese Konfiguration beim Start ab. Der Standard-Production-Pfad
bleibt ohne injizierten Delivery-Adapter geschlossen.

OIDC akzeptiert keine Provider- oder Endpoint-URLs aus Requests. Authorization-,
Token- und JWKS-Endpunkt sind serverseitig exakt konfiguriert, HTTPS-only, no-
redirect und durch Timeout-/Antwortgrenzen eingeschränkt. PKCE, State, Nonce,
Signaturalgorithmus, Issuer, Audience und verifizierte E-Mail werden gemeinsam
geprüft. TOTP-/Flow-Secrets sind AES-256-GCM-verschlüsselt; Recovery Codes liegen
nur als HMAC-Verifier vor und werden einmalig konsumiert.

Bei der Generated Data API reicht ein App-JWT allein nicht: derselbe Request muss
einen gültigen Projekt-Key in `X-QKERN-Key` tragen. Nur daraus und aus dem
verifizierten JWT/Session-Datensatz erzeugt QKERN transaktionslokale RLS-Claims.
Caller-definierte JWT-Claim-Header besitzen keinen Autoritätspfad.

Approval-Artefakte binden Organisation, Projekt, Umgebung, Change-Set-ID, Statement-Hash, unveränderliche Datenbank-Instanzreferenz, Requester, Risiko, Ablauf und Scope. AES-GCM authentifiziert Change-Set-ID und Statement-Hash zusätzlich; vor einer Entscheidung werden Approval und Change Set gemeinsam gesperrt und der entschlüsselte Klartext erneut gehasht. Eine Datenbank-Transition auf `approved` oder `rejected` verlangt den passenden Decision-Datensatz in derselben Transaktion; INSERT-Rechte lassen den Status nur über den Default `pending` entstehen. Die provisionierte Projekt-Datenbankreferenz ist unveränderlich und wird zusätzlich in den Job kopiert. `migration_jobs.approval_request_id` bindet mit einem zusammengesetzten Tenant-/Projekt-/Environment-/Change-Set-Fremdschlüssel genau den beim Enqueue geprüften Approval Request; ein späterer Request kann den Worker-Snapshot nicht ersetzen. Vor 0.4 erzeugte targetlose Approval-Hashes werden dadurch invalidiert. Das öffentliche DTO enthält weder das rohe Statement noch einen daraus rekonstruierten Diff.

Apply ist eine zweite, explizite Aktion nach der Approval. Die API autorisiert die `apply`-Capability und legt nur einen tenantgebundenen Queue-Auftrag an; SQL wird nicht im Request ausgeführt. Der PostgreSQL-Pfad schreibt Job, referenzbasiertes Outbox-Event und Audit in derselben Tenant-Transaktion. Je ein Unique Constraint pro Organisation/Change Set beziehungsweise Job/Event sowie ein Transaktions-Lock verhindern doppelte Aufträge. Queue und Outbox enthalten weder SQL-Ciphertext noch Projekt-Datenbank-Credentials.

Production Apply benötigt seit v0.30 zusätzlich eine externe Ed25519-Release-Autorisierung. Sie gilt für genau eine Kombination aus Organisation, Projekt, Change Set, Approval, Hash der opaque Datenbankreferenz, Statement-Hash und Approval-Action-Hash. Release-Artefakt, Backup-/Restore-Evidenz, Live-Deployment-Evidenz, Provider-E2E und Security Assessment sind als fünf paarweise verschiedene serverseitige SHA-256-Pins gebunden; alle elf festen positiven Assertions müssen signiert sein. Autorisierung und Public Key werden getrennt, no-follow und in Production ohne group-/world-writable Bits gelesen. Inline-Werte und Authority-Pfad-Reuse sind verboten. Maximale Gültigkeit und maximales Alter betragen vier Stunden. API/MCP prüfen vor dem Enqueue; der Worker prüft denselben Claim nach Artefaktprüfung unmittelbar vor dem Executor. Fehlt Autorität, wird ausschließlich `PRODUCTION_APPLY_BLOCKED` persistiert beziehungsweise ausgegeben und kein SQL ausgeführt. Development/Staging bleiben unberührt; Memory Mode blockiert Production immer.

Vor einer möglichen Ausführung prüft die Worker-Domäne Approval-Status und -Ablauf, Action Hash, Tenant-/Projekt-/Environment-Bindung, Lease-Inhaber/-Token/-Ablauf, Attempt-Grenzen, opaque Datenbankreferenz, entschlüsselten Statement-Hash und Single-Statement-SQL erneut. Ein Heartbeat erneuert das Lease während Zielausführung und Ledger-Reconciliation. Stale Leases können keine Terminalzustände schreiben. Automatische SQL-Retries erfolgen nur nach einem vom Executor sicher bestätigten vollständigen Rollback.

Unbekannte Ausführungsergebnisse werden mit Job-ID, Worker-ID, Lease-Token und noch gültigem Lease dauerhaft in eine `reconciliation_required`-Spur verschoben. Deren Claims verwenden einen vom SQL-Attempt getrennten, datenbankseitig begrenzten Zähler und dürfen ausschließlich das Ziel-Ledger lesen; selbst ein leerer Ledger-Eintrag kann in diesem Pfad niemals `execute()` auslösen. Nach drei erfolglosen Reconciliation-Claims oder einem auf der Grenze abgelaufenen Crash-Lease wechselt der Job in `review_required`. Das Change Set wird dabei nicht als failed markiert. Das Status-DTO liefert nur feste Fehlercodes und Zähler, während jeder Übergang redigiert auditiert wird. `completion_deferred` bleibt nur für den Fall, dass das Control-Plane-Update selbst nicht sicher persistiert werden kann. Auch eine inzwischen abgelaufene Approval darf ausschließlich einen bereits vorhandenen Commit bestätigen, niemals ein fehlendes Statement nachträglich ausführen.

Die Operator-Recovery erweitert ausschließlich diese read-only Ledger-Prüfung. Nur Owner und Administratoren besitzen die Capability; Deployer und Support sind ausgeschlossen. Die API akzeptiert nur feste Reason-Codes und schreibt ein tenantgebundenes, referenzbasiertes Command ohne SQL, Credentials oder Freitext. Die Web-Runtime besitzt weiterhin kein UPDATE-Recht auf Jobs. Der Worker validiert Zustand und Cycle-Limit erneut, konsumiert pro Job höchstens ein pendentes Command und startet maximal drei zusätzliche Review-Zyklen. Es existiert bewusst keine API zum manuellen Setzen von `applied` oder `failed` und keine Recovery-Anweisung, die `execute()` aufrufen könnte.

Sind alle drei Review-Zyklen ausgeschöpft, kann ausschließlich `qkern_worker` einen Incident aus dem unverändert quarantinierten Job ableiten. Unique Constraint, erzwungene RLS und Worker-only-INSERT ergeben genau einen Fall pro Tenant/Job. Der Datensatz enthält kein SQL, keine Datenbankreferenz, keine Credentials, keine Rohdiagnose und keinen Freitext. Die Runtime darf nur den festen Quittierungsübergang anfordern; ein Trigger leitet Actor und Zeitpunkt selbst aus dem serverseitigen Transaktionskontext ab und schützt die Evidenzfelder. Owner und Administratoren dürfen quittieren, Support nur lesen. `acknowledged` bedeutet ausschließlich, dass die Untersuchung übernommen wurde.

Die technische Auflösung ist ein davon getrennter, begrenzter Zustandsautomat. Owner und Administratoren dürfen ausschließlich `target_ledger_recheck` anfordern; Support, Deployer und die Web-Runtime besitzen keine Job- oder Incident-Resolution-Rechte. Ein actor- und tenantgebundener Command kann höchstens drei SQL-freie Reconciliation-Zyklen öffnen. Der Worker verifiziert weiterhin die exakte Change-Set-ID und den Statement-Hash im ownergeschützten Target-Ledger; `execute()` besitzt in diesem Pfad keinen Aufrufslot. Nur bei `already_applied` setzt er zuerst Job und Change Set auf `applied` und danach in derselben Control-Plane-Transaktion den Incident mit dem festen Code `target_ledger_match` auf `resolved`. Der Datenbank-Trigger verlangt Worker-Rollenmitgliedschaft und den bereits angewendeten, nicht mehr reconciliation-pflichtigen Job. Ein fehlender Ledger-Eintrag kehrt nach der begrenzten Prüfung zu `review_required` zurück; eine Operator-Aussage kann keinen Abschluss erzeugen. Command-first-Sperrreihenfolge verhindert Lock-Zyklen mit parallelem Worker-Verbrauch.

Incident und `migration.incident.opened`-Event werden in derselben Worker-/Tenant-Transaktion geschrieben; bestehende v0.9-Incidents werden beim Upgrade idempotent nachgezogen. Die Incident-Outbox enthält nur die Incident-ID. Erst der Worker-Claim verbindet sie mit festen Incident-Referenzen; Acknowledgement-Actor, Rohdiagnosen, Datenbankreferenz, SQL und Credentials besitzen im Message-Typ keinen Slot. Die Web-Runtime hat keine Tabellenrechte. Der Publisher prüft UUIDs, Eventtyp, Severity, Incidenttyp, Tenant- und Lease-Felder erneut und akzeptiert ausschliesslich ein Ack mit identischer Event-ID. Stale Publish-/Release-/Failure-Versuche scheitern am Lease-Fence. Nur ein bestätigter Publish-/Ack-Fehler erhöht den getrennten persistenten Failure-Zähler; Abbruch oder Lease-Verlust tun dies nicht. Beim achten Fehler wird das Event atomar `dead_lettered`, Lease und automatische Wiederholung enden. Die Zustellung ist at-least-once; der externe Consumer muss die Event-ID idempotent verarbeiten.

Recovery ist ein eigener referenzbasierter Command-Zustandsautomat. Nur Owner und Administratoren besitzen die Capability und müssen neben einem von drei festen Reason-Codes den zuletzt gelesenen `expectedFailureCode` und `expectedRetryCycle` übermitteln; Support und Deployer sind ausgeschlossen. Ein `SECURITY DEFINER`-Trigger bindet den Actor aus dem Tenant-Transaktionskontext, vergleicht Code und Generation atomar mit dem aktuellen Dead-Letter-Snapshot und erzwingt die Ursachenkompatibilität: `SIGNING_KEY_UNAVAILABLE` erlaubt nur `credentials_rotated`, `DESTINATION_REJECTED` alle drei Gründe und die übrigen Fehler nur `destination_recovered` oder `provider_incident_resolved`. Nur `qkern_worker` verarbeitet ein pendentes Command und prüft denselben Snapshot unmittelbar vor dem gefencten Zustandsübergang erneut; ein inzwischen geänderter Snapshot wird abgewiesen. Damit bleibt auch ein altes Command wirkungslos, wenn derselbe Fehlercode nach einem zwischenzeitlichen Recovery-Zyklus erneut auftritt. Exakte Wiederholungen mit identischem Grund, Code und Generation sind idempotent; abweichende pendente Commands scheitern fail-closed. Die Route publiziert nicht und kann weder Incident, Job, Change Set, Target-Ledger noch SQL verändern. Persistiert werden keine Providerantworten oder Rohfehler, sondern ausschließlich `PUBLISH_FAILED`, `INVALID_ACK`, `SIGNING_KEY_UNAVAILABLE`, `DELIVERY_TIMEOUT` oder `DESTINATION_REJECTED`.

Die Delivery-Sicht verwendet schmale `SECURITY DEFINER`-Funktionen statt Tabellenrechten. v0.13 stellt nur die aggregate Fünf-Minuten-SLO-Sicht bereit; v0.14 ergänzt eine auf 100 bereits autorisierte Incident-IDs begrenzte Detailprojektion und erweitert die Aggregation. v0.16 fügt disjunkte aktive Fehlerursachen hinzu; v0.17 bindet Recovery-Commands an genau diesen beobachteten Ursachen-Snapshot; v0.19 ergänzt die Retry-Generation als ABA-sichere zweite Bindung. Bereits publizierte Events werden nicht als aktiv fehlerhaft gezählt. Alle Projektionen filtern ausschließlich mit der serverseitigen Tenant-Einstellung. `qkern_runtime` erhält nur `EXECUTE`, nicht `SELECT` auf Outbox oder Commands. Service und OpenAPI erlauben keine Lease-Owner/-Token, Actoren, Providerantworten, URLs, SQL oder Credentials. Ursache-Summen müssen exakt dem aktiven Failure-Count entsprechen; inkonsistente Summen werden nicht als Health ausgegeben, sondern fail-closed abgewiesen. Erfolgreiche Antworten sind `private, no-store`.

Der Incident-Webhook signiert `<unix-seconds>.<raw-json-body>` mit HMAC-SHA-256 und sendet Signatur, Key-ID, Timestamp und Event-ID in getrennten Headers. Der aktive `IncidentWebhookSigningKeyProvider` wird für jede Zustellung innerhalb desselben Abbruch-/Timeoutfensters neu aufgelöst; so bleiben `X-QKERN-Signature-Key-ID` und Signatur atomar, während ein Vault-Adapter Schlüssel rotieren kann. Provider-Ausfall, ungültige Key-ID, zu kurzes/zu langes Secret und gemischte Environment-/Provider-Autorität scheitern vor dem Netzwerkzugriff mit stabilen redigierten Fehlern. Der Secret-Wert besitzt keinen Message- oder Log-Slot. Production akzeptiert nur einen öffentlichen exakten DNS-Namen über HTTPS/443; URL-Credentials, Query, Fragment, Wildcards, IP-Literale, lokale Suffixe und Redirects werden fail-closed abgewiesen. Status, Content-Type, maximale Ack-Größe und das exakt zweifeldrige Ack werden geprüft. Der Receiver muss Key-ID und Signatur gegen ein kontrolliertes Überlappungsfenster prüfen, einen engen Timestamp erzwingen, Replay verhindern und die Event-ID idempotent behandeln. DNS-Rebinding-Schutz, ausgehende Firewall/Proxy-Allowlist, Zertifikatskontrolle sowie die konkrete Vault-/KMS-Anbindung bleiben Teil der Deployment-Grenze.

Jeder Claim erhöht die monotone, vom Attempt-Zähler getrennte `claim_sequence`. Der Executor persistiert diese Generation zusammen mit Job-ID, Lease-Token und Statement-Hash als ownergeschütztes Target-Fence, bevor er die Statement-Transaktion öffnet, und bestätigt dasselbe Fence darin erneut. Eine ältere Generation kann eine höhere nicht ersetzen. Auf einem zurückeroberten Claim sind Rollback-/Not-started-Retries nur erlaubt, wenn der Executor das aktuelle Fence dauerhaft als `confirmed` ausgewiesen hat; unbekannte oder überschriebene Fences wechseln in die persistente Reconciliation-Spur beziehungsweise enden als lease-lost. Struktur, Owner und ACLs des Fence werden ebenso fail-closed geprüft wie das Ledger. Diese Schutzlogik ist in 0.20 implementiert und in isolierten Tests abgedeckt; ein Real-PostgreSQL-Harness für den Incident-Recovery-/Resolution-Teil ist ausführbar, während die vollständigen Worker-/Target-Crash-Races weiterhin separat zertifiziert werden müssen. Rohfehler werden nicht persistiert, sondern in feste, redigierte Fehlercodes und Meldungen überführt.

Das Target-Fence entzieht einer bereits laufenden Zieltransaktion ihre Ausführungsberechtigung nicht rückwirkend. Reclaimt die Control Plane während dieser Transaktion, blockiert ein neuer Worker am Target-Advisory-Lock und liest nach dessen Freigabe zuerst das Ledger; der alte Versuch kann zuvor noch committen. Vollständige Stale-Worker-Cancellation erfordert eine widerrufbare Ausführungsberechtigung oder kontrollierte Query-Cancellation. Diese Fähigkeit und ein Real-PostgreSQL-Interleavingstest bleiben ausdrückliche Production-Gates.

Nur die dedizierte DB-Grenze `qkern_worker` darf geleaste Jobs und Outbox-Ereignisse fortschreiben. Der Web-Login kann enqueueen, besitzt aber keine UPDATE-Rechte auf diese Zustandsautomaten. Die Worker-Pool-Prüfung verlangt die Worker-Mitgliedschaft, verbietet Auth-/Runtime-Mitgliedschaften sowie privilegierte Rollenattribute und bekannte gefährliche Systemrollen. Das reduziert einen kompromittierten Webprozess auf das Erzeugen autorisierter Aufträge; er kann weder einen Job eigenmächtig als applied markieren noch Outbox-Ereignisse als veröffentlicht ausgeben.

Der lokale MCP-Aufruf `qkern_migration_apply_queue` ist mit `readOnlyHint: false` und `destructiveHint: true` als destruktiver Write gekennzeichnet. Der MCP-Client muss dafür vor jedem Aufruf eine ausdrückliche Nutzerbestätigung einholen; die empfohlene Codex-Konfiguration verwendet `default_tools_approval_mode = "writes"`. Die Annotation ersetzt nicht die serverseitige Approval- und Tenant-Prüfung.

`PostgresProjectDatabaseExecutor` ist als begrenzter, transaktionaler Executor implementiert. Er akzeptiert nur opaque Instanzreferenzen über einen injizierten Resolver und bindet exakten Datenbanknamen, `session_user`, `current_user` und erwarteten Login. Superuser-, `BYPASSRLS`-, `CREATEDB`-, `CREATEROLE`-, `REPLICATION`- und alle unerwarteten Rollenmitgliedschaften werden abgewiesen. Das unter einem exakt gebundenen separaten Non-Login-Owner vorprovisionierte Ledger muss persistent sein und exakt die geprüften Spalten, Primary Key, Hash-Constraint, ACLs und Owner-Grenzen besitzen. Die Migration-Rolle darf dort nur `SELECT` und `INSERT` sowie Schema-`USAGE` erhalten; Owner-/Schema-Create-/DDL-/Update-/Delete-/Trigger-Rechte, fremde Grantees, User-Trigger, Rewrite Rules oder RLS führen fail-closed zum Abbruch. Change-Set-ID und SHA-256 werden zusammen atomar geführt, wodurch Wiederholung idempotent bleibt, ohne getrennte Change Sets mit identischem SQL zu verschmelzen. Fehler werden nur nach erfolgreichem Rollback und ausschließlich für eine enge PostgreSQL-Code-Allowlist als retrybar klassifiziert; bei unklarem Commit wird die Verbindung verworfen und nicht automatisch wiederholt.

`TrustedProjectDatabaseConnectionCatalog` und `VaultProjectDatabaseConnectionCatalog` implementieren den Resolver als serverseitige Exact-Match-Allowlist. Beide akzeptieren nur bounded opaque `managed:*`-Referenzen und besitzen keinen request- oder URL-basierten Fallback. Der Raw-URL-Adapter verlangt ein lokales/E2E-Opt-in und verweigert Production. Dort enthält die Environment-Bindung ausschließlich Vault-Rollenname, Zieladresse, erwartete Rollen-/Datenbankgrenzen und Zertifikatspin. Das Vault-Token kommt pro Refresh aus einer privaten regulären Agent-Sink-Datei; world-accessible Modes, Tokenwerte in der Umgebung und gemischte lokale/Vault-Autorität werden abgewiesen. Vault-Zugriff nutzt eine exakte HTTPS-Mount-URL, keine Redirects, begrenzte Antwortgröße und ein gemeinsames Timeout. Status, JSON, stabiler Benutzername, Passwortgröße und TTL werden validiert. Alle Fehler sind feste cause-freie Klassen ohne Endpoint, Token, Passwort, Response-Body oder Treiberdetails.

Credential-Rotation ist an die Pool-Lebensdauer gebunden. Gleichzeitige erste Zugriffe und Refreshes werden koalesziert. Vor der TTL-Sicherheitsgrenze wird fail-closed neu aufgelöst; bei identischem Passwort bleibt der Pool bestehen, bei Änderung wird eine neue Generation atomar aktiv. Ein aktiver Client erhöht vorher einen Generationszähler, sodass der alte Pool erst nach dessen `release` geschlossen wird. Fehlgeschlagene überfällige Refreshes dürfen keine neue Verbindung auf alten Credentials öffnen. Die Ziel-TLS-Verbindung verlangt normale CA-/Hostnamenprüfung und zusätzlich den provisionierten SHA-256-Leaf-Pin. Ein geplanter Zertifikatwechsel muss deshalb zuerst als kontrollierte Provisioner-Bindungsänderung ausgerollt werden.

Der unabhängig vom Worker aktivierbare Apply-Outbox-Publisher sendet referenzbasierte Nachrichten at-least-once, verlangt ein passendes Event-ID-Acknowledgement und markiert erst danach gefenct als published. Diese Semantik verhindert falsche Bestätigungen, garantiert aber keine Exactly-once-Zustellung; der Broker-Consumer muss die Event-ID idempotent behandeln. Der gebündelte `SignedApplyBrokerSink` signiert den exakten Body mit HMAC-SHA-256, löst Key-ID und Secret für jede Zustellung atomar auf, verbietet Production-Inline-Secrets, Redirects und nicht erlaubte Ziele und begrenzt Key-Auflösung, Transport und Ack. In Production wird die rotierbare Schlüsseldatei nur als private reguläre Datei akzeptiert; ein injizierter Vault-/KMS-Provider kann dieselbe enge Schnittstelle implementieren.

Apply-Zustellfehler werden ausschließlich als `PUBLISH_FAILED`, `INVALID_ACK`, `SIGNING_KEY_UNAVAILABLE`, `DELIVERY_TIMEOUT` oder `DESTINATION_REJECTED` persistiert. Acht gefencte Fehler erzeugen ein Dead Letter. Owner und Administratoren dürfen höchstens drei weitere Zyklen über einen referenzbasierten Command öffnen, der atomar an Actor, Tenant, kompatiblen Grund, Fehlercode und Retry-Generation gebunden wird. Die Request-Route sendet nichts und führt kein SQL aus. Status und Aggregate enthalten keine Lease-, Actor-, Broker-, Provider- oder Credential-Felder; die Web-Runtime besitzt keine direkte Apply-Outbox-Sicht.

0.23 schließt die interne Projekt-Datenbank-Provisioning-Lücke: Der Web-Login verliert direkte Projekt-/Environment-Updates, ein vierter überschneidungsfrei geprüfter Login besitzt nur Provisioning-Job-, Binding- und redigierte Audit-Rechte, und Lease-Token plus Ablauf fencen jede Zustandsmutation. Der Brokervertrag ist reference-only, HMAC-signiert, idempotent an die Job-ID gebunden und attestiert exakt den gepinnten Bootstrap-Hash. QKERN speichert weder Provider-Credentials noch Projekt-Datenbank-Passwörter; das unveränderliche Binding enthält nur opaque Referenz, Vault-Rolle, Ziel-/Rollenbindung und Zertifikatspin. Der Migration Worker liest es tenantgebunden und erhält Credentials weiterhin ausschließlich aus Vault. Das ist noch keine Production-Freigabe: Provider-Onboarding, Live-Vault-/Agent-/Rotationstests, kontrollierter Zertifikat-Rollover, Broker-/Pager-ACLs, externe SLO-Alarme und Real-PostgreSQL-/Target-Races müssen gegen echte Services nachgewiesen und archiviert werden.

0.24 ergänzt messbare Provisioner-Liveness ohne neue Secret- oder Identitätssicht. Jeder Poll schreibt zuerst einen Heartbeat; schlägt dieser persistente Write fehl, wird kein Job geclaimt. RLS bindet `organization_id` und `provisioner_id` an die serverseitige Tenant- beziehungsweise Actor-Einstellung, und die Rolle besitzt weder fremde Heartbeat-SELECT-Rechte noch allgemeine UPDATE-Rechte. Die Web-Runtime erhält nur `EXECUTE` auf eine aggregate `SECURITY DEFINER`-Funktion. Deren Rückgabe enthält keine Organisation, Projekte, Environments, Jobs, Provisioner-IDs, Lease-Owner/-Token, Hosts, Ports, Vault-Rollen, Bindings oder Credentials. Feste Fehlercode-Summen müssen exakt dem aktiven Fehlercount entsprechen; Zustands- und Liveness-Summen werden ebenfalls fail-closed geprüft. Der Health-Endpunkt ersetzt keine externe Alarmzustellung oder Live-Zertifizierung.

0.25 trennt den Maschinenzugriff auf dieselben Aggregate von Browser-Sessions. Der OpenMetrics-Endpunkt ist disabled-by-default und nur im PostgreSQL-Modus aktivierbar. Tenant und System-Actor stammen aus serverseitigen Konstanten; Cookie, Membership und Request-Tenant-Header haben keinen Autoritätspfad. Der Bearer kommt ausschließlich aus einer eigenen absoluten Token-Datei, die Production mit No-follow, regulärem Dateityp, Mode `0600`, enger Länge und ASCII-Allowlist prüft. Sie wird pro Request neu gelesen, nach dem Digestvergleich nullgesetzt und darf keinen Vault-/Broker-/Webhook-Pfad wiederverwenden. Fehlerantworten enthalten weder Pfad noch Tokenursache. Alle Metriknamen und Labels sind fest im Code definiert; kundenspezifische IDs, Zieladressen und Secret-Metadaten besitzen keinen Slot.

0.26 trennt Backup-/Restore-Ausführung und Evidenzautorität vollständig von QKERN. Der externe Drill-Runner besitzt den Ed25519-Private-Key; QKERN akzeptiert nur einen streng typisierten Nachweis und eine separat gelieferte Public-Key-Datei. Der rohe 32-Byte-Key ist zusätzlich per serverseitigem SHA-256 gepinnt. Beide Dateien werden mit `O_NOFOLLOW`, Dateityp-/Größenprüfung und in Production ohne group-/world-writable Bits gelesen; Inline-Evidenz, Inline-Key und Authority-Pfad-Wiederverwendung sind verboten. Signaturprüfung, feste Production-/Control-Plane-Bindung, geordnete UTC-Zeitpunkte, exakt abgeleitete RPO-/RTO-Sekunden, Frische, Manifestgleichheit sowie fünf positive Prüfassertionen müssen gemeinsam bestehen. Die maschinenlesbare Ausgabe projiziert weder Signatur, Digests, Key-ID, Dateipfade noch Providerdetails. Ist die optionale Metrics-Integration aktiviert, macht ungültige oder veraltete Evidenz den Scrape `503`; sie kann niemals einen Apply freigeben.

0.27 fügt keine öffentliche Health- oder Autoritätsschnittstelle hinzu. Der optionale Probe-Listener bindet technisch fest an `127.0.0.1`; ein abweichender konfigurierter Host und privilegierte Ports scheitern beim Start. Er akzeptiert nur `GET`/`HEAD` auf zwei exakten Pfaden, setzt `no-store`, begrenzt Header, Verbindungen und Timeouts und projiziert weder Prozess-/Worker-ID noch Zeitpunkte, Tenant, Queue, Job, Ziel, Fehlerursache oder Secret. Readiness ist nach Start zunächst falsch, wird nur durch einen aktuellen erfolgreichen Poll gesetzt und durch technischen Poll-Fehler, Veraltung, Clock-Rollback oder Shutdown zurückgenommen. Observer-Ausfälle sind isoliert und dürfen keinen Queue-, Provisioning-, Migration- oder Publish-Ausgang verändern. Weil Loopback keine eigenständige Authentisierung ersetzt, darf der Port nur über eine In-Container-Exec-Probe verwendet und nie als Service oder Ingress veröffentlicht werden.

0.28 bindet den Orchestrator-Vertrag an einen deterministischen Pre-Deployment-Bundle. Tags, Placeholder-Digests, Shell-Entrypoints, zusätzliche Container/Replicas/Ressourcen, HostPath, Host-Network/PID/IPC, privilegierte Ausführung, schreibbares Root-Dateisystem, Linux-Capabilities, Service-Account-Tokens, breite `envFrom`-Autorität, Inline-Secrets, Services und Ingress besitzen keinen akzeptierten Slot. File-Authorities werden read-only mit Mode `0400` projiziert; andere Secrets stammen aus einzelnen `secretKeyRef`s. Die Verifikationsdatei ist absolut, no-follow, auf 1 MiB begrenzt und in Production nicht group-/world-writable. Doppelte JSON-Schlüssel und jede Soll-Abweichung liefern nur einen festen Fehler. Das Gate prüft keinen Live-Cluster: Default-deny/Egress-NetworkPolicy, Registry-Signatur/SBOM, Secret-Store, Scheduling und Runtime-E2E bleiben verpflichtende externe Kontrollen.

0.29 akzeptiert den Live-Nachweis dieser Kontrollen nur über eine zweite, strikt getrennte Ed25519-Grenze. QKERN besitzt keinen privaten Signierschlüssel, keine Kubeconfig und keine Cluster-API-Autorität. Evidenz und Public Key kommen aus verschiedenen absoluten No-follow-Dateien; Production verweigert group-/world-writable Dateien, Inline-Werte und jede Wiederverwendung von Deployment-, Backup-, Metrics-, Vault-, Broker- oder Webhook-Authority-Pfaden. Der rohe Public Key, die Cluster-Identität, der geprüfte NetworkPolicy-Satz und die Image-Provenance sind unabhängig per SHA-256 gepinnt; die vier Pins müssen voneinander verschieden sein. Signatur, Key-ID, kanonischer vom selben Release generierter Bundle-Hash, Image-Digest, Namespace, exakte Komponentenreihenfolge, Replica-/Rolloutzustand und jede positive Live-Assertion müssen gemeinsam bestehen. Mehr als 24 Stunden alte, kürzer als 30 Minuten oder länger als zwei Stunden beobachtete, verspätet signierte, zukünftige, manipulierte oder anders gebundene Evidenz fällt geschlossen aus. CLI und Metrics projizieren keine Evidenz-ID, Namespace-, Cluster-, Registry-, Digest-, Key-, Datei- oder Secret-Daten. Auch grüne Evidenz ist nur ein Release-Nachweis und kann niemals Production-Apply autorisieren.

0.30 führt dafür eine dritte, bewusst getrennte Signaturgrenze ein. Die externe Release-Autorität attestiert nicht nur die v0.29-Evidenz, sondern bindet deren Digest gemeinsam mit Restore-, Provider-E2E-, Security- und Release-Artefakt-Digests an genau das bereits genehmigte Production-Change-Set. QKERN speichert keinen privaten Release-Key und bietet keine API zum Erzeugen, Erweitern oder Umgehen der Autorisierung. Exakte Felder, doppelte JSON-Schlüssel, Ed25519-Signatur, Public-Key-Pin, fünf paarweise verschiedene Evidenz-Pins, Subject-Bindung und Zeitfenster werden gemeinsam geprüft. Ein Enable-Flag ohne vollständige Autorität bleibt geschlossen. Da das Release keine reale positive Autorisierung enthält, bleibt Production Apply im Auslieferungszustand technisch gesperrt.

0.31 definiert die vierte Signaturgrenze für Provider-/Pager-E2E. Der externe
Zertifizierungsrunner muss 15 fest benannte Real-Service-Szenarien gegen Managed
PostgreSQL 17 ausführen. Ein erfolgreiches Envelope bindet Provideridentität,
Providerkonfiguration, Brokervertrag, Vault-Policy, Pager-Routing und die exakten
signierten Backup-/Restore- und Runtime-Deployment-Evidenzen über sieben paarweise
verschiedene SHA-256-Pins. Der Public-Key-Pin ist davon ebenfalls verschieden.
Inline-Werte, Symlinks, beschreibbare Production-Dateien, Authority-Pfad-Reuse,
zusätzliche oder doppelte Felder, unvollständige Assertions, falsche Zeitfolgen und
mehr als 24 Stunden alte Läufe werden cause-frei abgewiesen. Der optionale Metrics-
Pfad exportiert nur feste Readiness-, Dauer-, Timestamp-, Szenario- und
PostgreSQL-Versionswerte und fällt bei ungültiger Evidence vollständig `503`.
QKERN besitzt weder den Private Key noch Provider-, Vault-, Cluster- oder Pager-
Zugriff; synthetische Test-Fixtures sind keine Production-Evidenz.

0.32 implementiert die fünfte Signaturgrenze für das unabhängige Security
Assessment. Die Evidence bindet das exakte Release, SBOM, Dependency-, SAST-,
DAST-, Secret-Scan-, Cross-Tenant- und Pentest-Artefakt über acht paarweise
verschiedene SHA-256-Pins. Threat Model, REST/MCP-Autorisierung, Prompt Injection,
SSRF/Egress, Approval-Races, Backup-Isolation und Session-/Token-Sicherheit gehören
zu den 14 zwingenden positiven Kontrollen; offene Critical- oder High-Findings
werden strukturell abgewiesen. Ein gemeinsamer Preflight verifiziert alle vier
Evidence-Signaturen und hasht Release-ZIP sowie vier Envelopes gegen die fünf
Production-Apply-Pins. QKERN besitzt weder Assessor-Private-Key noch Scan- oder
Pentest-Autorität; ohne reale externe Berichte bleibt Production Apply gesperrt.

1.0 RC1 führt diese Grenzen in einem letzten Dry-run zusammen. Der Preflight prüft
den exakten gehärteten Vier-Workload-Bundle, alle vier signierten Evidence-Gates,
fünf tatsächliche Dateidigest-Bindungen und eine secretfreie Production-
Konfiguration. PostgreSQL/TLS, eine gemeinsame Tenant-UUID, HTTPS-Origins,
Proxy-Vertrauensrand, persistenter Katalog, Probes, Metrics und Evidence-Flags sind
zwingend. Lokale Kataloge und Inline-Authorities werden abgewiesen. Entscheidend:
Production Apply muss dabei `false` bleiben; der Status ist nur eine redigierte
Rollout-Bereitschaft und keine Ausführungsautorität.

Die globale Membership-Discovery läuft ausschließlich als enges `SECURITY DEFINER`-Interface für die Auth-Rolle. Der Migrationseigentümer dieses Interfaces muss RLS zuverlässig umgehen können und ist Teil der vertrauenswürdigen Deployment-Grenze; die Anwendung selbst lehnt Superuser-, `BYPASSRLS`- und überlappende Login-Rollen ab.

## Data-Plane- und Autonomie-Grenze in 1.1 Alpha 1

Die Data Plane ist disabled-by-default. Sie akzeptiert keine rohe Connection URL
aus Request, REST, MCP oder Datenbankmetadaten, sondern nur eine tenantgebundene
opaque Katalogreferenz. Der Ziel-Login muss ein eigenständiger Read-Login ohne
Rollenmitgliedschaft und Privilegien sein. `READ ONLY`, RLS, Timeouts, Zeilen-/
Bytegrenze und Secret-Redaction werden serverseitig erzwungen.

Autonomie ist kein versteckter Approval-Bypass. Die Policy ist eine versionierte,
auditable stehende Autorisierung und darf nur durch Owner/Administrator geändert
werden. Jede automatische Entscheidung bleibt als exakt gebundenes Approval-
Artefakt erhalten. Der Not-Aus stoppt Auto-Approve und Auto-Queue. Production Apply
verlangt unabhängig davon weiterhin eine externe maschinelle Signatur; QKERN besitzt
deren Private Key nicht.

## Realtime-Grenze in 1.5 Alpha 1

Der Standalone-Host ist disabled-by-default, bindet nur `127.0.0.1` und verweigert
Production. Das ist eine technische Sperre, nicht nur ein Dokumentationshinweis.
Projekt-Key und optionales App-JWT werden im ersten Frame übertragen und nie in URL,
Health-Antwort, Fehlertext oder Event gespiegelt. Die Transportgrenze verlangt einen
exakten Origin und `qkern.realtime.v1`; Binärframes und Query-Strings sind verboten.

Der aktuelle Event Log ist prozesslokal und besitzt keine HA- oder Durability-
Garantie. Eine Production-Freigabe benötigt mindestens persistente tenantgebundene
History/CDC, Retention, horizontalen Fan-out samt Ordering/Fencing, TLS-/Proxy- und
DDoS-Grenze, Telemetrie, widerrufbare Sessions, Last-/Drop-/Soak-Tests und eine
unabhängige Cross-Tenant-/Abuse-Prüfung. Bis dahin darf der Production-Deny nicht
entfernt werden.

## Project-Queues-Grenze in 1.6 Alpha 3

Queue-Definitionen und Nachrichten übernehmen Organisation, Projekt und Environment
ausschließlich aus serverseitig verifizierter Session oder Project-Key-Auflösung.
Admin-Operationen benötigen die neue Owner-/Administrator-Capability; Claims,
Ack, Fail und Renewal akzeptieren nur `service_role`. Nicht erlaubte Ressourcen
werden als nicht gefunden projiziert. CORS verlangt exakte Origins, Session-
Mutationen zusätzlich Same-Origin-CSRF, und alle Queue-Antworten sind `no-store`.

Payloads sind auf Bytes, Tiefe und Knoten begrenzt. Dedupe-Schlüssel und Lease-
Tokens liegen nur als SHA-256-Verifier vor. Der rohe Lease-Token wird einmal beim
Claim ausgegeben und ist zusätzlich an Queue, Nachricht, Worker, Ablauf und
monotone Claim-Generation gebunden. Stale, fremde, abgelaufene oder wiederholte
Settlements scheitern geschlossen. Worker können weder freien Retryzeitpunkt noch
beliebige Failure-/Statuswerte setzen. MCP gibt keine Claim-/Settlement-Autorität
aus und alle öffentlichen Statuspfade verbergen Payload, Worker und Token.

Der Memory-Port ist ausdrücklich `ephemeral`. Bei PostgreSQL-Modus verwendet QKERN
Migration 0026 mit zusammengesetzten Tenant-FKs, erzwungener RLS und engen
Spaltengrants. Queue-Definitionen sind unveränderlich; Payload, Scope, Owner und
Message-ID können nach Insert nicht mutiert werden. `FOR UPDATE SKIP LOCKED`
verteilt parallele Claims ohne doppelte Zustellung innerhalb eines erfolgreichen
Transaktionspfads. Production lehnt den Memory-Port unabhängig vom Enable-Flag ab.

Vor einer Freigabe sind archivierte horizontale Lease-/Crash-/Reclaim-/Cleanup-
Races, Dead-Letter-Operations, Egress-/Ressourcenpolicy, Telemetrie, Last-/Soak-
Tests und unabhängige Security-Evidenz erforderlich. Die vorhandenen optionalen
PostgreSQL-Tests ersetzen diese externe Zertifizierung nicht.

Der Worker hält den einmaligen Lease-Token nur während der Handlerausführung,
erneuert genau diese Lease und bricht Handler bei Timeout, Shutdown oder Lease-
Verlust ab. Logs/Zähler schließen Payload, Worker-ID und Secrets strukturell aus.
DLQ-Listen sind Admin-only und payloadfrei; Replay verlangt Same-Origin, bindet die
neue Nachricht über einen same-tenant FK und einen partiellen Unique-Index genau
einmal an die Quelle und führt im HTTP-Request keinen Handler aus.

## Compute-Vertragsgrenze in 1.6 Alpha 4

Function-Definitionen erlauben nur digest-gepinnte Images, bounded Runtime,
Memory, Concurrency, Timeout, Entrypoint, öffentliche HTTPS-Egress-Origins und
Secret-Referenzen. Sandbox-Input/-Output und Header sind begrenzt; Cookie-/Hop-by-
Hop-Header scheitern. Der Webprozess führt kein Function-Image aus.

Webhooks sind HTTPS/443-only, frei von URL-Credentials/Query/Fragment,
redirectfrei, signiert, timeoutbegrenzt und nur bei exakter Ack-ID erfolgreich.
IP-Literale und lokale Hostnames scheitern vor Transport. Production benötigt
zusätzlich einen DNS-pinnenden Transport gegen private, Link-local-, Metadata- und
Rebinding-Ziele. Cron bindet Tenant, Service Role und exakte UTC-Occurrence an
einen stabilen Queue-Dedupe-Key. Keiner dieser Ports ist in MCP freigeschaltet.

## SDK-Grenze in 1.7 Alpha 1

Das TypeScript-SDK akzeptiert ausschließlich eine exakte HTTPS-Origin; HTTP ist
auf Loopback beschränkt. Project Keys und App-Tokens erscheinen nur in Headern,
nicht in URL, Fehler oder Telemetrie. Redirects sind deaktiviert, Timeout und
Responsegröße begrenzt, Headerwerte CRLF-frei. Fehler projizieren nur feste Codes,
HTTP-Status und validierte Request-ID. Writes werden nie transparent wiederholt;
Caller müssen Queue-Dedupe und API-Idempotenz explizit verwenden.

Die CLI speichert weder Project Keys noch Tokens. `qkern.config.json` besitzt ein
exaktes secretfreies Schema; unbekannte Felder und Projektpfad-Traversal scheitern.
Migration Plan gibt kein SQL aus und führt nichts aus. Seed Check akzeptiert nur
bounded INSERTs und verweigert Credential-Canaries. Apply bleibt eine getrennte
serverseitig autorisierte QKERN-Grenze.

Alpha 3 kompiliert SDK und CLI in begrenzte private Pakete. Distributionsdateien
dürfen keine Repository-Aliase enthalten; Tarball-Manifeste erlauben nur `dist`
und README. Der Fresh-Project-Smoke prüft secretfreie Config und niemals
ausführende Migration-/Seed-Wege. `schema pull` authentisiert Project Keys über
den bereits scope-geprüften Generated-Data-Kontext und sendet sie ausschließlich
in `X-QKERN-Key`. Publishing, Paket-Signatur und Provenance bleiben gesperrt.

## Usage-Metering-Grenze in 1.8 Alpha 1

Usage Events stammen ausschließlich von internen `meter`-Ports. Browser und MCP
erhalten weder Event-Ingestion noch Quota-Mutation. Organisation, Projekt,
Environment, Quelle und Actor werden aus der vertrauenswürdigen Serverbindung
übernommen und gegen die Rollen-/Quellenmatrix geprüft. Der öffentliche Pfad ist
eine `no-store` Read-only-Projektion ohne Einzelereignisse, Event Keys, Preise oder
Providerdetails.

Der Idempotency Key wird vor Persistenz SHA-256-gehasht. Ein zusätzlicher
Fingerprint bindet Scope, Metrik, Quelle, Menge und Monatsfenster; ein Key-Reuse
mit verändertem Inhalt scheitert. Dieselbe bereits akzeptierte oder abgelehnte
Entscheidung wird bei Retry stabil zurückgegeben. Counter, Quota-Snapshot und
append-only Event entstehen in einer tenantgebundenen Transaktion. Ein
`enforce`-Limit sperrt den Counter und lässt deshalb keine parallele Überbuchung
zu; `observe` ist ausdrücklich nicht blockierend.

Migration 0028 erzwingt zusammengesetzte Tenant-FKs, RLS, schmale Runtime-Grants,
unveränderliche Events, monotone Counter und lückenlose Policy-Revisionen.
Production verweigert den Memory-Port. Die derzeitige Projektion ist trotzdem
kein Billingbeleg: automatische transaktionale Emitter, Reconciliation, Retention,
Providerabgleich und unabhängige Last-/Crash-/Security-Evidenz fehlen noch.

## Vor Go-Live

- Externes Threat Model und Pentest
- Dependency-, SAST-, DAST- und Secret-Scan ohne offene Critical/High Findings
- Automatisierte Cross-Tenant-Matrix über REST, MCP, Storage, Logs, Exporte und Backups
- Restore-, Token-Revoke-, Approval-Race- und Prompt-Injection-Tests
- Schweizer Datenflüsse vollständig belegen: Datenbank, Object Storage, Backups, Logs, Support, Telemetrie, CDN und AI Provider
