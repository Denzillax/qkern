import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    coverage: { reporter: ["text", "json"] },
    // `.claude` enthaelt Worktrees mit einer vollstaendigen Kopie dieses
    // Baums. Ohne diesen Ausschluss laeuft die Suite doppelt: einmal fuer den
    // Arbeitsstand und einmal fuer einen fremden Branch — und die Zahl im
    // Checkpoint waere die Summe aus beidem.
    //
    // Gefunden in Release 1.45, als ein Zertifizierungslauf Fehler in Dateien
    // unter `.claude/worktrees/…` zeigte. Dieselbe Luecke bestand im `tar` der
    // Compose-Stacks.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/**"],
  },
});
