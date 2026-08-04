# Background Runtime Probes Runbook

## Zweck

QKERN 0.27 kann für den Projekt-Datenbank-Provisioner, den Migration Worker sowie den Apply- und Incident-Publisher einen kleinen HTTP-Prozessstatus bereitstellen. Die Probe ist standardmäßig deaktiviert und bindet ausschließlich an `127.0.0.1`. Sie ist kein Control-Plane-API-Endpunkt, kein Ersatz für tenantgebundene Health-/SLO-Metriken und darf nicht über Service, Ingress oder Port-Forwarding veröffentlicht werden.

## Vertrag

| Pfad | Bedeutung | `200` | `503` |
| --- | --- | --- | --- |
| `GET`/`HEAD /live` | Prozess und Event Loop laufen | Start und laufender Betrieb | geordneter Shutdown |
| `GET`/`HEAD /ready` | die Schleife hat aktuell erfolgreich gepollt | letzter Poll erfolgreich und nicht veraltet | Start, letzter Poll fehlgeschlagen, Aktivität veraltet, Clock-Rollback oder Shutdown |

Andere Pfade liefern `404`, andere Methoden `405`. Die Antworten sind `text/plain`, `no-store` und enthalten ausschließlich `live`, `ready`, `not ready` oder `stopping`. Es werden keine Tenant-, Job-, Prozess-, Worker-, Zeit-, Endpoint- oder Secretdaten ausgegeben.

Ein fachlich fehlgeschlagener Auftrag, ein Dead Letter oder ein sicher behandelter Providerfehler macht den Prozess nicht automatisch unready, solange Queue-/Control-Plane-Zugriff und Poll-Schleife funktionieren. `claim_failed`, `retry_command_failed` und unerwartete Iterationsfehler setzen Readiness dagegen sofort zurück. Erst ein nachfolgender erfolgreicher Poll stellt sie wieder her. Liveness bleibt davon getrennt, damit ein externer Ausfall keine Restart-Schleife auslöst.

## Aktivierung

Die Variablen gelten jeweils für genau den gestarteten Hintergrundprozess:

```bash
export QKERN_RUNTIME_PROBE_ENABLED=true
export QKERN_RUNTIME_PROBE_HOST=127.0.0.1
export QKERN_RUNTIME_PROBE_PORT=9464
export QKERN_RUNTIME_PROBE_STALE_AFTER_MS=120000
```

Der Hostwert ist optional, darf aber, wenn gesetzt, nur exakt `127.0.0.1` sein. Konfigurierbare Ports liegen zwischen 1024 und 65535; das Veraltungsfenster liegt zwischen einer Sekunde und 15 Minuten. Werden mehrere QKERN-Prozesse im selben Container oder Netzwerk-Namespace betrieben, benötigen sie unterschiedliche Ports. Bevorzugt wird ein Prozess pro Container.

Das Veraltungsfenster muss größer als das erwartete gesunde Poll-Intervall einschließlich maximaler regulärer Operation sein. Ein zu kleines Fenster erzeugt absichtlich `503`, nicht einen optimistischen Zustand.

## Container-Probes

Da die Probe nur innerhalb desselben Netzwerk-Namespace erreichbar ist, verwendet Kubernetes eine `exec`-Probe. Das Beispiel benötigt kein zusätzliches `curl`:

```yaml
livenessProbe:
  exec:
    command:
      - node
      - -e
      - "fetch('http://127.0.0.1:9464/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  periodSeconds: 30
  timeoutSeconds: 2

readinessProbe:
  exec:
    command:
      - node
      - -e
      - "fetch('http://127.0.0.1:9464/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  periodSeconds: 15
  timeoutSeconds: 2
```

Die konkrete Deployment-Plattform muss Start-, Failure- und Termination-Verhalten live prüfen. Readiness soll Traffic oder Arbeitszuweisung entziehen; Liveness soll nur einen tatsächlich hängenden oder beendenden Prozess neu starten.

## Verifikation

Nach dem Start innerhalb desselben Containers:

```bash
node -e "fetch('http://127.0.0.1:9464/live').then(async r=>{console.log(r.status,await r.text())})"
node -e "fetch('http://127.0.0.1:9464/ready').then(async r=>{console.log(r.status,await r.text())})"
```

Erwartete Negativtests vor Freigabe:

1. Start ohne ersten erfolgreichen Poll: `/live` ist `200`, `/ready` ist `503`.
2. Control-Plane- oder Queue-Ausfall: `/ready` wird unmittelbar `503`, `/live` bleibt `200`.
3. Wiederherstellung und erfolgreicher Poll: `/ready` wird wieder `200`.
4. Überschrittenes Veraltungsfenster oder rückwärts springende Uhr: `/ready` ist `503`.
5. `SIGTERM`: beide Proben werden während des geordneten Shutdowns ungesund und der Listener wird geschlossen.
6. Zugriff über Pod-IP, Service oder Ingress: nicht erreichbar.

## Grenzen

Diese Probe beweist weder korrekte Tenant-Isolation noch Broker-/Pager-Zustellung, Target-Ledger-Konsistenz, Backup-/Restore-Fähigkeit, SLO-Einhaltung oder einen sicheren Production-Apply. Sie ergänzt lediglich die lokale Orchestrator-Sicht auf die vier getrennten Prozesse. Externes Monitoring, Alarmrouting, Provider-Onboarding, echte Crash-/Reclaim-Tests und Production-Deployment-Zertifizierung bleiben Live-Gates.
