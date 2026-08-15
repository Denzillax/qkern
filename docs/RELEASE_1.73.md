# Release 1.73.0 — Das Verbot wird ein Tor

Sprosse 5 der Paritätsleiter: **Das bedingungslose Production-Verbot des
Realtime-Transports ist durch ein Tor mit benannten, einzeln geprüften
Bedingungen ersetzt.**

## Warum jetzt

Das Verbot aus Alpha 1 nannte seine Gründe selbst: „Production requires the
documented TLS, persistent event-log and fan-out gates." Zwei der drei sind
seither gebaut und zertifiziert — der dauerhafte Log seit `1.11`, der
instanzübergreifende Fan-out seit `1.16`. Ein Verbot, dessen Gründe erfüllt
sind, ist keine Sicherheit mehr, sondern eine Erinnerung.

## Das Tor

Production startet genau dann, wenn **jede** Bedingung hält, und jede
verletzte nennt sich selbst:

| Bedingung | Grund |
| --- | --- |
| dauerhafter Log (kein `EPHEMERAL_LOG`) | der Memory-Log verliert bei jedem Neustart alles und erreicht keine zweite Instanz |
| `CURSOR_SECRET` mit ≥ 32 Bytes | sonst überlebt kein Replay-Cursor einen Neustart, und keine zweite Instanz kann ihn prüfen |
| `RETENTION_SCOPES_JSON` nicht leer | sonst wächst der dauerhafte Log unbeobachtet |
| https-only Origin-Allowlist | ein http-Origin ist in Production keiner |
| bei öffentlichem Binding: `TLS_TERMINATED=proxy` | der Transport spricht `ws` ohne TLS; die Attestierung ist genau das — eine Attestierung, kein Beweis, und sie steht da, damit niemand sie versehentlich gibt |

Ein Binding jenseits von Loopback verlangt in **jeder** Umgebung ein
ausdrückliches `QKERN_REALTIME_PUBLIC_BIND=true`. Ohne neue Variablen ist das
Verhalten unverändert: Loopback, wie immer.

## Zertifiziert

- **Die Abweisung als Prozess**: Alle Bedingungen erfüllt bis auf eine (der
  Memory-Log ist an) — der ausgelieferte Worker weigert sich zu lauschen und
  **benennt** die Bedingung, statt pauschal zu verbieten.
- **Das öffentliche Binding arbeitet wirklich**: Mit dem Opt-in lauscht der
  Prozess auf `0.0.0.0`, und ein echter Client authentifiziert sich über
  einen echten Projekt-Key.
- Dazu vier lokale Fälle, die jede Bedingung einzeln rot und die vollständige
  Production-Umgebung grün sehen.

Der alte Vertrag, der das bedingungslose Verbot festschrieb, ist auf das Tor
fortgeschrieben: Er verlangt jetzt, dass der Prozess durch das Tor geht und
das Tor keine seiner fünf Bedingungen verliert.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Log-Bedingung wird aus dem Tor entfernt | **145 von 146** — genau der Abweisungsfall: ein Production-Prozess mit flüchtigem Log würde lauschen |

## Ein Befund am Rand

Der erste Lauf des Abweisungsfalls scheiterte **vor** dem Tor: Die
Pool-Konfiguration verlangt in Production `DATABASE_SSL=require` und läuft
beim Import, vor jedem Realtime-Code. Der Fall setzt `require`; verbunden wird
nie, weil das Tor zuerst wirft. Die Reihenfolge ist damit dokumentiert: Die
SSL-Regel steht vor dem Tor.

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 146/146, exit 0 | `docs/evidence/2026-08-16/production-gate-run1.manifest.json` |
| PostgreSQL 146/146, exit 0 | `docs/evidence/2026-08-16/production-gate-run2.manifest.json` |
| Mutation 145/146 | `docs/evidence/2026-08-16/production-gate-mutation.manifest.json` |

41 Migrationen. Lokal: 1064 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Ein vollständiger Production-Start ist nicht belegt.** Der Wegwerfstack
  hat kein SSL-PostgreSQL, und Production verlangt es vor dem ersten
  Realtime-Byte. Belegt sind die Abweisung mit benannter Bedingung und das
  öffentliche Binding ausserhalb von Production.
- **Die TLS-Attestierung ist keine Prüfung.** Der Prozess kann einen davor
  liegenden Proxy nicht verifizieren; er kann nur verlangen, dass jemand die
  Behauptung ausdrücklich aufschreibt.
- **History und Presence liegen weiterhin im Prozessspeicher** — das Tor
  ändert daran nichts, und die Grenze steht weiter in `STATUS.md`.
