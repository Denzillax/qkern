# QKERN Developer Experience

Gültig für `@qkern/sdk` `1.7.0-alpha.3` und `@qkern/cli` `1.7.0-alpha.4` (beide auf npm, Tag `alpha`). Dieser Vertrag hält lokale Entwicklung reproduzierbar,
secretfrei und zwischen Shells übertragbar.

## Paketgrenzen

| Paket | Quelle | Build-Ausgabe | Verifiziert |
| --- | --- | --- | --- |
| `@qkern/sdk` | `sdk/typescript/src` | ESM, Source Maps, `.d.ts`, Declaration Maps | Import, Export-Manifest, Tarball |
| `@qkern/cli` | `cli/src` | Node.js ESM mit `qkern`-Shebang | Start, Fresh-Project, Tarball |

Beide Pakete bleiben in Alpha 3 `private`. Ein grüner Tarball-Test ist keine
Freigabe zum Registry-Publishing.

## Verbindliche Befehle

```powershell
npm ci
npm run build:packages
npm run verify:dx
npm run verify:packages
```

`npm run verify:dx:full` führt die letzten drei Befehle zusammen aus. Der Smoke-
Test erzeugt ein temporäres Projekt, prüft secretfreie Konfiguration, deterministische
Typen, nicht ausführenden Migration-/Seed-Vertrag, SDK-ESM-/DTS-Import und die
kompilierte CLI. Temporäre Dateien werden danach entfernt.

## Betriebssystemmatrix

`.github/workflows/developer-experience.yml` definiert denselben Vertrag auf
Ubuntu, Windows und macOS mit Node 24.7.0. Der lokale Release-Nachweis lautet:

| Umgebung | Ergebnis in diesem Workspace |
| --- | --- |
| Linux x64, Node 24 | grün |
| Windows, Node 24 | vorbereitet, nicht ausgeführt |
| macOS, Node 24 | vorbereitet, nicht ausgeführt |

Erst tatsächlich grüne, archivierte Runnerläufe dürfen die letzten beiden Zeilen
auf „bestanden“ ändern. Ein Workflow-File allein ist keine Cross-Platform-Evidenz.

## Upgrade- und Publishing-Grenze

Fresh-Project ist geprüft; Upgrade eines bestehenden Projekts, Registry-Installation,
Signatur/Provenance und Kompatibilitätsmatrix sind offen. Vor Publishing müssen
Lizenz, semantische API-Stabilität, Paket-Signatur, SBOM, Changelog und echte
Windows-/macOS-/Linux-Läufe freigegeben werden.
