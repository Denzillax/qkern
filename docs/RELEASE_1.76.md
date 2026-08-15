# Release 1.76.0 — Zwei Provider, ein Konto, klare Grenzen

Sprosse 8 der Paritätsleiter: **Der Provider-Katalog ist gegen zwei echte,
getrennte OIDC-Gegenstellen belegt.**

## Was schon da war — und was fehlte

Der Katalog für mehrere benannte Provider existiert seit der OIDC-Einführung;
die Identitäten tragen seit jeher eine Provider-Spalte. Belegt war davon
**ein** Provider. Ob zwei Provider wirklich getrennt bleiben — ob ein State
des einen beim anderen etwas wert ist, ob Subject-Gleichheit Identitäten
vermischt — hatte nie eine echte Gegenstelle gesehen.

## Der Aufbau

Ein zweiter, eigenständiger Dex: eigener Issuer (`partner.qkern.test`),
eigene Schlüssel, eigenes Zertifikat, eigener Client. Derselbe Mensch
existiert bei beiden Providern unter derselben E-Mail, aber mit
verschiedenen Subjects — genau die Konstellation eines echten Social-Logins
über GitHub *und* Google.

## Zertifiziert

- **Ein Konto, zwei Identitäten**: Der Login über den zweiten Provider landet
  beim selben Auth-User — verknüpft über die **verifizierte E-Mail**, niemals
  über Subject-Gleichheit.
- **Ein State ist providergebunden**: Der Autorisierungs-State des einen
  Providers wird beim anderen mit `INVALID_TOKEN` abgewiesen — nicht erst am
  Code-Austausch, sondern an der Bindung selbst.
- **Ein unbekannter Slug existiert nicht** (`RESOURCE_NOT_FOUND`).

## Ein Fund am Werkzeug

Der erste Lauf scheiterte an `ENOTFOUND partner.qkern.test`: Das Startskript
des Auth-Stacks fährt seine Dienste **namentlich** hoch, und der neue Dex
stand in der Compose-Datei, aber nicht in der Liste — ein Dienst, der
existiert und nie läuft, diesmal am Zertifizierungswerkzeug selbst. Die Liste
trägt jetzt einen Kommentar, der genau davor warnt.

## Mutationsprobe

| Mutation | Ergebnis |
| --- | --- |
| Die Provider-Bindung des States wird entfernt | **5 von 6** — genau der Zwei-Provider-Fall: Der fremde State liefe bis zum Code-Austausch und scheiterte dort mit dem falschen Fehler |

## Belege

| Lauf | Manifest |
| --- | --- |
| Mailpit/Dex 6/6, exit 0 | `docs/evidence/2026-08-16/social-provider-run1.manifest.json` |
| Mailpit/Dex 6/6, exit 0 | `docs/evidence/2026-08-16/social-provider-run2.manifest.json` |
| Mutation 5/6 | `docs/evidence/2026-08-16/social-provider-mutation.manifest.json` |

Lokal: 1064 bestanden, 0 fehlgeschlagen.

## Ehrlich offen

- **Dex ist kein GitHub.** Belegt ist der OIDC-Vertrag gegen zwei echte,
  getrennte Provider; die Eigenheiten kommerzieller Anbieter (eigene Scopes,
  abweichende Claims, Raten) sind nicht belegt und brauchen echte
  Provider-Konten.
- **Die E-Mail-Verknüpfung vertraut der Verifizierung des Providers.** Ein
  Provider, der E-Mails nicht verifiziert, könnte ein Konto übernehmen; der
  Katalog kennt dafür noch kein `email_verified`-Erfordernis je Provider.
- **Kein Console-Fluss**: Der Katalog ist Dienst und REST; eine
  Provider-Auswahl in der Console-Auth-Fläche fehlt.
