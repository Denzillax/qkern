# Production Readiness — RC1 Operator Runbook

## Zweck

`npm run verify:production-readiness` ist der letzte trockene Go-live-Check vor
einem kontrollierten Rollout. Er verbindet drei unabhängig fail-closed geprüfte
Grenzen:

1. secretfreie Production-Konfiguration,
2. den exakten gehärteten Vier-Workload-Deployment-Bundle,
3. die vier signierten Evidence-Gates und fünf tatsächlich gepinnten Dateien.

Der Befehl öffnet keine Netzwerkverbindung, rollt nichts aus, schreibt keinen
Zustand und erzeugt keine Production-Apply-Autorisierung.

## Verlangte Production-Konfiguration

- `NODE_ENV=production`
- `QKERN_RUNTIME_MODE=postgres`
- `DATABASE_SSL=require`
- `QKERN_PROJECT_DATABASE_CATALOG_SOURCE=control-plane`
- Runtime-Probes, tenantgebundene Metrics und alle vier Evidence-Gates aktiviert
- `QKERN_PRODUCTION_APPLY_ENABLED=false`
- kein lokaler oder statischer Environment-Katalog
- keine Inline-Evidence, Inline-Verifier-Keys oder Inline-Vault-Tokens
- identische UUID für Provisioner, Worker und Metrics
- ein bis fünf deklarierte vertrauenswürdige Proxy-Hops
- ein bis zwanzig eindeutige HTTPS-Ursprünge ohne Credentials, Pfad, Query,
  Fragment, localhost oder Nichtstandardport

Die geheimen Werte selbst werden von diesem Gate bewusst nicht eingelesen.
Datei-, Key-, Digest-, Rollen- und Endpoint-Grenzen prüfen die bereits vorhandenen
Komponenten beim jeweiligen Start beziehungsweise in den vorgelagerten Evidence-
Verifizierern.

## Ausführung

Zuerst alle Variablen und externen Dateien gemäß `.env.example` und den vier
Evidence-Runbooks bereitstellen. Danach:

```bash
npm run verify:production-readiness
```

Nur ein vollständig grüner Lauf liefert:

```json
{
  "data": {
    "productionReadiness": {
      "status": "ready_for_controlled_rollout",
      "deployment": "production",
      "scope": "controlled_rollout",
      "runtimeComponentCount": 4,
      "signedEvidenceCount": 4,
      "pinnedArtifactCount": 5,
      "organizationBindingCount": 1,
      "productionApplyEnabled": false
    }
  }
}
```

Jeder Fehler liefert ausschließlich `PRODUCTION_READINESS_NOT_READY`. Tenant-ID,
Origins, Hosts, Pfade, Pins, Key-IDs, Signaturen und Ursachen werden nicht ausgegeben.

## Kontrollierter Rollout

1. RC-Preflight grün archivieren.
2. Vier Workloads mit weiterhin deaktiviertem Production Apply ausrollen.
3. reale Probes, Metrics und Alarmrouting beobachten.
4. erst für ein konkret freigegebenes Change Set eine kurzlebige externe
   Production-Apply-Autorisierung erzeugen.
5. Autorisierung und Apply-Schalter kontrolliert bereitstellen; REST/MCP und Worker
   prüfen denselben Claim unabhängig.
6. bei jeder Abweichung Apply sofort wieder deaktivieren und Evidenz neu erzeugen.

`ready_for_controlled_rollout` bedeutet nicht „Production Apply freigegeben“.

