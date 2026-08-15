# Release 1.84.0 — Der Login kennt seine Türen

Der bewusst offene Punkt aus `1.83`: Die Admin-Route war die Console-Fläche —
eine App vor der Anmeldung konnte weiterhin nicht aufzählen, welche
OIDC-Provider es gibt. Jetzt kann sie: `GET …/auth/oidc/providers`, der
Login-Chooser.

## Die Grenze

Dieselbe pre-auth-Grenze wie `authorize` daneben: Projekt-Key, Origin-Gate,
CORS-Echo, `private, no-store`, keine Query-Parameter. Was zurückkommt, ist
die Zwei-Felder-Projektion aus `1.83` — Slug und Issuer, gegen zwei echte
Dex-Provider zertifiziert. Ein fremder Schlüssel bekommt **404, nicht 403**:
Er erfährt nicht, dass es das Projekt gibt — derselbe Vertrag wie an den
übrigen Auth-Routen, und der Testfall dieses Releases lernte ihn auf die
harte Tour.

## Nebenbefund mit Ursache

Der transiente Einzelfall aus `1.83` ist erklärt: Drei Quellscan-Verträge —
Zertifizierungszahlen, Routen-Grenzen, Erreichbarkeitsgraph — lesen
inzwischen jedes Manifest beziehungsweise jede Quelle und rissen unter der
I/O-Last eines vollen Suitenlaufs die 5-Sekunden-Voreinstellung. Alle drei
tragen jetzt explizite 30-Sekunden-Budgets — dieselbe Regel wie bei den
Webhook-Fällen aus `1.63`: **Budgets werden ausgesprochen, Aussagen nicht
abgeschwächt.**

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Schlüsselprüfung wird aus der Chooser-Route entfernt | **1 von 1075** — genau der Abweisungs-Fall: ein anonymer Aufrufer bekäme die Liste |

## Belege

Dieser Slice ändert keinen Dienst-Code; die lokale Suite ist die tragende
Evidenz:

| Lauf | Manifest |
| --- | --- |
| Vitest lokal 1075/1075, exit 0 | `docs/evidence/2026-08-16/login-chooser-run1.manifest.json` |
| Vitest lokal 1075/1075, exit 0 | `docs/evidence/2026-08-16/login-chooser-run2.manifest.json` |
| Mutation 1074/1075, exit 1 | `docs/evidence/2026-08-16/login-chooser-mutation.manifest.json` |

Stacks unverändert: PostgreSQL 155, MinIO/ClamAV 8, Mailpit/Dex 7. 44
Migrationen.

## Ehrlich offen

- **Das SDK kennt den Chooser nicht als typisierte Methode** — wer ihn nutzt,
  ruft die Route selbst.
- **Kein Stack-Fall spricht die Route über das Netz** — belegt ist sie lokal
  gegen die echte Grenz-Implementierung (Origin, Key-Bindung, CORS).
- **Kein `email_verified`-Erfordernis je Provider** — unverändert seit `1.76`.
