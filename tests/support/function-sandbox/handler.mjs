// Testfunction fuer die Sandbox-Zertifizierung.
//
// Eine einzige Function deckt alle Faelle ab; der Modus kommt aus der Nutzlast.
// So braucht die Zertifizierung genau ein Image, und jeder Fall laeuft gegen
// dieselben Container-Flags.

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const mode = request.payload?.mode ?? "echo";

function reply(body, statusCode = 200) {
  process.stdout.write(JSON.stringify({ statusCode, headers: {}, body }));
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
    // Ein Egress-Versuch muss scheitern. Gelingt er, ist `--network none`
    // wirkungslos, und der Fall soll das sichtbar machen statt es zu verschlucken.
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

  case "identity": {
    reply({ uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1 });
    break;
  }

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
    process.stdout.write(`{"statusCode":200,"headers":{},"body":{"pad":"${"x".repeat(400_000)}"}}`);
    break;

  default:
    reply({ error: "unknown mode" }, 400);
}
