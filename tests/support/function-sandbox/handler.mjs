// Testfunction fuer die Sandbox-Zertifizierung.
//
// Eine einzige Function deckt alle Faelle ab; der Modus kommt aus der Nutzlast.
// So braucht die Zertifizierung genau ein Image, und jeder Fall laeuft gegen
// dieselben Container-Flags.
//
// Das Protokoll ist zeilenweises JSON in beide Richtungen. Die Runtime schickt
// zuerst den Aufruf; danach beantwortet sie jede Bitte um eine
// Ausgangsverbindung. Der Container selbst hat **kein Netz** — das ist der
// Grund, warum es diesen Kanal ueberhaupt gibt.

import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();

const first = await iterator.next();
const request = JSON.parse(first.value);
const mode = request.payload?.mode ?? "echo";

const waiting = new Map();
let nextId = 0;

/** Bittet die Runtime um eine Ausgangsverbindung und wartet auf ihr Urteil. */
function egress(target) {
  const id = String(++nextId);
  process.stdout.write(`${JSON.stringify({ type: "egress", id, request: target })}\n`);
  return new Promise((resolve) => waiting.set(id, resolve));
}

// Antworten der Runtime zustellen, solange die Function laeuft.
void (async () => {
  for await (const line of iterator) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type === "egress-result") waiting.get(message.id)?.(message.outcome);
  }
})();

function reply(body, statusCode = 200) {
  process.stdout.write(`${JSON.stringify({ type: "result", statusCode, headers: {}, body })}\n`);
  process.exit(0);
}

switch (mode) {
  case "echo":
    reply({ received: request.payload?.value ?? null, secretRefs: request.secretRefs });
    break;

  case "environment":
    // Gibt die ganze Umgebung zurueck. Der Canary-Fall prueft, dass der Wert
    // aus der Umgebung dieses Testlaufs hier nicht auftaucht.
    reply({ environment: Object.entries(process.env).map(([key, value]) => `${key}=${value}`) });
    break;

  case "egress": {
    // Ein **direkter** Egress-Versuch muss scheitern. Gelingt er, ist
    // `--network none` wirkungslos, und der Fall soll das sichtbar machen statt
    // es zu verschlucken.
    let reached = false;
    let detail = "";
    try {
      const response = await fetch("https://example.com/", {
        signal: AbortSignal.timeout(4_000),
      });
      reached = true;
      detail = String(response.status);
    } catch (error) {
      detail = error instanceof Error ? error.name : "unknown";
    }
    reply({ reached, detail });
    break;
  }

  case "mediated": {
    // Der vermittelte Weg. Das Urteil faellt die Runtime, nicht diese Function.
    const outcome = await egress({
      url: request.payload?.url ?? "https://api.example.com/v1/ping",
      method: request.payload?.method ?? "GET",
      headers: request.payload?.headers,
      body: request.payload?.body,
    });
    reply({ outcome });
    break;
  }

  case "mediated-burst": {
    // Mehr Anfragen als das Budget erlaubt. Erwartet wird, dass die spaeteren
    // eine Absage bekommen, nicht dass der Aufruf abbricht.
    const outcomes = [];
    const count = request.payload?.count ?? 12;
    for (let index = 0; index < count; index += 1) {
      outcomes.push(await egress({ url: "https://api.example.com/v1/ping" }));
    }
    reply({
      allowed: outcomes.filter((outcome) => !outcome.error).length,
      refused: outcomes.filter((outcome) => outcome.error === "EGRESS_LIMIT").length,
    });
    break;
  }

  case "write": {
    // Schreibversuch ausserhalb von /tmp. Muss an `--read-only` scheitern.
    const { writeFileSync } = await import("node:fs");
    let wrote = false;
    try {
      writeFileSync("/qkern-escape", "x");
      wrote = true;
    } catch { wrote = false; }
    reply({ wrote });
    break;
  }

  case "identity":
    reply({ uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 });
    break;

  case "memory": {
    // Waechst, bis der Kernel eingreift. Ohne Speichergrenze laeuft das durch
    // und der Fall wird rot.
    const blocks = [];
    for (let index = 0; index < 4_096; index += 1) {
      blocks.push(Buffer.alloc(4 * 1024 * 1024, index % 251));
    }
    reply({ allocatedMiB: blocks.length * 4 });
    break;
  }

  case "sleep":
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    reply({ slept: true });
    break;

  case "flood":
    // Mehr Ausgabe, als der Aufrufer annehmen darf.
    process.stdout.write(`{"type":"result","statusCode":200,"headers":{},"body":{"pad":"${"x".repeat(400_000)}"}}\n`);
    break;

  default:
    reply({ error: "unknown mode" }, 400);
}
