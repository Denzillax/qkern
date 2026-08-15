# Release 1.72.0 — Die Funktion läuft als Aufrufer

Sprosse 4 der Paritätsleiter ist **abgebaut**: Nach den Views (`1.71.0`) kann
die Generated Data API jetzt **Funktionen rufen** — `POST /rpc/<funktion>` mit
benannten Argumenten.

## Die Regeln

- **Nur `SECURITY INVOKER`.** Der Rumpf läuft als Aufrufer, die RLS der
  berührten Tabellen gilt. Eine `DEFINER`-Funktion liefe mit den Rechten ihres
  Eigentümers und wird abgewiesen — dieselbe Tür wie bei Views, mit demselben
  Code.
- **Die Flüchtigkeit entscheidet über die Transaktion.** Eine `VOLATILE`
  deklarierte Funktion darf schreiben; `STABLE` und `IMMUTABLE` laufen in
  derselben Lese-Transaktion wie ein Listenaufruf. Eine als stabil deklarierte
  Funktion, die doch schreibt, scheitert an `READ ONLY`, statt zu wirken.
- **Benannte Argumente, deklarierte Typen.** Gebunden wird parametrisiert mit
  Cast auf den introspektierten Typ; nur Typnamen, die sich gefahrlos
  interpolieren lassen, werden angenommen. Überladene Funktionen sind
  mehrdeutig und werden abgewiesen.
- Set-Ergebnisse sind auf das Zeilenlimit begrenzt; ein Beschnitt wird als
  `truncated` **genannt**, nicht verschwiegen. Gelesene Zeilen zählen als
  `database_row_reads`, wie überall.

## Zertifiziert

Gegen echtes PostgreSQL, in einem Fall mit sechs Zusagen:

- Die Set-Funktion sieht durch die RLS des Aufrufers: Mandant A findet nur A.
- Die flüchtige Funktion schreibt als Aufrufer — und ein Schreibversuch für
  einen fremden Mandanten scheitert an dessen `WITH CHECK`.
- Die `DEFINER`-Variante derselben Funktion wird nicht bedient.
- Unbekannte Funktion und fehlendes Pflichtargument sind Aufruffehler.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die `DEFINER`-Abweisung wird entfernt | **143 von 144** — genau der RPC-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 144/144, exit 0 | `docs/evidence/2026-08-16/rpc-run1.manifest.json` |
| PostgreSQL 144/144, exit 0 | `docs/evidence/2026-08-16/rpc-run2.manifest.json` |
| Mutation 143/144 | `docs/evidence/2026-08-16/rpc-mutation.manifest.json` |

41 Migrationen. Lokal: 1060 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Eigene Typen ausserhalb des Suchpfads sind nicht aufrufbar**: Der
  Typ-Cast lässt nur gefahrlos interpolierbare Namen zu, und
  schema-qualifizierte fallen heraus. Das ist eine bewusste Grenze, keine
  Vergesslichkeit — sie steht hier statt zwischen den Zeilen.
- **Die RPC-Route ist lokal ungetestet über HTTP** — der Zertifizierungsfall
  ruft den Dienst; die Route spiegelt die Tabellenroute und teilt deren
  Fehlergrenze, aber kein Fall spricht HTTP.
- **OpenAPI kennt `/rpc` nicht.** Wie die Views aus 1.71 wartet die
  Schema-Beschreibung auf einen eigenen Slice.
- **Prozeduren (`CALL`) sind nicht dabei** — nur Funktionen.
