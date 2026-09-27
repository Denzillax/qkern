# Release 2.60.0 – Anmelden ohne Passwort, vertrauen mit Grenze

Vier Platzhalter weniger. Zwei davon ersetzt eine Seite, die vor allem sagt,
was QKERN nicht hat.

## Was neu ist

- Ansicht Authentication, Passkeys: Anmeldung mit WebAuthn für die Projekt-Anmeldung, ohne fremde Bibliothek.
- Ansicht Authentication, Fremde Anbieter: die Data API nimmt ein Token eines fremden Ausstellers an, ohne dass es dafür ein Konto gibt.
- Ansicht Branches: drei feste Umgebungen mit echten Zahlen, und der Satz, dass es keine freien Zweige gibt. Sie ersetzt auch den Platzhalter für Merge-Anfragen.
- PostgreSQL-Zertifizierung von 211 auf 214 Fälle, lokale Suite von 2191 auf 2213.

## Die Grenzen, die den Ausschlag geben

- **Ein fremdes Token kommt höchstens als `authenticated` an, nie als `service_role`.** Diese Rolle umgeht in der Data API jede Policy. Wer sie einem Aussteller gibt, den QKERN nicht kontrolliert, hat die Zeilensicherheit an dessen Registrierungsseite delegiert. Die Grenze steht dreimal, weil sie einmal gemeint ist: im reinen Modul, als `CHECK` in der Migration und in der Eingangsprüfung der Data API. Ein Rollenanspruch mit einem anderen Wert ist eine Ablehnung, kein stilles Herunterstufen.
- **Das Signaturverfahren kommt aus der Positivliste und aus dem Schlüsseltyp, nie aus dem Header.** Ein `alg: none` und ein symmetrisches Verfahren mit dem öffentlichen Schlüssel als Geheimnis sind damit erledigt, bevor überhaupt ein Schlüssel gesucht wird.
- **Die Passkey-Herausforderung wird in der Datenbank verbraucht.** Ein Schreibzugriff, der nur bei einem leeren Feld setzt und nur dann eine Zeile zurückgibt, ist auch bei zwei gleichzeitigen Anfragen einmalig.
- **Der Zähler wird mit dem gelesenen Stand in der Bedingung geschrieben, bevor eine Sitzung entsteht.** Ein rückwärts laufender Zähler heisst geklonter Schlüssel.
- **Eine Umgebung ist kein Zweig.** Sie entsteht nicht auf Zuruf, sie verschwindet nicht nach dem Zusammenführen, und es gibt keine Abstammung zwischen ihnen.

## Was geprüft wird, und was geglaubt

Bei den Passkeys steht jede Auslassung als Satz auf der Seite. Geglaubt wird
die Attestation, weil es bei der verbreiteten Form keine prüfbare Aussage gibt;
ab der ersten Anmeldung wird gerechnet. Nicht gebaut sind Verfahren ausser
ES256, Passkeys über Unterdomänen und die Benutzerbestätigung als zweiter
Faktor. Der Zähler hilft nicht, wenn beide Seiten null führen, und ein Hersteller
tut das.

Die Sitzung entsteht auf demselben Weg wie bei einer Passwortanmeldung. Damit
laufen der Hook `sign_in` aus `2.59.0`, die MFA-Erzwingung und die Grenzen je
Zeitfenster mit. Es gibt keinen zweiten Weg zur Sitzung.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 17, 214/214, exit 0 | `docs/evidence/2026-09-27/welle12-run1.manifest.json` |
| PostgreSQL 17, 214/214, exit 0 | `docs/evidence/2026-09-27/welle12-run2.manifest.json` |
| Mailpit und Dex, 7/7, exit 0 | `docs/evidence/2026-09-27/welle12-auth.manifest.json` |
| Mutation verbrauchte Herausforderung kommt durch, exit 1 | `docs/evidence/2026-09-27/welle12-mutation-passkeys.manifest.json` |
| Mutation Verfahren aus dem Header, exit 1 | `docs/evidence/2026-09-27/welle12-mutation-thirdparty.manifest.json` |
| Mutation Ankunftszeitpunkt aus der Anlage, exit 1 | `docs/evidence/2026-09-27/welle12-mutation-branches.manifest.json` |
| Vitest lokal 2213/2213, exit 0 | `docs/evidence/2026-09-27/welle12-local-run1.manifest.json` |
| Vitest lokal 2213/2213, exit 0 | `docs/evidence/2026-09-27/welle12-local-run2.manifest.json` |

## Zwei Fehler im eigenen Fall

Beide hat der Lauf gegen die echte Datenbank gefunden, nicht der Entwurf.
PostgreSQL erlaubt in einem regulären Ausdruck höchstens 255 Wiederholungen,
die Prüfung in der Migration war also gar kein gültiges Muster. Und eine
Zusicherung war in einem von vier Läufen falsch: Ein Schlüssel im
DER-Format trägt seinen einen Teil im Klartext, und je nach erstem Byte des
anderen steht die gesuchte Zeichenkette wörtlich darin. Geprüft wird jetzt
gegen den privaten Teil.

## Nachtrag zum Verfahren

Der zweite Lauf ist an einer eigenen Zusicherung gescheitert, nicht am
Produkt. Ein Fall aus `2.53.0` sucht im serialisierten Audit nach der Zahl, die
in der Leckliste steht, und verlangt, dass sie nirgends vorkommt. Sie kam vor,
und zwar in einer zufälligen Kennung: Eine UUID hat 32 Hex-Stellen, und vier
davon treffen irgendwann jede vierstellige Zahl.

Die Erwartung ist dieselbe geblieben und schärfer geworden. Geprüft werden
jetzt die Werte der Metadaten, rekursiv, gegen die Zahl und gegen ihre
Schreibweise als Text. Das fällt auch dort, wo die Zahl als Zahl stünde. Es ist
dieselbe Falle wie in `2.44.0`, wo eine Suche nach `at ` auf das deutsche
"hat" angeschlagen hat: Eine Teilzeichenkette ist kein Beleg.

## Ehrlich offen

- **Keine Obergrenze für die Laufzeit eines fremden Tokens.** Ein Anbieter, der für ein Jahr ausgibt, gibt Zugang für ein Jahr.
- **Der Transport zum Schlüsselsatz ist im Fall gestellt**, weil die Adressprüfung eine öffentlich erreichbare Gegenstelle verlangt und das Zertifizierungsnetz keine hat. Die Adresspolicy selbst ist eigens zertifiziert.
- **Kein Löschweg für Administratoren**, wenn jemand sein einziges Gerät verliert. Heute hilft Passwort oder Magic Link.
- **Die Console kann keinen Passkey einrichten und keinen entfernen.** Die Verwaltungsroute liest nur.
- **Im Browser nicht gesehen.** Die drei neuen Ansichten sind angemeldet nie betrachtet worden.
