# Release 1.83.0 — Die Auswahl wird aufzählbar

Der offene Punkt aus `1.76`: Kein Console-Fluss für die Provider-Auswahl.
Dahinter steckte der **zehnte Fund** der Sprint-Klasse „gebaut und nie
gerufen": Der Provider-Katalog kannte `list()` seit `1.76` — gerufen hat es
niemand. Weder Console noch App konnten aufzählen, welche OIDC-Provider ein
Projekt überhaupt hat.

## Die Projektion

`listOidcProviders` liefert genau **zwei Felder** je Provider: Slug und
Issuer. Client-ID, Endpunkte und der Name der Secret-Umgebungsvariablen
bleiben drinnen — die Liste projiziert, sie reicht nicht durch. Genau diese
Eigenschaft ist das Mutationsziel des Releases.

## Die Flächen

- **Admin-Route** `GET …/auth/admin/providers`: dieselbe Session-Grenze wie
  die Nutzerliste daneben — Console-Session statt Projekt-Key, kein
  Query-Parameter, `private, no-store`.
- **Console**: Die AuthView zeigt statt des statischen „Configured by
  environment" die echten Slugs — über einen extrahierten, vertraglich
  geprüften Ladeweg (das Muster aus `1.82`).

## Zertifiziert

Gegen die zwei echten, getrennten Dex-Provider des Auth-Stacks (jetzt 7
Fälle): Die Liste nennt exakt `certification` und `partner` mit ihren
Issuern — und die Serialisierung enthält kein Client-, Secret-, Endpoint-
oder JWKS-Muster.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Projektion wird zur Durchreichung der vollen Provider-Objekte | **6 von 7** — genau der Projektions-Fall: die Liste trüge plötzlich Client-ID und den Namen der Secret-Umgebungsvariablen nach draussen |

## Belege

| Lauf | Manifest |
| --- | --- |
| Mailpit/Dex 7/7, exit 0 | `docs/evidence/2026-08-16/provider-list-run1.manifest.json` |
| Mailpit/Dex 7/7, exit 0 | `docs/evidence/2026-08-16/provider-list-run2.manifest.json` |
| Mutation 6/7 | `docs/evidence/2026-08-16/provider-list-mutation.manifest.json` |

44 Migrationen. Lokal: 1073 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Die öffentliche Login-Auswahl fehlt weiterhin** — die Admin-Route ist die
  Console-Fläche; ein App-seitiger Chooser (mit Projekt-Key, pre-auth) wäre
  eine eigene Grenze und ist bewusst nicht Teil dieses Slices.
- **Die React-Anzeige rendert ungeprüft** — geprüft ist der Ladeweg als
  Funktion, wie in `1.82`.
- **Kein `email_verified`-Erfordernis je Provider** — unverändert seit `1.76`.
