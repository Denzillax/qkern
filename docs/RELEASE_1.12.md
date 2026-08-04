# Release 1.12.0 — Change Capture Foundation

> Datum: 4. August 2026 · Vorgänger: `1.11.0`

## Wofür dieses Release steht

Release 1.11 hat Realtime dauerhaft und instanzübergreifend gemacht. Für den
Abschluss von Stufe 1.5 fehlen **Postgres Changes**: Datenbankänderungen, die in
Channels strömen, mit RLS pro Ereignis.

Dieses Release trifft die drei Entwurfsentscheidungen, die dafür offen waren,
und baut die Erfassungs-, Lese- und Autorisierungsschicht. Die Verdrahtung in
den Zustellpfad steht noch aus und ist als solche ausgewiesen.

## Die drei Entscheidungen

### Quelle: Trigger, nicht logische Replikation

`db/project/0001` prüft für jede Rolle einer Projektdatenbank ausdrücklich
`rolreplication = false`. Logische Replikation zu verwenden hieße, diese
Zusicherung umzukehren und jeder Kundendatenbank ein Replikationsrecht zu geben.
Dazu käme ein Replikations-Slot, der bei hängendem Konsumenten unbegrenzt WAL
hält, bis die Platte voll ist — ein Betriebsrisiko, das der Kunde trägt und
QKERN nicht begrenzen kann.

Trigger sind begrenzbar: Der Feed hat Größengrenzen und Aufbewahrung, und das
Anschalten je Tabelle ist eine Schemaänderung, die den vorhandenen Change-Set-
und Approval-Weg durchläuft.

Der Preis ist Ehrlichkeit wert: Trigger fassen das Kundenschema an, und jede
erfasste Tabelle kostet Schreiblatenz. Supabase löst das über Replikation, weil
es die ganze Datenbank inklusive Superuser kontrolliert. QKERN kontrolliert sie
nicht.

### Nutzlast: keine gespeicherten Zeilenwerte

`qkern_internal.change_feed` hält ausschließlich Primärschlüsselwerte, begrenzt
auf 4096 Byte. Die Zeile wird je Abonnent frisch mit dessen Claims gelesen.

Damit autorisiert und erzeugt Row Level Security die Nutzlast in einem Schritt.
Lägen die Werte im Feed, bräuchte es eine zweite Sichtbarkeitsprüfung außerhalb
der Datenbank — eine Kopie der RLS-Logik und damit eine dauerhafte Fehlerquelle.

Gelesen wird durch die **Generated Data API**, nicht über eine eigene Abfrage.
Sie prüft bereits Live-Schema, Primärschlüsselbindung, RLS, Rolle, Datenbank und
Read-only-Zustand der Verbindung, parametrisiert jeden Wert und entfernt Spalten
mit sensitivem Namen. Diese Grenze ein zweites Mal zu implementieren hieße, zwei
Kopien davon zu pflegen.

### Löschungen erreichen nur `service_role`

Nach einem `DELETE` existiert die Zeile nicht mehr; RLS kann nicht mehr
beantworten, wer sie hätte sehen dürfen. Den Schlüssel trotzdem an alle
Kanalabonnenten zu melden, würde die Existenz eines Datensatzes offenlegen, den
manche nie sehen durften.

Löschungen erreichen deshalb ausschließlich Abonnenten mit `service_role`. Das
ist eine bewusste Funktionslücke gegenüber Supabase, dokumentiert und getestet.

## Was gebaut ist

- `db/project/0003_qkern_change_feed.sql`: Feed-Tabelle und `SECURITY DEFINER`
  Trigger-Funktion mit festem `search_path`. Die Laufzeitrolle darf lesen und
  aufräumen, aber **niemals schreiben** — ein erfundenes Änderungsereignis würde
  einen Lesevorgang mit fremden Claims auslösen. Eine Tabelle ohne
  Primärschlüssel wird abgewiesen statt still übersprungen.
- `PostgresRealtimeChangeSource`: liest den Feed zustandslos ab einer Position,
  mit Grenzen für Limit, Operation und Positionsbereich.
- `GeneratedApiRealtimeChangeReader`: liest die Zeile mit den Claims des
  Abonnenten, fail-closed bei jedem Fehler.
- 14 Tests, die die Sicherheitsentscheidungen festhalten, darunter der Nachweis,
  dass die Migration keine Zeilenwerte speichert und der Laufzeitrolle kein
  `INSERT` gewährt.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| Vitest lokal | 734 bestanden, 57 übersprungen, 0 fehlgeschlagen |
| PostgreSQL-17-Zertifizierung | 33 von 33 bestanden, exit 0 |
| Strict TypeScript | grün |

## Ausdrücklich offen

**Stufe 1.5 bleibt offen.** Dieses Release liefert die Erfassungsschicht, nicht
den fertigen Kanal.

- **Verdrahtung in den Zustellpfad**: ein `changes:`-Kanalpräfix, das Abonnenten
  tatsächlich beliefert, samt Rückstauverhalten. Entschieden ist bereits, wie es
  sich verhalten soll — ein Abonnent, der nicht mitkommt, verliert sein
  Abonnement mit eigenem Fehlercode statt still übersprungen zu werden.
- **Zertifizierung des Triggers gegen eine echte Projektdatenbank**: Die
  Trigger-Funktion ist nicht-trivialer plpgsql und wurde bisher nur statisch
  geprüft. Sie ohne echten Lauf als funktionsfähig auszuweisen wäre genau der
  Fehler, den die Releases 1.9 bis 1.11 aufgedeckt haben.
- Drop-, Reconnect-, Soak- und Lasttests
- Aufbewahrung im Betrieb: `prune` existiert auf beiden Seiten, wird aber von
  keinem Scheduler aufgerufen
