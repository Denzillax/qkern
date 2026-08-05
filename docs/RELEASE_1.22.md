# Release 1.22.0 — Functions-Sandbox

> Datum: 5. August 2026 · Vorgänger: `1.21.0`

## Wofür dieses Release steht

`FunctionSandboxPort` existiert seit Release 1.6 Alpha 4 — ohne eine einzige
Implementierung. Egress-Policy, Ressourcenlimits und Secret-Canary, die drei
Teile, die das Austrittskriterium der Stufe 1.6 ausdrücklich nennt, waren damit
ein Versprechen im Vertrag und sonst nichts.

Dieses Release baut die Sandbox und weist die Zusagen an einer echten
Container-Laufzeit nach.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Functions-Zertifizierung (Docker 29.5) | **13 von 13 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Mutationsprobe | drei Flags einzeln entfernt → genau 3 Fälle fallen um |
| Vitest lokal | 866 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

Neuer Lauf: `npm run test:functions:docker`. Evidenz:
`docs/evidence/2026-08-05/functions-*`.

## Die Isolation liegt in den Flags

- `--network none` — kein Egress.
- `--read-only` mit einem kleinen `noexec`-tmpfs für `/tmp`: Geschriebener Code
  lässt sich nicht ausführen.
- `--user 65534:65534`, `--cap-drop ALL`, `--security-opt no-new-privileges` —
  ein Setuid-Binary im Image hebt die Rechte nicht wieder an.
- `--memory` **gleich** `--memory-swap`. Ohne das weicht ein Speicherfresser
  einfach in Swap aus und die Grenze greift nie.
- `--pids-limit` — sonst genügt eine Fork-Schleife.
- Kein `--env`. Der Aufruf steht vollständig auf stdin; jede Variable wäre eine
  zweite Stelle, an der versehentlich ein Geheimnis landen könnte.

Die Umgebung dieses Prozesses wird **nicht** weitergereicht. Sie enthält
Datenbankadressen, Vault-Token und Signaturschlüssel. Ein Canary-Wert in der
Umgebung des Testlaufs darf im Container nicht auftauchen; genau das prüft ein
Zertifizierungsfall.

## Der Fund: der Container überlebte seinen Timeout

Der erste Zertifizierungslauf war 12 von 12 grün — und trotzdem falsch. Beim
Aufräumen liess sich das Test-Image nicht löschen: *image is being used by
running container*.

Die Sandbox tötete den Docker-**Client**, nicht den Container. Für den Aufrufer
sah das aus wie ein sauberer `FUNCTION_TIMEOUT`, während die Function
unbegrenzt weiterlief und weiter Speicher und CPU verbrauchte. Eine
Isolationszusage, die den Prozess nicht wirklich beendet, ist hohl.

Die Sandbox benennt den Container jetzt und entfernt ihn hart, sobald der Aufruf
scheitert. Ein neuer Fall prüft nicht mehr nur die Antwort des Aufrufers,
sondern dass nach dem Timeout **kein** Sandbox-Container mehr läuft.

Der Fall war nur zu finden, weil der Aufräumschritt fehlschlug und gemeldet
wurde. Ein Zertifizierungslauf, der stillschweigend aufräumt, hätte das
verschluckt.

## Fail closed statt raten

Eine Definition mit erlaubten Egress-Origins wird **abgewiesen**. Es gibt noch
keinen Egress-Proxy; ohne ihn gäbe es nur alles oder nichts. „Alles" wäre keine
Policy, „nichts" wäre ein stiller Bruch der Zusage, die die Liste ausdrückt.

## Ein sichtbarer Schalter statt einer stillen Lücke

Ein lokal gebautes Image hat keinen Registry-Digest. Statt die Produktionsregel
aufzuweichen, akzeptiert die Sandbox eine blosse Image-Id nur über den
ausdrücklichen Schalter `allowLocalImageId`, der standardmässig aus ist. Ein
eigener Zertifizierungsfall belegt, dass er wirklich ein Schalter ist: Ohne ihn
gilt exakt die Regel der Definition.

## Die Mutationsprobe

`--network none` durch `bridge` ersetzt, `--user` entfernt, die
Container-Entfernung abgeschaltet — genau die drei zugehörigen Fälle fallen um,
kein anderer.

## Stufenwirkung

**Stufe 1.6 bleibt offen — bewusst.**

Die drei im Austrittskriterium genannten Eigenschaften sind jetzt zertifiziert.
Trotzdem schliesse ich die Stufe nicht: Functions haben weiterhin **keinen
Deployment-Weg, keine Aufruf-API und keine Egress-Erlaubnis**. Die Sandbox ist
eine Bibliothek, die niemand aufruft.

Genau dieses Muster hat der Sprint dreimal gefunden — beim Realtime-Poller, beim
dauerhaften Event-Log und bei der Webhook-Outbox. Eine Stufe auf einer
Komponente zu schliessen, die der Betrieb nicht erreicht, wäre derselbe Fehler
mit einem Häkchen darunter.

## Ehrlich offen

- Kein Egress-Proxy; Functions können nichts nach aussen aufrufen
- Kein Deployment-Weg für Function-Images und keine Aufruf-API
- Keine Nebenläufigkeitssteuerung (`maxConcurrency` wird noch nicht durchgesetzt)
- Kein Vault-gestützter Signaturschlüssel-Provider für Webhooks
- CPU- und PID-Grenze sind gesetzt, aber nicht eigens zertifiziert
- Die Zertifizierung lief gegen Docker 29.5 auf einem Host; andere
  Container-Laufzeiten sind nicht belegt
