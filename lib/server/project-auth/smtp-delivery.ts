import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  ProjectAuthError,
  type ProjectAuthDelivery,
  type ProjectAuthDeliveryPort,
  type ProjectAuthDeliveryPurpose,
} from "@/lib/server/project-auth/service";

/**
 * Minimal SMTP submission client for Project Auth action mails.
 *
 * The platform hand-rolls its protocol clients (see the ClamAV INSTREAM client
 * and the S3 SigV4 provider) instead of pulling in a mail library. A dependency
 * with template rendering, attachment handling and address parsing would add a
 * large attack surface for the three fixed plaintext messages this port sends.
 *
 * Contract:
 * - exactly one recipient per message, never a Bcc or a list expansion;
 * - TLS is mandatory unless an explicit development opt-in is set;
 * - credentials are only ever sent over an encrypted channel;
 * - the one-time token appears in the message body and nowhere else. It is
 *   never part of a thrown error, and this module logs nothing.
 */

const MAX_RESPONSE_BYTES = 8 * 1024;
const MAX_EMAIL_LENGTH = 254;
const MAX_REDIRECT_LENGTH = 2_048;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export type SmtpSecurity = "implicit_tls" | "starttls" | "plaintext";

export type SmtpProjectAuthDeliveryConfig = {
  host: string;
  port?: number;
  security?: SmtpSecurity;
  username?: string;
  password?: string;
  sender: string;
  /**
   * Absolute URL of the application page that consumes the token. QKERN does
   * not host a verification page: the link carries `token`, `type` and
   * `redirect_to`, and the project's own application posts them to
   * `/auth/verify`.
   */
  actionBaseUrl: string;
  clientName?: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  production?: boolean;
};

/**
 * Betreff und Einleitung der drei Aktionsmails. Seit 2.54 exportiert, weil
 * die Console sie zeigt: Die Texte sind fest, und eine Ansicht, die sie
 * abschreiben muesste, koennte von ihnen abweichen. Was hier steht, geht
 * hinaus; nichts anderes.
 */
export const PROJECT_AUTH_MAIL_SUBJECTS: Record<ProjectAuthDeliveryPurpose, string> = {
  email_verification: "Confirm your email address",
  magic_link: "Your sign-in link",
  password_reset: "Reset your password",
};

export const PROJECT_AUTH_MAIL_INTROS: Record<ProjectAuthDeliveryPurpose, string> = {
  email_verification: "Confirm your email address by opening the link below.",
  magic_link: "Open the link below to sign in.",
  password_reset: "Open the link below to choose a new password.",
};

/**
 * Der Rumpf einer Aktionsmail, genau so, wie er zugestellt wird. `render`
 * ruft dieselbe Funktion; damit kann die Console den echten Text zeigen,
 * ohne ihn zu kopieren.
 */
export function projectAuthMailBody(
  purpose: ProjectAuthDeliveryPurpose,
  link: string,
  expiresAt: Date,
): string {
  return [
    PROJECT_AUTH_MAIL_INTROS[purpose],
    "",
    link,
    "",
    `This link expires at ${expiresAt.toISOString()}.`,
    "If you did not request it, no action is needed.",
    "",
  ].join("\r\n");
}

export class SmtpProjectAuthDelivery implements ProjectAuthDeliveryPort {
  private readonly host: string;
  private readonly port: number;
  private readonly security: SmtpSecurity;
  private readonly username?: string;
  private readonly password?: string;
  private readonly sender: string;
  private readonly actionBaseUrl: URL;
  private readonly clientName: string;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;

  constructor(config: SmtpProjectAuthDeliveryConfig) {
    const production = config.production ?? process.env.NODE_ENV === "production";

    this.host = smtpHost(config.host);
    this.security = config.security ?? "starttls";
    if (production && this.security === "plaintext") {
      throw new ConfigurationError("Project Auth SMTP requires TLS in production");
    }

    this.port = boundedPort(config.port ?? defaultPort(this.security));
    this.sender = mailbox(config.sender, "Project Auth SMTP sender");

    this.username = config.username;
    this.password = config.password;
    if ((this.username === undefined) !== (this.password === undefined)) {
      throw new ConfigurationError(
        "Project Auth SMTP requires both a username and a password or neither",
      );
    }
    if (this.username !== undefined && this.security === "plaintext") {
      throw new ConfigurationError(
        "Project Auth SMTP refuses to send credentials over an unencrypted channel",
      );
    }

    this.actionBaseUrl = actionBaseUrl(config.actionBaseUrl, production);
    this.clientName = clientName(config.clientName ?? "qkern");
    this.connectTimeoutMs = boundedInteger(
      config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      250,
      30_000,
      "Project Auth SMTP connect timeout",
    );
    this.commandTimeoutMs = boundedInteger(
      config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      250,
      60_000,
      "Project Auth SMTP command timeout",
    );
  }

  async deliver(message: ProjectAuthDelivery): Promise<void> {
    const recipient = mailbox(message.email, "Project Auth recipient");
    const body = this.render(message, recipient);

    let session: SmtpSession | undefined;
    try {
      session = await this.open();
      await session.expect(220);
      await this.greet(session);

      if (this.security === "starttls") {
        await session.command("STARTTLS", 220);
        await session.upgrade(this.host, this.connectTimeoutMs);
        await this.greet(session);
      }

      if (this.username !== undefined && this.password !== undefined) {
        const credentials = Buffer.from(`\0${this.username}\0${this.password}`, "utf8");
        await session.command(`AUTH PLAIN ${credentials.toString("base64")}`, 235);
      }

      await session.command(`MAIL FROM:<${this.sender}>`, 250);
      await session.command(`RCPT TO:<${recipient}>`, 250, 251);
      await session.command("DATA", 354);
      await session.data(body);
      await session.quit();
    } catch (error) {
      // The token lives in `body`. A transport error must never carry it or any
      // server text outward, so the code stays fixed. The cause is internal and
      // contains only our own bounded messages; without it a failed delivery
      // against a real mail server is impossible to diagnose.
      if (error instanceof ConfigurationError) throw error;
      throw new ProjectAuthError("DELIVERY_UNAVAILABLE", undefined, { cause: error });
    } finally {
      session?.destroy();
    }
  }

  private async greet(session: SmtpSession): Promise<void> {
    await session.command(`EHLO ${this.clientName}`, 250);
  }

  private async open(): Promise<SmtpSession> {
    const socket = this.security === "implicit_tls"
      ? connectTls({ host: this.host, port: this.port, servername: this.host })
      : createConnection({ host: this.host, port: this.port });

    socket.setNoDelay(true);
    await waitForConnect(socket, this.security === "implicit_tls", this.connectTimeoutMs);
    return new SmtpSession(socket, this.commandTimeoutMs);
  }

  /**
   * Builds the RFC 5322 message. The recipient is validated here as well as in
   * `deliver`, so no caller can construct a `To:` header from an unchecked
   * address.
   */
  render(message: ProjectAuthDelivery, recipient = message.email): string {
    const to = mailbox(recipient, "Project Auth recipient");
    const link = this.actionLink(message);
    const subject = PROJECT_AUTH_MAIL_SUBJECTS[message.purpose];
    const text = projectAuthMailBody(message.purpose, link, message.expiresAt);

    const headers = [
      `From: <${this.sender}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      `Date: ${rfc5322Date(new Date())}`,
      `Message-ID: <${randomUUID()}@${this.clientName}>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "Auto-Submitted: auto-generated",
    ];

    const encoded = Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    return `${headers.join("\r\n")}\r\n\r\n${encoded}\r\n`;
  }

  private actionLink(message: ProjectAuthDelivery): string {
    const url = new URL(this.actionBaseUrl.toString());
    url.searchParams.set("token", message.token);
    url.searchParams.set("type", message.purpose);
    if (message.redirectTo) {
      if (message.redirectTo.length > MAX_REDIRECT_LENGTH || /[\r\n]/.test(message.redirectTo)) {
        throw new ConfigurationError("Project Auth redirect target is not deliverable");
      }
      url.searchParams.set("redirect_to", message.redirectTo);
    }
    return url.toString();
  }
}

class SmtpSession {
  private socket: Socket | TLSSocket;
  private buffer = "";
  private failure: Error | null = null;
  private notify: (() => void) | null = null;
  private detached = false;
  private readonly commandTimeoutMs: number;

  constructor(socket: Socket | TLSSocket, commandTimeoutMs: number) {
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket): void {
    const onData = (chunk: Buffer) => {
      if (this.detached) return;
      this.buffer += chunk.toString("utf8");
      if (this.buffer.length > MAX_RESPONSE_BYTES) {
        this.fail(new Error("SMTP response exceeded the allowed size"));
        return;
      }
      this.notify?.();
    };
    const onError = () => this.fail(new Error("SMTP transport failed"));
    const onClose = () => {
      if (this.detached) return;
      this.fail(new Error("SMTP connection closed"));
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.notify?.();
  }

  async upgrade(servername: string, connectTimeoutMs: number): Promise<void> {
    const raw = this.socket;
    this.detached = true;
    raw.removeAllListeners("data");
    raw.removeAllListeners("error");
    raw.removeAllListeners("close");

    const secure = connectTls({ socket: raw, servername });
    await waitForConnect(secure, true, connectTimeoutMs);

    this.socket = secure;
    this.buffer = "";
    this.failure = null;
    this.detached = false;
    this.attach(secure);
  }

  async command(line: string, ...accepted: number[]): Promise<SmtpReply> {
    await this.write(`${line}\r\n`);
    return await this.expect(...accepted);
  }

  async data(body: string): Promise<SmtpReply> {
    await this.write(`${dotStuff(body)}\r\n.\r\n`);
    return await this.expect(250);
  }

  async quit(): Promise<void> {
    try {
      await this.command("QUIT", 221);
    } catch {
      // A server that drops the connection after DATA has already accepted the
      // message. Refusing the delivery here would cause a duplicate send.
    }
  }

  async expect(...accepted: number[]): Promise<SmtpReply> {
    const reply = await this.read();
    if (!accepted.includes(reply.code)) {
      throw new Error(`SMTP command was rejected with ${reply.code}`);
    }
    return reply;
  }

  private async read(): Promise<SmtpReply> {
    const deadline = Date.now() + this.commandTimeoutMs;
    for (;;) {
      if (this.failure) throw this.failure;

      const reply = takeReply(this.buffer);
      if (reply) {
        this.buffer = reply.rest;
        return reply.value;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("SMTP command timed out");
      await this.waitForData(remaining);
    }
  }

  private waitForData(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.notify = null;
        resolve();
      }, timeoutMs);
      this.notify = () => {
        clearTimeout(timer);
        this.notify = null;
        resolve();
      };
    });
  }

  private write(payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.socket.write(payload, "utf8", (error) => (error ? reject(error) : resolve()));
    });
  }

  destroy(): void {
    this.detached = true;
    this.socket.removeAllListeners();
    this.socket.destroy();
  }
}

export type SmtpReply = { code: number; text: string };

/**
 * Consumes one complete multiline SMTP reply. A reply ends at the first line
 * whose fourth character is a space rather than a hyphen.
 */
function takeReply(buffer: string): { value: SmtpReply; rest: string } | null {
  let offset = 0;
  const lines: string[] = [];

  for (;;) {
    const end = buffer.indexOf("\r\n", offset);
    if (end === -1) return null;

    const line = buffer.slice(offset, end);
    offset = end + 2;
    if (!/^\d{3}[ -]/.test(line)) throw new Error("SMTP reply was malformed");

    lines.push(line.slice(4));
    if (line[3] === " ") {
      return {
        value: { code: Number.parseInt(line.slice(0, 3), 10), text: lines.join("\n") },
        rest: buffer.slice(offset),
      };
    }
  }
}

function waitForConnect(
  socket: Socket | TLSSocket,
  secure: boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const event = secure ? "secureConnect" : "connect";
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("SMTP connection timed out"));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      // The socket error names the transport failure (ECONNREFUSED, EAI_AGAIN,
      // certificate problems). It never contains message content, and `deliver`
      // keeps it internal, so carrying it makes a failed delivery diagnosable
      // without widening what a caller can observe.
      reject(new Error("SMTP connection failed", { cause: error }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener(event, onReady);
      socket.removeListener("error", onError);
    };

    socket.once(event, onReady);
    socket.once("error", onError);
  });
}

/** Escapes a leading dot so message content cannot terminate the DATA phase. */
function dotStuff(body: string): string {
  return body.replace(/\r\n\./g, "\r\n..").replace(/^\./, "..");
}

function defaultPort(security: SmtpSecurity): number {
  return security === "implicit_tls" ? 465 : 587;
}

function smtpHost(value: string): string {
  const host = value.trim();
  if (host === "" || host.length > 255 || /[^A-Za-z0-9.\-_]/.test(host)) {
    throw new ConfigurationError("Project Auth SMTP host is invalid");
  }
  return host;
}

/**
 * Accepts a single addr-spec. CR and LF would let a caller inject additional
 * headers or SMTP commands, so anything outside this shape is refused.
 */
function mailbox(value: string, label: string): string {
  const address = value.trim();
  if (
    address.length === 0 ||
    address.length > MAX_EMAIL_LENGTH ||
    !/^[^\s<>,;:"()[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address)
  ) {
    throw new ConfigurationError(`${label} is not a single deliverable address`);
  }
  return address;
}

function actionBaseUrl(value: string, production: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("Project Auth action base URL is invalid");
  }
  if (url.protocol !== "https:" && !(!production && isLoopback(url.hostname))) {
    throw new ConfigurationError("Project Auth action base URL must use HTTPS");
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new ConfigurationError("Project Auth action base URL must not carry credentials");
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function clientName(value: string): string {
  const name = value.trim();
  if (name === "" || name.length > 63 || /[^A-Za-z0-9.\-]/.test(name)) {
    throw new ConfigurationError("Project Auth SMTP client name is invalid");
  }
  return name;
}

function boundedPort(value: number): number {
  return boundedInteger(value, 1, 65_535, "Project Auth SMTP port");
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${label} is out of range`);
  }
  return value;
}

function rfc5322Date(now: Date): string {
  return now.toUTCString().replace(/GMT$/, "+0000");
}

export function smtpProjectAuthDeliveryFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): SmtpProjectAuthDelivery | null {
  const host = env.QKERN_PROJECT_AUTH_SMTP_HOST;
  if (host === undefined || host === "") return null;

  const sender = env.QKERN_PROJECT_AUTH_SMTP_SENDER;
  const base = env.QKERN_PROJECT_AUTH_ACTION_BASE_URL;
  if (sender === undefined || base === undefined) {
    throw new ConfigurationError(
      "Project Auth SMTP requires a sender address and an action base URL",
    );
  }

  const port = env.QKERN_PROJECT_AUTH_SMTP_PORT;
  return new SmtpProjectAuthDelivery({
    host,
    port: port === undefined ? undefined : Number.parseInt(port, 10),
    security: smtpSecurity(env.QKERN_PROJECT_AUTH_SMTP_SECURITY),
    username: env.QKERN_PROJECT_AUTH_SMTP_USERNAME,
    password: env.QKERN_PROJECT_AUTH_SMTP_PASSWORD,
    sender,
    actionBaseUrl: base,
    production: env.NODE_ENV === "production",
  });
}

function smtpSecurity(value: string | undefined): SmtpSecurity | undefined {
  if (value === undefined) return undefined;
  if (value === "implicit_tls" || value === "starttls" || value === "plaintext") return value;
  throw new ConfigurationError("Project Auth SMTP security mode is invalid");
}
