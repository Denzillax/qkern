# QKERN 1.0 Release Candidate 2 — Brand Typography

## Ergebnis

RC2 ersetzt die bisher nur als System-Fallback deklarierte Inter-Schrift durch
die lokal gebündelte variable Manrope-Familie. Dadurch bleibt die Darstellung
auf Windows, macOS und Linux konsistent und benötigt weder Google-Fonts-Aufrufe
noch eine externe Font-CDN.

## Typografischer Vertrag

- Manrope Variable für Oberfläche, Formulare, Navigation und Überschriften
- unveränderte System-Monospace-Schrift für SQL, Code, Pins und technische Labels
- variable Gewichte für ruhigere, präzisere Headlines
- deaktivierte synthetische Schriftschnitte und geglättete Bildschirmdarstellung
- keine Änderung an Auth-, Tenant-, Approval-, MCP- oder Production-Grenzen

RC1 bleibt der unveränderte Production-Readiness-Vertrag; RC2 ist dessen
visuell konsolidierte, funktional kompatible Nachfolgeversion.

## Validierung

- Strict Typecheck: erfolgreich
- Vitest: 513 bestanden, 9 Real-PostgreSQL-Tests ohne bereitgestellten Dienst übersprungen
- Next.js Production Build: erfolgreich
- keine externen Font-Requests und keine Änderung an den Sicherheitsgrenzen
- MCP SDK 1.30.0 und PostCSS 8.5.25 schließen die zuvor offenen Transitivbefunde
