// Echter HTTPS-Empfaenger fuer die Zustell- und Egress-Zertifizierung.
//
// Bis Release 1.27 hat kein Lauf je eine echte TLS-Verbindung nach draussen
// hergestellt. Signatur, Bestaetigung, Weiterleitungsverbot und Groessengrenze
// waren gegen ein eingespeistes `fetch` belegt, nicht gegen einen Server.
//
// Dieser Empfaenger prueft die Signatur wirklich. Ein Stub, der jede Nachricht
// bestaetigt, wuerde nur beweisen, dass irgendetwas ankam.

import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const secret = Buffer.from(process.env.QKERN_RECEIVER_SECRET ?? "", "base64url");
const options = {
  key: readFileSync("/certs/receiver.key"),
  cert: readFileSync("/certs/receiver.crt"),
};

/** Zeitkonstanter Vergleich. Ein `===` verriete die Signatur Zeichen fuer Zeichen. */
function signatureMatches(header, timestamp, body) {
  const presented = /v1=([A-Za-z0-9_-]+);key=/.exec(header ?? "")?.[1];
  if (!presented) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8").digest();
  const given = Buffer.from(presented, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Der Incident-Publisher signiert anders als der Projekt-Webhook.
 *
 * Dasselbe Verfahren — HMAC-SHA256 ueber `${timestamp}.${body}` —, aber die
 * Kennung steht in einem eigenen Header, und die Signatur ist hexadezimal statt
 * base64url. Wer beide Formate in eine Pruefung zwaengt, prueft am Ende keines
 * von beiden richtig.
 */
function incidentSignatureMatches(header, timestamp, body) {
  const presented = /^v1=([0-9a-f]{64})$/.exec(header ?? "")?.[1];
  if (!presented) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8").digest();
  const given = Buffer.from(presented, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.byteLength;
      if (total > 1_048_576) { request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = createServer(options, async (request, response) => {
  const path = new URL(request.url, "https://receiver.qkern.test").pathname;
  const body = await readBody(request);

  if (path === "/hooks" || path === "/hooks/no-echo") {
    const ok = signatureMatches(
      request.headers["x-qkern-signature"],
      request.headers["x-qkern-timestamp"],
      body,
    );
    if (!ok) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"signature"}');
      return;
    }
    const headers = { "content-type": "application/json" };
    // Nur der eine Pfad spiegelt die Kennung zurueck. Der andere belegt, dass
    // eine fehlende Bestaetigung als Fehlschlag zaehlt.
    if (path === "/hooks") headers["x-qkern-delivery-id"] = request.headers["x-qkern-delivery-id"];
    response.writeHead(200, headers);
    response.end('{"received":true}');
    return;
  }

  // Der Incident-Publisher hat ein eigenes Bestaetigungsformat: Er verlangt
  // genau `{"status":"ack","eventId":"…"}` mit der Kennung, die er geschickt
  // hat. Ein Empfaenger, der `{"received":true}` antwortet, gilt ihm als
  // ungueltig — und das ist der Grund, warum dieser Pfad existiert.
  //
  // Das Signaturschema ist dasselbe wie beim Projekt-Webhook: HMAC ueber
  // `${timestamp}.${body}`. Nachgerechnet wird auch hier.
  // Der Apply-Publisher spricht dasselbe Format wie der Incident-Publisher:
  // `v1=<hex>`, Schluesselkennung im eigenen Header, Bestaetigung mit genau
  // `{"status":"ack","eventId":"…"}`. Ein eigener Pfad, damit beide Faelle
  // unabhaengig voneinander fallen koennen — dieselbe Pruefung, weil es
  // dieselbe Zusage ist.
  if (path === "/incidents" || path === "/apply") {
    const ok = incidentSignatureMatches(
      request.headers["x-qkern-signature"],
      request.headers["x-qkern-timestamp"],
      body,
    );
    if (!ok) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"signature"}');
      return;
    }
    const eventId = request.headers["x-qkern-event-id"];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ack", eventId }));
    return;
  }

  /**
   * Der Provisionierungs-Broker.
   *
   * Der Provisioner signiert wie der Incident- und der Apply-Publisher:
   * `v1=<hex>`, Schluesselkennung im eigenen Header, HMAC ueber
   * `${timestamp}.${body}`. Geantwortet wird mit **genau** den Feldern, die
   * der Adapter erwartet — jedes zusaetzliche oder fehlende Feld macht die
   * Antwort ungueltig, und das ist Absicht: Ein Broker, dessen Bindung nur
   * ungefaehr passt, darf keine Bindung setzen.
   *
   * Der Vertragshash kommt aus der Umgebung, nicht aus dem Code hier: Er
   * gehoert dem Produkt, und ein Empfaenger, der ihn selbst erfinden koennte,
   * wuerde die Zusage aushebeln, die er belegen soll.
   */
  if (path === "/provision") {
    const ok = incidentSignatureMatches(
      request.headers["x-qkern-signature"],
      request.headers["x-qkern-timestamp"],
      body,
    );
    if (!ok) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"signature"}');
      return;
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    if (!parsed || parsed.provisioningJobId !== request.headers["x-qkern-provisioning-job-id"]) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"error":"job id"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ready",
      provisioningJobId: parsed.provisioningJobId,
      binding: {
        databaseInstanceRef: `managed:${parsed.projectId}`,
        vaultStaticRole: `qkern-project-${parsed.projectId}`,
        host: "receiver.qkern.test",
        port: 5432,
        expectedRole: "qkern_project_app",
        expectedDatabase: "qkern_project_certification",
        expectedLedgerOwner: "qkern_ledger_owner",
        serverCertificateSha256: "a".repeat(64),
        bootstrapContractSha256: process.env.QKERN_RECEIVER_BOOTSTRAP_CONTRACT_SHA256 ?? "",
      },
    }));
    return;
  }

  if (path === "/hooks/redirect") {
    response.writeHead(302, { location: "https://elsewhere.qkern.test/hooks" });
    response.end();
    return;
  }

  if (path === "/api/ping") {
    response.writeHead(200, {
      "content-type": "application/json",
      // Muss aus der Antwort verschwinden, bevor sie eine Function erreicht.
      "set-cookie": "session=must-not-pass",
      "x-internal-backend": "receiver-1",
    });
    response.end('{"pong":true,"method":"' + request.method + '"}');
    return;
  }

  if (path === "/api/flood") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("y".repeat(600_000));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"error":"unknown path"}');
});

server.listen(443, () => console.error("receiver: listening on 443"));
