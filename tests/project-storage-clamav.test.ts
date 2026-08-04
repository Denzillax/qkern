import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  ClamAvProjectStorageScanner,
  ClamdInstreamClient,
  type ProjectStorageScanStreamClient,
} from "@/lib/server/project-storage/clamav-scanner";
import { MemoryProjectStorageProvider } from "@/lib/server/project-storage/provider";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("ClamAV Project Storage scanner", () => {
  it("streams framed INSTREAM data to clamd and accepts only its exact clean verdict", async () => {
    const observed: Buffer[] = [];
    const port = await startClamd("stream: OK", observed);
    const client = new ClamdInstreamClient({ host: "127.0.0.1", port, chunkBytes: 4096 });
    const verdict = await client.scan(chunks(Buffer.from("safe project storage object")));

    expect(verdict).toBe("clean");
    expect(Buffer.concat(observed).toString("utf8")).toBe("safe project storage object");
  });

  it("maps a bounded FOUND response to infected and malformed responses to pending", async () => {
    const infectedPort = await startClamd("stream: Eicar-Signature FOUND", []);
    const malformedPort = await startClamd("stream: MAYBE", []);
    await expect(new ClamdInstreamClient({ host: "127.0.0.1", port: infectedPort })
      .scan(chunks(Buffer.from("sample")))).resolves.toBe("infected");
    await expect(new ClamdInstreamClient({ host: "127.0.0.1", port: malformedPort })
      .scan(chunks(Buffer.from("sample")))).resolves.toBe("pending");
  });

  it("downloads without redirects and verifies bytes, MIME and checksum before returning clean", async () => {
    const payload = Buffer.from("verified object bytes");
    const client = collectingClient("clean");
    const scannerNow = new Date("2026-08-04T12:00:00.000Z");
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      return new Response(payload, { status: 200, headers: {
        "content-length": String(payload.byteLength),
        "content-type": "application/octet-stream",
      } });
    }) as unknown as typeof fetch;
    const scanner = new ClamAvProjectStorageScanner(
      new MemoryProjectStorageProvider(
        "https://objects.qkern.test",
        () => new Date(scannerNow.getTime() + 1_000),
      ),
      client,
      { maxObjectBytes: 1024 },
      fetcher,
      () => scannerNow,
    );

    await expect(scanner.scan({
      providerKey: "organization/project/development/object.bin",
      contentType: "application/octet-stream",
      sizeBytes: payload.byteLength,
      checksumSha256: checksum(payload),
    })).resolves.toBe("clean");
    expect(client.bytes()).toEqual(payload);
  });

  it("fails closed on checksum drift, encoded bodies and scanner size overflow", async () => {
    const payload = Buffer.from("object bytes");
    const client = collectingClient("clean");
    const checksumDrift = new ClamAvProjectStorageScanner(
      new MemoryProjectStorageProvider(), client, { maxObjectBytes: 1024 },
      async () => new Response(payload, { status: 200, headers: {
        "content-length": String(payload.byteLength), "content-type": "application/octet-stream",
      } }),
    );
    await expect(checksumDrift.scan({
      providerKey: "organization/project/development/object.bin",
      contentType: "application/octet-stream",
      sizeBytes: payload.byteLength,
      checksumSha256: Buffer.alloc(32, 9).toString("base64"),
    })).resolves.toBe("pending");

    const fetcher = vi.fn(async () => new Response(payload, { status: 200, headers: {
      "content-length": String(payload.byteLength), "content-type": "application/octet-stream",
      "content-encoding": "gzip",
    } })) as unknown as typeof fetch;
    const encoded = new ClamAvProjectStorageScanner(
      new MemoryProjectStorageProvider(), collectingClient("clean"), { maxObjectBytes: 1024 }, fetcher,
    );
    await expect(encoded.scan({
      providerKey: "organization/project/development/object.bin",
      contentType: "application/octet-stream", sizeBytes: payload.byteLength,
      checksumSha256: checksum(payload),
    })).resolves.toBe("pending");

    const limited = new ClamAvProjectStorageScanner(
      new MemoryProjectStorageProvider(), collectingClient("clean"), { maxObjectBytes: 4 }, fetcher,
    );
    await expect(limited.scan({
      providerKey: "organization/project/development/object.bin",
      contentType: "application/octet-stream", sizeBytes: payload.byteLength,
      checksumSha256: checksum(payload),
    })).resolves.toBe("pending");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects URL-shaped scanner hosts and unsafe numeric settings", () => {
    expect(() => new ClamdInstreamClient({ host: "https://scanner.example.test" }))
      .toThrow(ConfigurationError);
    expect(() => new ClamdInstreamClient({ host: "clamav", port: 0 }))
      .toThrow(ConfigurationError);
  });
});

function collectingClient(verdict: "clean" | "infected" | "pending") {
  const received: Buffer[] = [];
  const client: ProjectStorageScanStreamClient & { bytes(): Buffer } = {
    async scan(source) {
      for await (const value of source) received.push(Buffer.from(value));
      return verdict;
    },
    bytes: () => Buffer.concat(received),
  };
  return client;
}

async function* chunks(value: Buffer) {
  yield value.subarray(0, Math.ceil(value.length / 2));
  yield value.subarray(Math.ceil(value.length / 2));
}

async function startClamd(response: string, observed: Buffer[]) {
  const command = Buffer.from("zINSTREAM\0", "ascii");
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let commandSeen = false;
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!commandSeen) {
        if (buffer.length < command.length) return;
        if (!buffer.subarray(0, command.length).equals(command)) return socket.destroy();
        buffer = buffer.subarray(command.length);
        commandSeen = true;
      }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < 4 + length) return;
        buffer = buffer.subarray(4);
        if (length === 0) {
          socket.end(Buffer.from(`${response}\0`, "utf8"));
          return;
        }
        observed.push(buffer.subarray(0, length));
        buffer = buffer.subarray(length);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test clamd did not bind a TCP port.");
  return address.port;
}

function checksum(value: Uint8Array) {
  return createHash("sha256").update(value).digest("base64");
}
