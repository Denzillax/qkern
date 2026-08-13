# Release 1.59.0 — Eine Korrektur und ein abgebrochener Versuch

## Die Korrektur

Release 1.56, 1.57 und 1.58 haben übereinstimmend festgehalten, der Provisioner
brauche „einen Vault-Weg". **Das ist falsch.**

Sein Adapter ist `createSignedProjectProvisioningBrokerFromEnv` — ein signierter
HTTPS-Broker mit denselben vier Variablen wie beim Incident- und beim
Apply-Publisher: URL, erlaubte Hosts, Schlüsselkennung, Geheimnis. Der Vault
kommt an einer anderen Stelle vor, im Katalog des Migrations-Workers, und den
hatte ich mit dem Provisioner verwechselt.

Innerhalb von zwei Releases ist das die **zweite** Annahme derselben Art: In 1.58
war es der „Broker, den es im Stack nicht gibt". Beide Male hatte ich einen Namen
gelesen und nicht den Code. Wer eine Hürde behauptet, ohne sie geprüft zu haben,
verschiebt Arbeit, die keine gewesen wäre.

Die historischen Release Notes bleiben unverändert; `STATUS.md` nennt den Grund
jetzt richtig.

## Der abgebrochene Versuch

Empfängerpfad, Fixture und Fall standen. Der Prozess übernimmt den Auftrag
trotzdem nicht, sondern meldet `claim_failed`. Dahinter steckt ein
`PersistenceError` — dieselbe Verpackung wie in Release 1.48, und die Ursache
liegt wieder darunter.

Nach sieben Diagnosezyklen habe ich die Scheibe **zurückgenommen** statt sie
halbfertig abzulegen. Unbenutzter Test-Support wäre genau das Muster, das dieser
Sprint beseitigt hat: gebaut, und niemand ruft es auf.

## Was als Spur bleibt

Der Fehler tritt im Zweig `quarantineExpired` → `claimNext` auf, läuft bei
**jedem** Takt und verschluckt seine Ursache. In 1.48 war an genau dieser Stelle
eine mehrdeutige Spaltenreferenz der Grund; die hiesige Abfrage
`quarantineExpiredLeases` hat sie nicht, also liegt es woanders — die Rechte der
Provisioner-Rolle wären der nächste Kandidat.

Wer die Scheibe aufnimmt, beginnt am besten damit, den `PersistenceError` einmal
auszupacken, so wie es 1.48 nötig machte.

## Belege

Keine neuen Läufe: Dieses Release ändert keinen Code. Die Zahlen aus `1.58.0`
gelten unverändert — PostgreSQL 124 von 124, Functions 26 von 26, Empfänger
14 von 14, lokal 1023 bestanden.

## Ehrlich offen

- **Der siebte Prozess bleibt offen, und zwar aus einem Grund, den niemand
  kennt.** Das ist unangenehmer als der falsche Grund, den er vorher hatte — und
  ehrlicher.
- **Zwei falsche Annahmen in zwei Releases.** Beide entstanden beim Schreiben der
  „Ehrlich offen"-Liste, also genau dort, wo Sorgfalt am meisten zählt. Es gibt
  keine Prüfung, die eine behauptete Hürde gegen den Code hält.
