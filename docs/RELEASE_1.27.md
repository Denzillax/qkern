# Release 1.27.0 — Egress-Härtung

> Datum: 6. August 2026 · Vorgänger: `1.26.0`

## Wofür dieses Release steht

Seit Release 1.20 stand bei den Webhooks und seit 1.26 bei den Functions
derselbe offene Punkt: kein DNS-Pinning, keine Sperre privater Adressbereiche.
Beide Pfade prüften eine Allowlist aus **Namen** und verbanden dann dorthin, wo
der Name hinzeigte.

Ein Name gehört aber dem, der ihn betreibt. `api.example.com` darf jederzeit auf
`169.254.169.254` zeigen, und dort liegt in jeder gängigen Cloud der
Metadatendienst mit den Zugangsdaten der Instanz. Genau darüber laufen die
bekannten SSRF-Angriffe.

Ab jetzt wird nicht der Name geprüft, sondern die Adresse, zu der er auflöst.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Functions-Zertifizierung (Docker 29.5 plus PostgreSQL 17) | **23 von 23 bestanden**, exit 0 |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| Adresspolicy lokal | 39 Fälle, 27 davon abzuweisende Adressen |
| Mutationsprobe | Link-local durchgelassen und nur die erste Adresse geprüft → 4 lokale und 1 Container-Fall fallen um |
| Vitest lokal | 951 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

## Auflösen, prüfen, festhalten

Drei Schritte, und der dritte ist der, den man am leichtesten vergisst.

**Auflösen.** Der Name wird einmal aufgelöst, über denselben Weg, den die
Verbindung nähme.

**Prüfen.** **Alle** zurückgegebenen Adressen müssen öffentlich sein, nicht nur
eine. Ein Name, der gleichzeitig auf eine öffentliche und eine interne Adresse
zeigt, ist kein Grenzfall, sondern das Muster eines Angriffs. Die Mutationsprobe
hat genau diese Zeile abgeschaltet, und der Fall dazu fiel um.

**Festhalten.** Danach wird zu genau der geprüften Adresse verbunden. Ohne
diesen Schritt bliebe zwischen Prüfung und Verbindungsaufbau ein Fenster offen,
in dem derselbe Name erneut auflöst und diesmal woanders landet. Das ist DNS
Rebinding, und eine Prüfung ohne Pinning verhindert es nicht.

Der Name wandert trotzdem als SNI und als erwarteter Zertifikatsname mit. Eine
feste Adresse darf nicht dazu führen, dass die Identität des Gegenübers
ungeprüft bleibt.

## Was die Adresspolicy abweist

Loopback, alle drei privaten Bereiche, Carrier-Grade NAT, Link-local samt
Metadatendienst, „dieses Netz", Multicast, Broadcast, die Benchmark- und
Dokumentationsbereiche und das 6to4-Relay. Auf der IPv6-Seite Loopback,
unspezifiziert, Unique Local, Link-local, Multicast, Dokumentation, Teredo und
6to4.

Dazu die Form, die am häufigsten vergessen wird: **IPv4-mapped IPv6**. Ohne
diesen Schritt umginge `::ffff:127.0.0.1` die gesamte IPv4-Prüfung.

Die Liste ist bewusst umgekehrt gebaut: Alles, was nicht eindeutig als
öffentlich erkannt wird, gilt als nicht erreichbar. Eine unbekannte Adressform
ist ein Grund abzulehnen, kein Grund durchzulassen.

## Ein eigener Ausgang für „blockiert"

`EGRESS_BLOCKED` steht jetzt neben `EGRESS_FAILED`. Ein von der Policy
abgewiesenes Ziel ist etwas anderes als ein Empfänger, der gerade nicht
erreichbar ist. Wer beides gleich benennt, lässt einen Betreiber darüber suchen,
warum sein Aufruf nicht ankommt.

## Kein `fetch` mehr im Ausgangspfad

Node bietet keinen unterstützten Weg, dem eingebauten `fetch` eine eigene
Namensauflösung mitzugeben. Ohne diesen Zugriff ist Pinning nicht möglich.
Der Ausgangspfad läuft deshalb über `node:https` mit eigener `lookup`-Funktion.

Die Einspeisung bleibt: Beide Aufrufer nehmen weiterhin ein `fetchFn` entgegen,
und alle vorhandenen Tests, die eines einspeisen, laufen unverändert.

## Ehrlich offen

- **Keine Zertifizierung gegen einen echten externen HTTPS-Server.** Der
  geprüfte Weg wird mit einem eingespeisten Resolver belegt, nicht mit einer
  echten TLS-Verbindung nach draussen. Diese Lücke steht seit Release 1.20
- Die Prüfung greift nur beim Verbindungsaufbau. Ein Empfänger, der während
  einer laufenden Verbindung die Adresse wechselt, ist damit nicht erfasst
- Kein Deployment-Weg für Function-Images
- Die Nebenläufigkeitsgrenze ist prozesslokal, nicht clusterweit
- Usage misst noch keine Produktoperationen automatisch mit
- SDK und CLI sind nur auf Linux belegt
