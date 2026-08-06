# Release 1.25.0 — Signaturschlüssel aus dem Vault

> Datum: 5. August 2026 · Vorgänger: `1.24.0`

## Wofür dieses Release steht

Seit Release 1.20 stand in jeder Release-Notiz derselbe offene Punkt: kein
Vault-gestützter Signaturschlüssel-Provider. Der einzige vorhandene Provider
liest die Schlüssel aus der Umgebung und **weigert sich, in Produktion zu
existieren** — dort konnten Webhooks also gar nicht signiert werden.

Da der Zustellprozess ohne erreichbaren Schlüssel nicht startet, war er in
Produktion überhaupt nicht startbar. Das war der letzte Grund dafür.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Vault-Zertifizierung (HashiCorp Vault 1.18) | **6 von 6 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Mutationsprobe | Längengrenze und 404-Behandlung abgeschaltet → genau 2 Fälle fallen um |
| Vitest lokal | 901 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

Fünfter Zertifizierungsstack: `npm run test:vault:docker`. Evidenz:
`docs/evidence/2026-08-05/webhook-vault-*`.

## Was der Provider tut — und was nicht

`vault:<pfad>` wird auf `<mount>/data/<pfad>` abgebildet (KV Version 2). Der
Token kommt ausschliesslich aus einer Datei, über denselben
`VaultTokenFileProvider`, den der Verbindungskatalog seit Langem benutzt — eine
Vault-Agent-Sink wird damit automatisch rotiert.

- **Der Token steht nie in der URL**, nur im Header. Ein Fall prüft das.
- **Weiterleitungen sind ausgeschlossen.** Eine Umleitung könnte den Token an ein
  fremdes Ziel tragen.
- **Die Antwort wird begrenzt gelesen und streng geprüft.** Falsche Form,
  falscher Content-Type oder ein zu kurzes Geheimnis führen zum Fehlschlag,
  nicht zu einer schwachen Signatur.
- **404 heisst „kenne ich nicht", nicht „kaputt".** Ein unbekannter Webhook darf
  nicht wie ein Vault-Ausfall aussehen.
- **Der Fehler trägt keine Ursache.** Eine Vault-Meldung verriete den Pfad und
  damit die Struktur des Schlüsselspeichers. Ein Fall prüft, dass weder Pfad noch
  Netzwerkmeldung in der Ausnahme landen.

Der Cache hat eine kurze TTL: Ohne Cache träfe jede einzelne Zustellung den
Vault, mit einem langen überlebte ein zurückgezogener Schlüssel seine Rotation.
Verschwindet eine Referenz, fliegt sie sofort aus dem Cache.

## Der Vault gewinnt

Ist ein Vault konfiguriert, wird der Umgebungs-Provider gar nicht erst gebaut.
Sonst könnte ein vergessener lokaler Schlüssel in einer Produktionsumgebung
stillschweigend gewinnen. Eine halb konfigurierte Vault-Anbindung — URL ohne
Tokendatei oder umgekehrt — ist ein Fehler, kein Rückfall auf die Umgebung.

## Zwei Fehler im Stack, keiner im Produkt

Der erste Lauf war rot, und mein bewusst ursachenfreier Fehler machte die
Diagnose schwer — der Preis dieser Entscheidung, hier zum ersten Mal spürbar.
Gemessen wurde deshalb von aussen.

**`--abort-on-container-exit` riss den Vault mit.** Ein eigener Seed-Container
schrieb die Testschlüssel und endete — woraufhin Compose den ganzen Stack
stoppte, inklusive Vault, bevor der Test lesen konnte. Der Seed läuft jetzt im
Testcontainer selbst, über dieselbe HTTP-API, die auch der Provider benutzt.

**Das Seed-Skript mischte `require` und Top-Level-`await`.** Node kann das
Modulformat dann nicht bestimmen. Ein `import` statt `require` genügte.

Beide Fehler lagen im Nachweis, nicht im Produkt. Genannt werden sie hier
trotzdem: Ein Stack, der aus dem falschen Grund rot ist, kostet genauso viel
Zeit wie ein echter Fehler — und ein Stack, der aus dem falschen Grund grün
wäre, wäre schlimmer.

## Die Mutationsprobe

Längengrenze fallen gelassen und die 404-Behandlung abgeschaltet: Genau die zwei
zugehörigen Fälle fallen um, kein anderer.

## Ehrlich offen

- Kein Egress-Proxy; Functions können weiterhin nichts nach aussen rufen
- Der Vault-Lauf nutzt den Dev-Modus: ein Root-Token, in-memory, kein Unseal.
  Geprüft ist der Weg von einer Referenz zu einem Schlüssel, nicht der Betrieb
  eines produktiven Vault-Clusters
- Keine AppRole- oder Kubernetes-Authentifizierung; der Token muss von aussen
  in eine Datei gelegt werden, üblicherweise von einem Vault Agent
- Kein Deployment-Weg für Function-Images
- SDK und CLI kennen weder Definitionen noch Aufruf
