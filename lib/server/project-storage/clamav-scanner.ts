import { createHash } from "node:crypto";
import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { ConfigurationError } from "@/lib/server/db/errors";
import type {
  ProjectStorageDownloadGrant,
  ProjectStorageProvider,
  ProjectStorageScanner,
  ProjectStorageScanVerdict,
} from "@/lib/server/project-storage/provider";

const DEFAULT_MAX_OBJECT_BYTES = 25 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 64 * 1024;
const MAX_CLAMD_RESPONSE_BYTES = 1024;

export type ClamAvScannerConfig = {
  host: string;
  port?: number;
  connectTimeoutMs?: number;
  scanTimeoutMs?: number;
  downloadTimeoutMs?: number;
  maxObjectBytes?: number;
  chunkBytes?: number;
};

export interface ProjectStorageScanStreamClient {
  scan(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<ProjectStorageScanVerdict>;
}

export class ClamdInstreamClient implements ProjectStorageScanStreamClient {
  private readonly host: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;
  private readonly scanTimeoutMs: number;
  private readonly maxObjectBytes: number;
  private readonly chunkBytes: number;

  constructor(config: ClamAvScannerConfig) {
    this.host = scannerHost(config.host);
    this.port = boundedInteger(config.port ?? 3310, 1, 65_535, "ClamAV port");
    this.connectTimeoutMs = boundedInteger(
      config.connectTimeoutMs ?? 3_000,
      250,
      30_000,
      "ClamAV connect timeout",
    );
    this.scanTimeoutMs = boundedInteger(
      config.scanTimeoutMs ?? 60_000,
      1_000,
      300_000,
      "ClamAV scan timeout",
    );
    this.maxObjectBytes = boundedInteger(
      config.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES,
      1,
      5 * 1024 ** 3,
      "ClamAV maximum object size",
    );
    this.chunkBytes = boundedInteger(
      config.chunkBytes ?? DEFAULT_CHUNK_BYTES,
      4 * 1024,
      1024 * 1024,
      "ClamAV chunk size",
    );
  }

  async scan(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<ProjectStorageScanVerdict> {
    if (signal?.aborted) return "pending";
    return await new Promise<ProjectStorageScanVerdict>((resolve) => {
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      let response = Buffer.alloc(0);
      let settled = false;
      let connected = false;

      const finish = (verdict: ProjectStorageScanVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(scanTimer);
        signal?.removeEventListener("abort", abort);
        socket.destroy();
        resolve(verdict);
      };
      const abort = () => finish("pending");
      const connectTimer = setTimeout(() => finish("pending"), this.connectTimeoutMs);
      const scanTimer = setTimeout(() => finish("pending"), this.scanTimeoutMs);

      signal?.addEventListener("abort", abort, { once: true });
      socket.once("error", () => finish("pending"));
      socket.once("end", () => finish("pending"));
      socket.on("data", (data: Buffer) => {
        if (settled) return;
        response = Buffer.concat([response, data]);
        if (response.length > MAX_CLAMD_RESPONSE_BYTES) return finish("pending");
        const terminator = response.indexOf(0);
        if (terminator === -1) return;
        finish(parseClamdResponse(response.subarray(0, terminator).toString("utf8")));
      });
      socket.once("connect", () => {
        connected = true;
        clearTimeout(connectTimer);
        void this.writeScan(socket, chunks, () => settled).catch(() => finish("pending"));
      });
      socket.once("close", () => {
        if (!settled && connected) finish("pending");
      });
    });
  }

  private async writeScan(
    socket: Socket,
    chunks: AsyncIterable<Uint8Array>,
    isSettled: () => boolean,
  ) {
    await writeSocket(socket, Buffer.from("zINSTREAM\0", "ascii"));
    let totalBytes = 0;
    for await (const source of chunks) {
      if (isSettled()) return;
      for (let offset = 0; offset < source.byteLength; offset += this.chunkBytes) {
        const chunk = source.subarray(offset, Math.min(offset + this.chunkBytes, source.byteLength));
        totalBytes += chunk.byteLength;
        if (totalBytes > this.maxObjectBytes) throw new Error("scan limit");
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.byteLength, 0);
        await writeSocket(socket, length);
        await writeSocket(socket, chunk);
      }
    }
    await writeSocket(socket, Buffer.alloc(4));
  }
}

export class ClamAvProjectStorageScanner implements ProjectStorageScanner {
  private readonly downloadTimeoutMs: number;
  private readonly maxObjectBytes: number;

  constructor(
    private readonly provider: ProjectStorageProvider,
    private readonly client: ProjectStorageScanStreamClient,
    config: Pick<ClamAvScannerConfig, "downloadTimeoutMs" | "maxObjectBytes"> = {},
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.downloadTimeoutMs = boundedInteger(
      config.downloadTimeoutMs ?? 30_000,
      1_000,
      120_000,
      "scanner download timeout",
    );
    this.maxObjectBytes = boundedInteger(
      config.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES,
      1,
      5 * 1024 ** 3,
      "scanner maximum object size",
    );
  }

  async scan(input: {
    providerKey: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
  }, signal?: AbortSignal): Promise<ProjectStorageScanVerdict> {
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 ||
        input.sizeBytes > this.maxObjectBytes || signal?.aborted) return "pending";
    const timeout = AbortSignal.timeout(this.downloadTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const grant = await this.provider.createDownloadGrant({
        providerKey: input.providerKey,
        // Keep a safety margin above the provider's 30-second minimum. Using the
        // exact lower boundary races with the provider's own clock read and can
        // floor to a rejected 29-second grant.
        expiresAt: new Date(
          this.now().getTime() + Math.max(60_000, this.downloadTimeoutMs + 5_000),
        ),
      });
      const response = await this.download(grant, combined);
      if (!response.ok || !response.body ||
          response.headers.get("content-encoding") ||
          Number(response.headers.get("content-length")) !== input.sizeBytes ||
          responseContentType(response) !== input.contentType) return "pending";

      const digest = createHash("sha256");
      let observedBytes = 0;
      const verifiedChunks = async function* () {
        const reader = response.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            observedBytes += value.byteLength;
            if (observedBytes > input.sizeBytes) throw new Error("object grew during scan");
            digest.update(value);
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      };
      const verdict = await this.client.scan(verifiedChunks(), combined);
      const checksum = digest.digest("base64");
      if (observedBytes !== input.sizeBytes || checksum !== input.checksumSha256) return "pending";
      return verdict;
    } catch {
      return "pending";
    }
  }

  private async download(grant: ProjectStorageDownloadGrant, signal: AbortSignal) {
    return await this.fetcher(grant.url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/octet-stream" },
      signal,
    });
  }
}

function responseContentType(response: Response) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function parseClamdResponse(value: string): ProjectStorageScanVerdict {
  if (value === "stream: OK") return "clean";
  if (/^stream: [^\0\r\n]{1,768} FOUND$/.test(value)) return "infected";
  return "pending";
}

async function writeSocket(socket: Socket, value: Uint8Array) {
  if (!socket.writable || socket.destroyed) throw new Error("socket unavailable");
  if (!socket.write(value)) await once(socket, "drain");
}

function scannerHost(value: string) {
  const host = value.trim().toLowerCase();
  if (host.length < 1 || host.length > 253 || host.startsWith(".") || host.endsWith(".") ||
      host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /[\0\r\n/:]/.test(host)) {
    throw new ConfigurationError("Invalid ClamAV scanner host.");
  }
  return host;
}

function boundedInteger(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`Invalid ${label}.`);
  }
  return value;
}
