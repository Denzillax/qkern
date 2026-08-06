# Release 1.35.0 — Echte Registry

> Datum: 6. August 2026 · Vorgänger: `1.34.0`

## Wofür dieses Release steht

Die Functions-Kette hatte seit Release 1.24 genau **eine** ersetzte Stelle. Sie
stand in jeder Release-Notiz seither, und sie ist jetzt weg.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Functions-Zertifizierung (Docker 29.5, `registry:2`, PostgreSQL 17) | **23 von 23 bestanden**, exit 0 |
| PostgreSQL-17-Zertifizierung | **101 von 101 bestanden**, exit 0, 34 Migrationen |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Mutationsprobe 1 | Migration 0034 weggelassen → alle fünf Kettenfälle fallen über den Spalten-Check |
| Mutationsprobe 2 | Registry nach dem Push gestoppt → 15 von 23 Fällen fallen um |
| Vitest lokal | 976 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Die letzte ersetzte Stelle

Ein lokal gebautes Image hat keinen Registry-Digest. Die Definition trug deshalb
eine erfundene Referenz, und beim Start des Containers wurde genau dieser eine
Argumentwert gegen die lokale Image-Id getauscht. Jede Produktregel blieb dabei
in Kraft — aber die Auflösung eines echten Digests durch eine echte Registry war
nie geprüft.

Jetzt läuft `registry:2` im Stack. Das Test-Image wird gebaut, gepusht,
**lokal gelöscht** und über seinen Digest wieder geholt.

Das Löschen ist der Teil, der zählt. Läge das Image noch lokal, beantwortete der
Zwischenspeicher die Frage und die Registry wäre Kulisse. Die zweite
Mutationsprobe zeigt, dass es keine ist: Ohne laufende Registry fallen 15 von 23
Fällen um.

## Ein Fehler, den nur eine echte Registry zeigen konnte

Der Spalten-Check aus Migration 0033 liess keinen Doppelpunkt zu:

```
image ~ '^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$'
```

Damit war **jede Registry mit Port ausgeschlossen** — jede lokale, jede in einem
Cluster, jede in einem Zertifizierungsstack. Aufgefallen ist das nie, weil bis
dahin jede Definition eine erfundene Referenz ohne Port trug. Der Fehler
versteckte sich hinter genau der Stelle, die dieses Release entfernt.

Migration 0034 lässt den Doppelpunkt zu und sonst nichts. Die bindende Stelle
bleibt der Digest: Was vor dem `@` steht, ist nur die Adresse, aufgelöst wird
über `sha256`. Ein Tag allein bleibt abgewiesen.

Die erste Mutationsprobe lässt die Migration weg — und alle fünf Kettenfälle
fallen über `project_functions_image_check`. Das ist zugleich der Beleg, dass
der Fund echt war und nicht eine Vorsichtsmassnahme ohne Anlass.

## Ein Schlupfloch weniger

`DockerFunctionSandbox` hatte einen benannten Schalter `allowLocalImageId`, der
zusätzlich eine blosse Image-Id zuliess. Er war ehrlich dokumentiert,
standardmässig aus und existierte ausschliesslich, weil der Zertifizierungslauf
lokal baute.

Er ist entfernt. Was bleibt, ist eine Regel ohne Ausnahme — und der zugehörige
Fall prüft jetzt genau das, statt die Wirkung eines Schalters.

Das ist die stille Nebenwirkung dieses Releases und vielleicht die wichtigere:
Ein Testaufbau, der die Wirklichkeit nachstellt statt sie zu benutzen, erzeugt
Schalter im Produktcode. Wer die Wirklichkeit in den Lauf holt, kann sie wieder
entfernen.

## Ehrlich offen

- **Die Registry läuft ohne TLS und ohne Authentifizierung** auf `127.0.0.1`;
  Docker behandelt diese Adresse ohne Zutun als unsicher erreichbar. Ein Lauf
  gegen eine authentifizierte Registry mit Zertifikat fehlt — und damit jede
  Aussage über Registry-Zugangsdaten
- **Einen Deployment-Weg gibt es weiterhin nicht.** Der Lauf zeigt, dass QKERN
  einen Digest auflösen kann, nicht wie das Image eines Betreibers dorthin
  gelangt
- Die Nebenläufigkeitsgrenze der Functions ist prozesslokal, nicht clusterweit
- Kein Abgleich der Usage-Zahlen mit Providerwerten
- Weder Preise noch Tarife noch Rechnungen
- SDK und CLI sind nur auf Linux belegt
