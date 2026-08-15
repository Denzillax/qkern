# Release 1.80.0 — Das Dokument sagt die Wahrheit

Die offenen Punkte aus `1.71` und `1.72`: Das OpenAPI-Dokument der Generated
Data API kannte weder die Nur-Lese-Natur der Views noch die `/rpc`-Pfade.
Jetzt beschreibt es beide — **nach denselben Grenzen, nach denen die Fläche
bedient**. Was die Fläche abweist, wird nicht beworben.

## Views im Dokument

Ein View erscheint nur mit `security_invoker` — dieselbe Bedingung, unter der
die Fläche ihn überhaupt bedient. Er trägt genau **ein** Verb (GET) und eine
Pflicht-Sortierspalte (`column.asc` oder `column.desc`): Ein View hat keinen
Primärschlüssel, der eine Ordnung implizieren könnte, und Cursor werden
abgewiesen statt still falsch zu blättern.

## RPC im Dokument

Eine Funktion erscheint nur, wenn `callFunction` sie annähme: SECURITY
INVOKER, ausführbar, nicht überladen, benannte Argumente mit sicheren Typen.
Die Volatilität steht im Summary, weil sie das Verhalten bestimmt — alles
ausser `volatile` läuft in einer READ-ONLY-Transaktion und kann nicht
schreiben. Argumente mit Default sind optional, Pflichtargumente stehen in
`required`. Überladungen bleiben in der Abfrage sichtbar und schliessen den
Namen vollständig aus — statt zufällig einen Rumpf zu dokumentieren.

## Zertifiziert

Gegen echtes PostgreSQL (jetzt 154 Fälle): Der invoker-View steht mit genau
einem GET und Pflicht-`order` im Dokument, der View ohne `security_invoker`
fehlt ganz; die stabile Funktion trägt „read-only", die flüchtige „write
transaction"; DEFINER und Überladung fehlen — genau wie beim Aufruf selbst.
Die Tabelle daneben behält alle gewährten Verben.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die `security_invoker`-Bedingung wird aus dem Views-Filter entfernt | **153 von 154** — genau der OpenAPI-Fall: Das Dokument bewürbe einen View, den die Fläche mit demselben Code abweist wie eine Tabelle ohne RLS |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 154/154, exit 0 | `docs/evidence/2026-08-16/openapi-views-rpc-run1.manifest.json` |
| PostgreSQL 154/154, exit 0 | `docs/evidence/2026-08-16/openapi-views-rpc-run2.manifest.json` |
| Mutation 153/154 | `docs/evidence/2026-08-16/openapi-views-rpc-mutation.manifest.json` |

43 Migrationen. Lokal: 1065 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Höchstens 200 Funktionen je Schema** landen im Dokument — mehr kappt es
  bewusst, und das Dokument selbst trägt keine Hinweiszeile darüber.
- **Die RPC-Antwortschemata sind generisch** (`type: object`), nicht aus dem
  Rückgabetyp abgeleitet.
- **Typen ausserhalb des Suchpfads** bleiben aussen vor — wie beim Aufruf
  selbst, und aus demselben Grund.
