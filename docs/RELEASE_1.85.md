# Release 1.85.0 — Wer bürgt, sagt es

Der offene Punkt aus `1.76`: ein `email_verified`-Erfordernis je Provider.
Bis jetzt galt hart und global `email_verified === true` — die strengste
denkbare Regel, und zugleich eine, die Provider ohne diesen Claim (real
häufig) stumm ausschloss. Jetzt sagt jeder Katalogeintrag, was gilt.

## Die Regel

`emailVerification: "required" | "trusted"` je Provider:

- **required** (Voreinstellung): Das ID-Token muss `email_verified: true`
  tragen — unverändert das bisherige Verhalten.
- **trusted**: Der Operator bürgt für einen Provider, der den Claim nicht
  sendet. Ein **fehlender** Claim wird akzeptiert. Ein explizites `false`
  bleibt in jedem Modus eine Abweisung — **trusted heisst „ohne Claim", nie
  „gegen den Claim".** Genau diese Grenze ist das Mutationsziel.

Ein unbekannter Modus ist ein Konfigurationsfehler beim Laden des Katalogs,
kein stilles Zurückfallen auf required.

## Zertifiziert

Der Auth-Stack mit zwei echten, getrennten Dex-Providern belegt den
unveränderten echten Pfad (beide senden `true`): 7 von 7, zweimal. Die
Matrix — required ohne Claim abgewiesen, trusted ohne Claim akzeptiert,
trusted mit `false` abgewiesen, unbekannter Modus abgewiesen — ist lokal
gegen dieselbe `verifyIdToken`-Implementierung belegt, die der Stack
durchläuft.

## Fund nebenbei: die Kalender-Bombe

`tests/auth-service.test.ts` fragte an einer Stelle die **echte** Uhr,
während der Dienst auf den 17. Juli 2026 fixiert ist. Im August bestand der
Fall zufällig; am 24. September war die fixierte Session abgelaufen, und er
fiel deterministisch — in beiden ersten Läufen dieses Releases. Behoben: Die
Fixture reicht `now()` durch. Der Produktcode war nie betroffen; er nutzt
konsequent seine eigene Uhr.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| trusted schluckt auch ein explizites `email_verified: false` | **1 von 1076** — genau der Matrix-Fall |

## Belege

| Lauf | Manifest |
| --- | --- |
| Mailpit/Dex 7/7, exit 0 | `docs/evidence/2026-09-24/email-verified-run1.manifest.json` |
| Mailpit/Dex 7/7, exit 0 | `docs/evidence/2026-09-24/email-verified-run2.manifest.json` |
| Vitest lokal 1076/1076, exit 0 | `docs/evidence/2026-09-24/email-verified-local-run1.manifest.json` |
| Vitest lokal 1076/1076, exit 0 | `docs/evidence/2026-09-24/email-verified-local-run2.manifest.json` |
| Mutation 1075/1076, exit 1 | `docs/evidence/2026-09-24/email-verified-mutation.manifest.json` |

Stacks sonst unverändert: PostgreSQL 155, MinIO/ClamAV 8. 44 Migrationen.

## Ehrlich offen

- **Der Trusted-Positivfall ist nicht gegen eine echte Gegenstelle belegt** —
  beide Stack-Provider senden den Claim; ein Provider, der ihn weglässt,
  müsste erst in den Stack.
- **Der Modus lebt nur im Katalog-JSON** — die Console zeigt ihn nicht.
- **Ablage**: Das Repo liegt seit der Neustrukturierung vom 11. September
  unter `C:\Projekte\!!!\QKERN`; `C:\Projekte\QKERN\code` ist ein leeres
  Git-Gerüst. Wohin es gehört, entscheidet der Eigentümer — dieser Release
  verschiebt nichts.
