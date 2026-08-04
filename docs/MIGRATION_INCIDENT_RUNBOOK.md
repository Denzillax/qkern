# Migration Incident Runbook

## Zweck und Sicherheitsgrenze

Dieses Runbook gilt für `migration_outcome_unresolved`-Incidents. QKERN eröffnet einen solchen Critical-Incident erst, wenn ein Migration-Job nach drei automatischen Ledger-Prüfungen und drei ausdrücklich angeforderten Review-Zyklen weiterhin ungeklärt in `review_required` steht.

Ein Incident ist ein Eskalations- und Evidenzdatensatz. Seine Quittierung bedeutet nicht, dass die Migration ausgeführt, zurückgerollt oder gelöst wurde. Keine Incident-API führt SQL aus oder verändert das Target-Ledger. Eine technische Auflösung kann ausschließlich der Worker nach einem exakten, read-only geprüften Target-Ledger-Treffer schreiben.

## Rollen

- Owner und Administratoren dürfen Incidents lesen und einmalig quittieren.
- Owner und Administratoren dürfen nach nachweislich behobener Zustellursache einen begrenzten Delivery-Recovery-Zyklus anfordern.
- Owner und Administratoren dürfen höchstens drei technische Target-Ledger-Verifications anfordern, aber keinen Incident selbst auflösen.
- Support darf Incidents lesen, aber nicht quittieren oder Migrationen verändern.
- Andere Organisationsrollen erhalten keinen Incident-Zugriff.
- Nur der dedizierte Worker darf einen Incident aus einem ausgeschöpften Job erzeugen.
- Nur der dedizierte Worker darf Job, Change Set und Incident nach bestätigter Ledger-Evidenz atomar abschließen.

## Triage

1. Zuerst `GET /api/v1/migrations/incidents/delivery/health` prüfen. `critical` bedeutet mindestens ein persistentes Dead-Letter-Event oder einen aktiven `SIGNING_KEY_UNAVAILABLE`-Fall. `degraded` bedeutet einen anderen aktiven Zustellfehler, ein seit fünf Minuten pendentes Event oder ein abgelaufenes Lease. Die disjunkten Ursachen-Counts und Zeitpunkte als redigierte Betriebsreferenz sichern. Danach offene Fälle über `GET /api/v1/migrations/incidents?status=open` abrufen und Incident-, Event-, Job-, Projekt- und Change-Set-ID sichern.
2. Den Audit-Verlauf für `migration.apply.review_required` und `migration.incident.opened` zeitlich korrelieren. Keine Rohfehler, URLs oder Secrets in Tickets kopieren.
3. Den Fall mit `investigation_started`, `external_dependency_engaged` oder `runbook_in_progress` quittieren. Freitext ist absichtlich nicht erlaubt.
4. Prüfen, ob der konfigurierte Incident-Publisher das feste `migration.incident.opened`-Event bestätigt zugestellt oder nach acht bestätigten Fehlern `dead_lettered` gemeldet hat. Der Gateway muss die versionierte `X-QKERN-Signature-Key-ID`, HMAC und Timestamp geprüft, Replays verworfen und die Event-ID idempotent verarbeitet haben. Eine Zustellbestätigung ist kein technischer Migrationsnachweis.
5. Worker-, Control-Plane- und Ziel-Datenbank-Verfügbarkeit getrennt prüfen. Credentials dürfen ausschließlich aus dem freigegebenen Vault stammen.
6. Das ownergeschützte Target-Ledger ausschließlich lesend und über einen vertrauenswürdigen Operations-Pfad auf die exakte Change-Set-ID prüfen. Ledger-Zeilen niemals manuell anlegen oder verändern.
7. Keine Migration erneut ausführen, solange das frühere Commit-Ergebnis nicht zweifelsfrei geklärt ist. Insbesondere darf ein fehlender Ledger-Eintrag nicht als Beweis für einen fehlenden Commit behandelt werden.
8. Incident-ID, Event-ID, geprüfte Systeme, Zeitpunkte und redigierte Evidenz im externen Incident-System dokumentieren. Eine fachliche Freigabe ersetzt keine technische Ledger-Verifikation.

## Technische Resolution-Verification

1. Erst nach der read-only Triage als Owner oder Administrator `POST /api/v1/migrations/incidents/{incidentId}/resolution/verification` mit exakt `{"reasonCode":"target_ledger_recheck"}` aufrufen. Kein Freitext, SQL, Statement-Hash, Datenbankziel oder Diagnosefeld übertragen.
2. Die Route bestätigt ausschließlich das persistente Command mit `executed: false`. Sie liest kein Target-Ledger, führt keine Migration aus und ändert weder Job, Change Set noch Incident.
3. Der Worker bindet das Command erneut an Tenant, Incident und den weiterhin `review_required` gebliebenen Reconciliation-Job. Höchstens drei Resolution-Verifications sind zulässig. Ein paralleles oder nachträglich unzulässiges Command wird fail-closed verworfen.
4. Der Worker öffnet ausschließlich den SQL-freien Reconciliation-Pfad. Er prüft die exakte Change-Set-ID und den erwarteten Statement-Hash im ownergeschützten Target-Ledger; `execute()` darf in diesem Pfad niemals aufgerufen werden.
5. Nur der feste Befund `already_applied` setzt Job und Change Set auf `applied` und den Incident in derselben Control-Plane-Transaktion mit `resolutionCode: target_ledger_match` auf `resolved`. Actor und Zeitpunkt werden datenbankseitig an die Worker-Identität gebunden.
6. Ein leerer Ledger-Eintrag oder ein unklarer Zugriff setzt den Incident nicht auf `resolved`. Nach den begrenzten Reconciliation-Versuchen kehrt der Job zu `review_required` zurück. Keine manuelle Ledger-, Job-, Change-Set- oder Incident-Mutation vornehmen.
7. Die Audit-Ereignisse `migration.incident.resolution_verification_requested`, `migration.incident.resolution_verification_scheduled`, `migration.incident.resolution_verification_rejected` und `migration.incident.resolved` korrelieren. Bei drei ausgeschöpften Verifications ohne Ledger-Treffer an Platform Engineering eskalieren.

## Dead-Letter-Recovery

1. Vor einem Retry den festen letzten Fehlercode prüfen und die Ursache unabhängig beheben: `SIGNING_KEY_UNAVAILABLE` verlangt kontrollierte Credential-/Key-Rotation, `DELIVERY_TIMEOUT` oder `DESTINATION_REJECTED` eine verifizierte Ziel-/Provider-Wiederherstellung, `INVALID_ACK` die Korrektur des Empfängervertrags und `PUBLISH_FAILED` eine redigierte Transportanalyse außerhalb von QKERN. Keine Rohdiagnosen in das Command übernehmen.
2. Als Owner oder Administrator `POST /api/v1/migrations/incidents/{incidentId}/delivery/retry` mit dem unmittelbar zuvor gelesenen `expectedFailureCode`, dem aktuellen `retryCycleCount` als `expectedRetryCycle` und genau einem kompatiblen Reason-Code aufrufen. `SIGNING_KEY_UNAVAILABLE` erlaubt ausschließlich `credentials_rotated`; `DESTINATION_REJECTED` erlaubt `destination_recovered`, `credentials_rotated` oder `provider_incident_resolved`; `PUBLISH_FAILED`, `INVALID_ACK` und `DELIVERY_TIMEOUT` erlauben `destination_recovered` oder `provider_incident_resolved`. Kein Freitext und keine Rohdiagnose übertragen.
3. Die Route bestätigt nur das persistente Command mit `executed: false`. Sie sendet keinen Webhook, löst den Incident nicht und verändert keinen Migration-Job.
4. Der Datenbank-Trigger bindet das Command atomar an Actor, Tenant, dead-lettered Zustand, Recovery-Limit, aktuellen Fehlercode und aktuelle Retry-Generation. Der Publisher-Worker prüft Code und Generation vor dem Öffnen erneut. Hat sich der Snapshot zwischen Anfrage und Verbrauch geändert, wird das Command fail-closed abgewiesen; das gilt auch, wenn derselbe Fehlercode in einer späteren Generation wiederkehrt. Pro Event sind maximal drei Recovery-Zyklen möglich; nur exakt gleiche Wiederholungen von Grund, Code und Generation sind idempotent.
5. `migration_incident_outbox.retry_command_applied`, `retry_command_rejected`, `dead_lettered` und `published` in der redigierten Publisher-Telemetrie überwachen. Bei ausgeschöpftem Recovery-Limit an Platform Engineering eskalieren; keine Datenbankzustände manuell ändern.

## Eskalationskriterien

Sofort an Datenbank-/Platform-Engineering eskalieren, wenn mindestens eines zutrifft:

- Ledger-, Fence-Owner oder ACLs weichen vom Provisionierungsvertrag ab.
- Der Change-Set-Hash widerspricht einem vorhandenen Ledger-Eintrag.
- Commit-, Netzwerk- oder Failover-Zustand bleibt mehrdeutig.
- Ein alter Worker könnte noch eine Zieltransaktion halten.
- Tenant-, Projekt-, Environment- oder Datenbankbindung ist nicht eindeutig.
- Eine manuelle Ledger- oder Jobzustandsänderung wird vorgeschlagen.

## PostgreSQL-Freigabenachweis

Vor einer produktiven Freigabe `npm run test:postgres:docker` in der kontrollierten CI-/Lab-Umgebung ausführen und den vollständigen grünen Lauf aller neun Real-DB-Tests als Release-Evidenz archivieren. Der Stack verwendet keinen Host-Port, hält Daten nur in tmpfs und entfernt seine Container sowie Volumes nach dem Lauf. Ein übersprungener Test, ein nur lokal grüner Vitest-Lauf ohne PostgreSQL oder ein nicht archiviertes Ergebnis gilt nicht als Zertifizierung. Die übrigen Target-Fence-, Crash-/Reclaim- und Provider-Races bleiben separate Go-Live-Gates.

## Abschlussgrenze

QKERN 0.20 unterscheidet `open`, `acknowledged` und `resolved`. Delivery-Health, Fehlerklassifikation, Dead-Lettering und Recovery betreffen ausschließlich die externe Benachrichtigung; eine erfolgreiche Zustellung ist kein technischer Migrationsnachweis. `resolved` beweist nur, dass der Worker für die unveränderlich gebundene Change-Set-ID und den Statement-Hash einen passenden Target-Ledger-Eintrag bestätigt und Job sowie Change Set atomar auf `applied` gesetzt hat. Der Workflow und sein reproduzierbarer Real-PostgreSQL-Nachweisweg sind implementiert; bis der Harness und alle weiteren E2E-Gates in der Freigabeumgebung bestanden und archiviert sind, bleibt Production-Apply nicht freigegeben.
