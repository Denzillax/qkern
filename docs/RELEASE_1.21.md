# Release 1.21.0 — Fläche für Definitionen

> Datum: 5. August 2026 · Vorgänger: `1.20.0`

## Wofür dieses Release steht

Seit Release 1.20 arbeitet ein Prozess Cron-Vorkommen ab und stellt Webhooks zu.
Aber niemand konnte ihm ohne `psql` sagen, was er tun soll: Definitionen
entstanden ausschliesslich über direkten Datenbankzugriff.

Dieses Release ergänzt REST-Endpunkte, eine Console-Fläche und die dazugehörige
Berechtigung.

## Verifizierter Stand

| Prüfschritt | Ergebnis |
| --- | --- |
| PostgreSQL-17-Zertifizierung | **78 von 78 bestanden**, exit 0, 16 Testdateien, 32 Migrationen |
| Reproduzierbarkeit | zweimal grün **vor** dem Release-Commit |
| davon Definitionsfläche | 7 Fälle |
| Mutationsprobe | zwei Garantien einzeln abgeschaltet → genau 2 Fälle fallen um |
| Vitest lokal | 866 bestanden, 0 fehlgeschlagen |
| Strict TypeScript · Build · Audit | grün · grün · 0 Schwachstellen |

Evidenz: `docs/evidence/2026-08-05/compute-definitions-*`.

## Nur `enabled` ist änderbar

Migration 0031 hatte diese Entscheidung bereits getroffen und begründet:
Ausdruck, Queue und Nutzlast eines Cron-Jobs bleiben unveränderlich, eine
Änderung erfolgt über Löschen und Neuanlegen. Dieses Release wendet dieselbe
Regel auf Webhooks an, statt sie für eine bequemere API aufzuweichen.

Der Preis ist eine neue Id bei jeder Änderung. Der Gewinn ist, dass ein
Zustellversuch niemals gegen eine Definition läuft, die sich zwischen Auslösen
und Senden verändert hat — und dass die Unveränderlichkeit im **Spaltenrecht**
liegt, nicht in einer Prüfung im Dienst. Ein zweiter Schreiber könnte eine
Prüfung umgehen; das Spaltenrecht nicht. Genau das zeigt einer der
Zertifizierungsfälle: Die Runtime-Rolle bekommt `permission denied`, wenn sie
den Ausdruck oder die Ziel-URL ändern will.

## Eine Regel, zwei Aufrufer

`isDeliverableWebhookTarget` prüft jetzt sowohl beim Anlegen als auch beim
Zustellen. Fielen beide auseinander, könnte ein Betreiber einen Webhook anlegen,
den der Betrieb anschliessend bei jedem Versuch stumm abweist — und das sähe aus
wie ein defekter Empfänger, nicht wie eine abgelehnte Eingabe.

Dasselbe gilt für Cron: Der Ausdruck wird beim Anlegen mit **demselben Parser**
geprüft, den der Scheduler benutzt, und die Zielqueue muss existieren. Sonst
entstünde ein Zeitplan, der bei jedem Vorkommen scheitert und dabei aussieht,
als liefe er.

## Löschen ist zweistufig

Ein Webhook lässt sich nur löschen, wenn er vorher abgeschaltet wurde. Das
Löschen entfernt über den Fremdschlüssel auch alle wartenden Zustellungen; der
Umweg über das Abschalten macht daraus zwei bewusste Schritte und gibt dem
Betreiber dazwischen einen Zustand, in dem nichts Neues geholt wird und er die
offenen Zustellungen noch sehen kann.

## Status ohne Nutzlast

`GET .../webhooks/{id}/deliveries` beantwortet die Frage eines Betreibers: Kommt
etwas an, und wenn nicht, warum. Der Inhalt der Nachricht beantwortet sie nicht
und gehört dem Projekt — die Übersicht kopiert ihn deshalb nicht in eine zweite
Fläche mit eigenem Zugriffsweg. Der Dead-Letter-Pfad der Queues hält es genauso.

## Die Mutationsprobe

Auch dieses Mal waren alle sieben Fälle im ersten Lauf grün. Wie in Release 1.20
wurden deshalb zwei Garantien einzeln abgeschaltet — die Löschvorbedingung und
das Weglassen der Nutzlast — und der Stack erneut ausgeführt. Ergebnis: **genau
die zwei zugehörigen Fälle fallen um, kein anderer.**

## Neue Berechtigung

`project_compute_admin`, nur für `owner` und `administrator`. Wer sie nicht hat,
erhält 404 statt 403: Wer nicht darf, soll nicht erfahren, dass es die Ressource
gibt.

## Ehrlich offen

- Functions-Sandbox: nur Vertragsport, keine Laufzeit
- Kein Vault-gestützter Signaturschlüssel-Provider; die Fläche nimmt nur die
  Referenz entgegen, den Schlüssel selbst muss ein Betreiber weiterhin über die
  Umgebung bereitstellen
- Keine automatische Entdeckung der zu bedienenden Scopes
  (`QKERN_COMPUTE_SCOPES_JSON` bleibt Handarbeit)
- SDK und CLI kennen die Definitionsfläche nicht
- Kein manuelles Auslösen eines Cron-Vorkommens und kein Wiederholen einer
  toten Zustellung über die Fläche
- Kein startbarer Handler-Host für Queues
- Kein Scheduler für die beiden Realtime-`prune`-Pfade
