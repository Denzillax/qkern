import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Jeder Zertifizierungslaeufer muss seinen Stack benennen lassen (2.123).
 *
 * **Der Befund, der dahinter steht.** Bis 2.72.0 lasen nur fuenf der acht
 * Laeufer `COMPOSE_PROJECT_NAME`. Die drei anderen (Backup, Empfaenger, Vault)
 * trugen einen festen Projektnamen im Quelltext. Zwei parallele Schnitte, die
 * denselben Stack fahren, bekommen damit dieselben Containernamen, und das
 * abschliessende `down --volumes --remove-orphans` des einen reisst den
 * laufenden Stack des anderen ab. Der Fehlschlag sieht dann wie ein Befund des
 * Produkts aus und ist keiner.
 *
 * **Warum ein Vertrag und keine einmalige Korrektur.** Ein neunter Stack wird
 * aus einem der acht kopiert, und der feste Name kopiert sich mit. Dieser
 * Vertrag findet die Laeufer ueber das Dateisystem, also faellt er, sobald
 * einer dazukommt, der die Variable nicht liest.
 *
 * **Was er nicht kann.** Er liest Quelltext und startet keinen Container. Dass
 * `up` und `down` wirklich denselben Namen tragen, prueft er daran, dass beide
 * dieselbe `compose`-Liste benutzen; ein Laeufer, der sich den Namen zweimal
 * zusammenbaut, kaeme hier durch. Darum verlangt er genau **eine** Lesung der
 * Variablen je Datei.
 */
const RUNNERS = fs
  .readdirSync(path.resolve(process.cwd(), "scripts"))
  .filter((name) => /-certification\.mjs$/.test(name))
  .sort();

describe("certification runner isolation contract", () => {
  it("finds every certification runner on disk", () => {
    // Acht Stacks: PostgreSQL, Storage, Auth, Vault, Functions, Backup,
    // Empfaenger, Realtime. Faellt diese Zusage, ist einer dazugekommen oder
    // verschwunden, und die Zusagen darunter sind dann noch nicht geprueft.
    expect(RUNNERS).toEqual([
      "auth-certification.mjs",
      "backup-certification.mjs",
      "functions-certification.mjs",
      "postgres-certification.mjs",
      "realtime-certification.mjs",
      "receiver-certification.mjs",
      "storage-certification.mjs",
      "vault-certification.mjs",
    ]);
  });

  it.each(RUNNERS)("lets a parallel slice name the stack of %s", (name) => {
    const runner = fs.readFileSync(
      path.resolve(process.cwd(), "scripts", name),
      "utf8",
    );

    expect(runner).toContain("process.env.COMPOSE_PROJECT_NAME?.trim() ||");
    // Genau einmal gelesen: Zwei Lesungen koennen auseinanderlaufen, und dann
    // raeumt `down` einen anderen Stack ab als `up` gestartet hat.
    expect([...runner.matchAll(/process\.env\.COMPOSE_PROJECT_NAME/g)]).toHaveLength(1);
    // Ohne gesetzte Variable bleibt der Name von vorher stehen, damit die
    // archivierte Evidenz denselben Stack nennt wie die Laeufe davor.
    expect(runner).toMatch(/\|\|\s*"qkern-[a-z0-9-]+"/);
    // Der Name steht in einer Liste, die `up` und `down` teilen.
    expect([...runner.matchAll(/\.\.\.compose\b/g)].length).toBeGreaterThanOrEqual(1);
  });

  it.each(RUNNERS)("cleans containers and volumes after every run of %s", (name) => {
    const runner = fs.readFileSync(
      path.resolve(process.cwd(), "scripts", name),
      "utf8",
    );

    // `--remove-orphans` gehoert dazu: Ein Dienst, der aus der Compose-Datei
    // verschwindet, bleibt sonst als Waise mit altem Image stehen und der
    // naechste Lauf misst ihn mit.
    expect(runner).toMatch(/"down",\s*"--volumes",\s*"--remove-orphans"/);
  });
});
