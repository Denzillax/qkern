# Release 1.67.0 — Die erste Sprosse

Sprosse 1 der Paritätsleiter (`docs/PARITAET.md`): **Die sechs Metriken haben
Preise, und aus echten Zählern wird ein projizierter Monatsbetrag.**

## Was gebaut ist

- **Migration 0039** — `billing_rate_cards`: append-only wie das Audit-Log,
  und aus demselben Grund. Ein Preis, der rückwirkend umgeschrieben werden
  kann, taugt nicht als Grundlage einer Abrechnung; FORCE RLS ohne UPDATE- und
  DELETE-Policy lässt auch den Eigentümer nichts mehr umschreiben.
- **Ein Preis ist ein Bruch**: `unit_price_micros` je `per_units`. CHF 0.09 je
  Gigabyte sind 90000 Mikro-Franken je 10⁹ Bytes — je Byte wäre das keine
  ganze Zahl mehr. Gerechnet wird in BigInt, abgerundet auf den Mikro:
  der angebrochene Mikro-Franken gehört dem Kunden.
- **`BillingService`** — `setRate` nur für Operatoren (der Browser darf hier so
  wenig heran wie an Quota-Policies), `readBillingProjection` für Leser.
  Wirksam ist je Metrik die jüngste Zeile, deren Stichtag nicht in der Zukunft
  liegt; unbepreiste Metriken werden **genannt**, nicht übersprungen.
- **REST**: `GET …/usage/billing` — lesend, hinter demselben Schalter und
  derselben Fehlergrenze wie Usage, inklusive der 503-Regel aus `1.65.0`.
- Die Antwort trägt `kind: "projection"`. Sie ist **keine Rechnung**: keine
  Nummer, keine Fälligkeit, ein lebender Zähler eines offenen Fensters.

## Zertifiziert

Die Kette ist die echte: Nutzung über den **Usage-Dienst** verbucht (mit
Idempotenzschlüssel und verifier-only Ablage), Projektion durch die
Laufzeitrolle, RLS scharf. Vier Fälle:

- 1000 echte `queue_operations` × 250 Mikro → `0.250000` CHF, unbepreiste
  Metriken genannt.
- Ein späterer Stichtag schlägt einen früheren — in der Ordnung der Datenbank.
- Eine fremde Organisation sieht ein leeres Preisblatt.
- `UPDATE` und `DELETE` scheitern durch die Laufzeitrolle.

Dazu sieben lokale Fälle für die Rechenzusagen (Bruchpreis, Abrundung,
Zukunftspreis, Währungskonflikt, Rollen, Eingaben).

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| `ORDER BY effective_from DESC` → `ASC` — der älteste Preis gewinnt | **138 von 139** — genau der Fall „der neueste Preis gewinnt" |

## Belege

| Lauf | Manifest |
| --- | --- |
| PostgreSQL 139/139, exit 0 | `docs/evidence/2026-08-16/billing-run1.manifest.json` |
| PostgreSQL 139/139, exit 0 | `docs/evidence/2026-08-16/billing-run2.manifest.json` |
| Mutation 138/139 | `docs/evidence/2026-08-16/billing-mutation.manifest.json` |

39 Migrationen. Lokal: 1049 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Es gibt weiterhin keine Rechnung.** Die Projektion ist eine Auskunft über
  ein offenes Fenster. Rechnungslauf mit Periodenabschluss ist Sprosse 2.
- **Der Preis am Fensterende gilt für den ganzen Monat.** Wer mitten im Monat
  den Preis ändert, ändert die Projektion rückwirkend für das Fenster — die
  ehrliche Vereinfachung, solange es keinen Abschluss gibt.
- **Eine Währung je Organisation wird im Dienst geprüft, nicht von der
  Datenbank erzwungen.** Zwei parallele erste `setRate` mit verschiedenen
  Währungen könnten beide durchkommen.
- **`setRate` hat keine REST- und keine Console-Fläche.** Das ist Absicht
  (interne Autorität wie Quota-Policies), aber es heisst auch: Preise setzt
  heute nur Code.
- **Die REST-Route ist lokal getestet, nicht im Stack:** Der
  Zertifizierungslauf ruft den Dienst, nicht die HTTP-Schicht.
