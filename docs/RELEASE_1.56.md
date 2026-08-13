# Release 1.56.0 — Der vierte Prozess

## Die Zeile, die seit 1.44 stand

> **Vier Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime, beide
> Publisher und der Provisioner.

Einer davon ist jetzt belegt. Der Incident-Publisher liefert an einen Webhook,
und der echte Empfänger steht seit `1.28.0`.

## Zwei Dinge waren zu tun

**Der Empfänger brauchte einen eigenen Pfad.** Der Incident-Publisher verlangt
genau `{"status":"ack","eventId":"…"}` mit der Kennung, die er geschickt hat —
`{"received":true}` gilt ihm als ungültig. Und er signiert anders: dasselbe
Verfahren, aber die Schlüsselkennung steht in einem eigenen Header und die
Signatur ist hexadezimal statt base64url.

Wer beide Formate in eine Prüfung zwängt, prüft am Ende keines von beiden
richtig. `/incidents` hat deshalb seine eigene Verifikation, und sie rechnet den
HMAC genauso nach wie der andere Pfad.

**Das Geheimnis wird an zwei Stellen verschieden gelesen.** Der Empfänger
dekodiert `QKERN_RECEIVER_SECRET` als base64url und rechnet mit den Bytes; der
Projekt-Webhook-Signierer tut dasselbe. Der Incident-Publisher nimmt
`QKERN_INCIDENT_WEBHOOK_HMAC_SECRET` als **rohe Zeichenkette**.

Beide sind in sich stimmig und passen nur zusammen, wenn man die eine Seite
dekodiert konfiguriert. Wer das übersieht, bekommt 401 und keine Erklärung —
mich hat es zwei Läufe gekostet.

## Die Vorabfrage bleibt stehen

Gefunden habe ich es erst, nachdem der Fall den Empfänger **direkt** befragt hat,
bevor er den Prozess startet. Wer den Prozess misst, ohne die Gegenstelle zu
kennen, sucht den Fehler an der falschen Stelle.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Der Empfänger bestätigt eine andere Kennung | 12 von 13 — die Zustellung kommt an, gilt aber zu Recht nicht als angekommen |

## Belege

| Lauf | Manifest |
| --- | --- |
| Empfänger 13/13, exit 0 | `docs/evidence/2026-08-08/incident-process-run1.manifest.json` |
| Empfänger 13/13, exit 0 | `docs/evidence/2026-08-08/incident-process-run2.manifest.json` |
| Mutation Bestätigung 12/13 | `docs/evidence/2026-08-08/incident-process-mutation.manifest.json` |

Lokal: 1023 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Belegt ist die gelungene Veröffentlichung.** Wiederholung, Dead Letter und
  die Wiederaufnahme über ein Delivery Command sind gegen echtes PostgreSQL
  zertifiziert, aber nicht durch diesen Prozess.
- **Drei Prozesse haben weiterhin keinen Arbeitsnachweis**: Realtime,
  Apply-Publisher und Provisioner. Der Apply-Publisher liefert an einen Broker,
  den es im Stack nicht gibt; der Provisioner braucht einen Vault-Weg.
- **Die unterschiedliche Lesart des Geheimnisses bleibt.** Sie ist jetzt
  dokumentiert, nicht behoben — eine Vereinheitlichung wäre eine eigene Scheibe
  mit Migrationsfolgen für bestehende Konfigurationen.
