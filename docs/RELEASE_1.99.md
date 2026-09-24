# Release 1.99.0 — Die Console spricht Deutsch

Der Auftrag war, die Console durch den Skill `humanizer` zu ziehen. Beim
Lesen fiel zuerst die Sprache auf, dann etwas Schwereres.

## Eine Sprache

Die Console mischte Englisch aus dem MVP mit Deutsch aus späteren Slices.
Jetzt ist sie durchgehend deutsch; Produktbegriffe bleiben englisch: Table
Editor, SQL Editor, Change Set, RLS, Storage, Functions. Rund 200
Zeichenketten in `console-app.tsx`.

## Keine erfundenen Werte

Die Console zeigte Zahlen, die kein Dienst liefert: Deltas an den Kacheln,
24 Balken Verlauf, „p95 184 ms", Latenzen von fünf Diensten, eine
Datenbank „nova-market-dev" mit Pool 12/100, sechs Demo-Tabellen, zwei
„verbundene" Agenten, Badges in der Navigation. Der Skill sagt: nichts
erfinden. Was nicht verbunden ist, sagt das jetzt selbst, wie in `1.93`.
Die Kacheln zeigen den Projektdatensatz ohne Deltas; Verlauf, Dienststatus,
Datenbank-Provisionierung und Agentenverbindung sind Platzhalterkarten;
die Datenbank-Ansicht verweist auf den Table Editor, der wirklich live
liest. Das Freigabe-Badge zählt echte offene Freigaben, der
Projekt-Umschalter zeigt den echten Workspace, „Verbunden" erscheint nur
bei geladenem Snapshot.

## Im Browser geprüft

In der angemeldeten Session: Übersicht, Datenbank, AI Bridge,
Freigabezentrale und Einstellungen zeigen die neuen Texte. Das
Schliessen-Kreuz der Sidebar aus `1.97` ist auf dem Telefon sichtbar.

## Belege

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/console-german-local-run1.manifest.json` |
| Vitest lokal 1096/1096, exit 0 | `docs/evidence/2026-09-24/console-german-local-run2.manifest.json` |

Stacks unverändert, kein Server-Code berührt.

## Ehrlich offen

- **Login und Registrierung** sind noch nicht durch den Skill gelaufen.
- **Werte aus der API** wie `active`, `pending` oder `delivered` bleiben
  englisch; sie sind Daten, keine Texte.
