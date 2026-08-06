# Release 1.28.0 — Echter Empfänger

> Datum: 6. August 2026 · Vorgänger: `1.27.0`

## Wofür dieses Release steht

Seit Release 1.20 stand in jeder Notiz derselbe offene Punkt: **keine
Zertifizierung gegen einen echten HTTPS-Server.** Signatur, Bestätigung,
Weiterleitungsverbot, Grössengrenze, Header-Filter und Adressprüfung waren
belegt — alle gegen ein eingespeistes `fetch`. Kein einziger Lauf hatte je einen
TLS-Handschlag gemacht.

Dieses Release schliesst die Lücke. Und es zeigt sofort, warum sie eine war.

## Der erste Lauf war rot

Das DNS-Pinning aus Release 1.27 hat gegen einen echten Socket **jede**
Verbindung verhindert.

Node ruft eine ersetzte `lookup`-Funktion seit `autoSelectFamily` mit
`all: true` auf und erwartet dann eine **Liste** von Adressen. Die Implementierung
gab eine einzelne Adresse zurück, wie es die ältere Signatur vorsieht. Ergebnis:
`ERR_INVALID_IP_ADDRESS`, bei jedem Aufruf, auf beiden Ausgangswegen — Webhooks
und Functions-Egress.

Gegen ein eingespeistes `fetch` war davon nichts zu sehen. Release 1.27 hat
eine Härtung ausgeliefert, die den Weg nicht gehärtet, sondern zugemauert hat.

Bemerkenswert ist, wie der Lauf aussah: **fünf von neun Fällen grün.** Alle
positiven Fälle fielen um, alle negativen blieben grün — denn ein Weg, der nie
funktioniert, weist auch jedes verbotene Ziel ab. Ein Testaufbau, der nur
negative Fälle prüft, hätte diesen Defekt als Bestätigung gelesen.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Empfänger-Zertifizierung (Node-24-HTTPS-Empfänger plus PostgreSQL 17) | **10 von 10 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Mutationsprobe Welle 1 (Empfänger) | Zustell-ID immer gespiegelt, zweiter Name im Zertifikat → genau 3 Fälle fallen um |
| Mutationsprobe Welle 2 (Code) | Weiterleitungsverbot, Adressprüfung und Antwortgrenze aus → genau 3 Fälle fallen um |
| Vitest lokal | 951 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Ein Empfänger, der nachrechnet

Der Empfänger im Stack verifiziert den HMAC selbst, zeitkonstant, mit demselben
kanonischen `<zeitstempel>.<körper>`. Ein Empfänger, der jede Nachricht
bestätigt, würde nur belegen, dass irgendetwas ankam.

Vier Zustellfälle:

- eine signierte Zustellung geht durch und steht danach als `delivered` in der
  Datenbank
- ein Empfänger, der mit `200` antwortet, ohne die Zustell-ID zurückzuspiegeln,
  gilt als Fehlschlag — sonst hakte ein beliebiger Proxy die Zustellung ab
- eine Weiterleitung wird nicht befolgt
- ein **zweiter Netzwerk-Alias auf demselben Container**, den das Zertifikat
  nicht trägt, wird abgewiesen

Der letzte ist der wichtigste Fall dieses Releases. Er zeigt, dass das
Festhalten der Adresse aus 1.27 die Identitätsprüfung **nicht** aushebelt: Die
Verbindung geht zur gepinnten Adresse, der Name wandert als SNI und erwarteter
Zertifikatsname mit, und ein falscher Name scheitert mit
`ERR_TLS_CERT_ALTNAME_INVALID`. Der Grund wird eigens direkt am Transport
festgestellt, weil der Zusteller bewusst keine Ursache nach aussen trägt.

## Fünf Egress-Fälle über dieselbe Leitung

Eine erlaubte Origin ist erreichbar. Von den Antwortheadern kehrt nur
`content-type` zurück — der Empfänger setzt zusätzlich `set-cookie` und einen
eigenen internen Header, und beide bleiben draussen. Eine zu grosse Antwort wird
abgebrochen. Eine Weiterleitung wird abgewiesen, statt der Function ein neues
Ziel samt `location` zu reichen. Eine fremde Origin fällt durch, bevor
überhaupt verbunden wird. Und `internal.qkern.test`, das ein echter Resolver auf
`172.31.240.x` abbildet, wird mit `EGRESS_BLOCKED` abgewiesen — obwohl die
Allowlist es ausdrücklich erlaubt. Die Adressprüfung steht hinter der Allowlist,
nicht vor ihr.

## Warum das Testnetz eine öffentliche Adresse trägt

Seit 1.27 verlangt jede Ausgangsverbindung eine öffentlich routbare Adresse. Ein
Container im Docker-Standardnetz liegt in `172.16.0.0/12` und wird von genau
dieser Zusage abgewiesen — richtigerweise.

Der Stack legt deshalb ein eigenes Netz mit einem öffentlichen Subnetz an, das
er für die Dauer des Laufs auf der lokalen Bridge belegt und danach abräumt.

Die Alternative wäre ein Schalter gewesen, der die Adressprüfung für den Lauf
abschaltet. Dann hätte der Lauf bewiesen, dass die Zusage hält, solange sie
nicht gilt. Der belegte Adressraum ist der ehrlichere Preis.

## Was die Mutationsprobe zusätzlich gezeigt hat

Der Weiterleitungsfall **auf dem Zustellweg** trägt nicht: Eine `302` fällt dort
ohnehin durch die Statusprüfung, und das Abschalten des Verbots macht ihn nicht
rot. Getragen wird die Zusage vom Egress-Fall, wo eine Weiterleitung sonst samt
`location` bei der Function ankäme.

Das ist kein Mangel des Produkts, sondern eine Aussage über den Fall: Er ist
Regressionsschutz, kein Beweis. Wer beides gleich zählt, überschätzt seine
Abdeckung.

## Ehrlich offen

- **Kein Empfänger ausserhalb des eigenen Docker-Netzes.** Der Lauf belegt
  Protokoll, Signatur, Zertifikatsprüfung und Policy — nicht die Erreichbarkeit
  des offenen Internets
- Das Zertifikat des Empfängers ist im Stack erzeugt und nur dort vertrauenswürdig;
  eine öffentliche Kette samt Widerruf ist damit nicht geprüft
- Der Container startet in diesem Lauf nicht mit: Ein Test im Container kann keine
  Container starten. Die Naht Sandbox ↔ Runtime bleibt eigens in
  `test:functions:docker` belegt
- Der Defekt am Pinning konnte lokal nicht durch einen Test abgesichert werden —
  jeder solche Test bräuchte eine echte TLS-Gegenstelle unter einer öffentlichen
  Adresse. Er hängt damit allein am Zertifizierungslauf
- Kein Deployment-Weg für Function-Images
- Die Nebenläufigkeitsgrenze ist prozesslokal, nicht clusterweit
- Usage misst noch keine Produktoperationen automatisch mit
- SDK und CLI sind nur auf Linux belegt
