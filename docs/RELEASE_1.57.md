# Release 1.57.0 — Der fünfte Prozess

## Realtime, mit einem echten Client am anderen Ende

Realtime ist ein Server, also kann ein Client ihn befragen. Der Fall startet
`npm run realtime` und läuft die Kette, die ein Kunde sieht:

**verbinden → mit einem echten Projekt-Key anmelden → abonnieren → senden →
empfangen**

Nichts davon ist eingespeist. Der Schlüssel liegt als Prefix und Hash in der
Datenbank, wie der Dienst ihn speichern würde; der Prozess authentifiziert gegen
genau diesen Hash.

## Vier Anläufe, vier eigene Fehler

- **`QKERN_AUTH_DATABASE_URL` fehlte.** Der Prozess baut den Projekt-Key-Dienst
  über die Auth-Rolle auf — die Schlüssel liegen in der Control Plane, der Weg
  dorthin führt über eine eigene Verbindung.
- **Der Endpunkt ist ein Pfad, keine Query.**
  `/realtime/v1/projects/<id>/environments/<env>`. Die Antwort auf die falsche
  Adresse war 403 und sonst nichts.
- **Ein öffentlicher Schlüssel ist `anon`**, und `anon` darf ausschliesslich
  `public:`-Kanäle abonnieren und niemals senden. Wer damit einen Rundlauf messen
  will, misst die Policy statt den Prozess.
- **Der Service-Schlüssel war ein Zeichen zu kurz.** Nach dem Präfix stehen genau
  43 Zeichen, und `qk_service_` ist um eines länger als `qk_public_`.

Keiner dieser vier Punkte ist ein Produktfehler. Alle vier sind Dinge, die ein
Aussenstehender beim ersten Anschluss ebenfalls falsch macht — und drei davon
antworten mit einer Zahl statt mit einem Grund.

## Mutationsproben

| Mutation | Ergebnis |
| --- | --- |
| Der Fernzustellung ihre Verdrahtung nehmen | **traf nicht** — ein Client auf einer Instanz merkt davon nichts |
| Jeder Schlüssel bekommt die Rolle `anon` | 123 von 124 — das Abonnement scheitert, genau der neue Fall |

Dass die erste Probe nicht traf, steht hier, weil es die Reichweite des Falls
beschreibt: Er belegt einen Client auf **einer** Instanz.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 124/124, exit 0 | `docs/evidence/2026-08-08/realtime-process-run1.manifest.json` |
| PostgreSQL 124/124, exit 0 | `docs/evidence/2026-08-08/realtime-process-run2.manifest.json` |
| Mutation Rollenzuordnung 123/124 | `docs/evidence/2026-08-08/realtime-process-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Belegt ist ein Client auf einer Instanz.** Fan-out über zwei Instanzen,
  Replay über den Cursor und Postgres Changes sind als Bibliothek zertifiziert,
  nicht durch diesen Prozess.
- **Zwei Prozesse bleiben ohne Arbeitsnachweis.** Der Apply-Publisher braucht
  einen Broker, den es im Stack nicht gibt; der Provisioner einen Vault-Weg.
- **Drei der vier Stolperstellen antworten mit einer Zahl statt mit einem
  Grund.** Das ist an einer Aussengrenze richtig und macht den ersten Anschluss
  trotzdem mühsam.
