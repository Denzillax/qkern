import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  SmtpProjectAuthDelivery,
  smtpProjectAuthDeliveryFromEnv,
} from "@/lib/server/project-auth/smtp-delivery";
import { ProjectAuthError, type ProjectAuthDelivery } from "@/lib/server/project-auth/service";

const SCOPE = {
  organizationId: "org_1",
  projectId: "prj_1",
  environment: "development",
} as ProjectAuthDelivery["scope"];

const TOKEN = "tok_0123456789abcdef0123456789abcdef";

function message(overrides: Partial<ProjectAuthDelivery> = {}): ProjectAuthDelivery {
  return {
    scope: SCOPE,
    email: "app.user@example.com",
    purpose: "magic_link",
    token: TOKEN,
    redirectTo: "https://app.example.com/welcome",
    expiresAt: new Date("2026-08-04T18:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Minimal SMTP server that records the dialogue. It speaks just enough of the
 * protocol to exercise the client against a real socket rather than a mock.
 */
class FakeSmtpServer {
  readonly received: string[] = [];
  readonly bodies: string[] = [];
  private server: Server | undefined;

  constructor(private readonly reject: { command: string; code: number } | null = null) {}

  async listen(): Promise<number> {
    this.server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server!.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return address.port;
  }

  private handle(socket: Socket): void {
    let buffer = "";
    let inData = false;
    let body = "";

    socket.write("220 fake.local ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            this.bodies.push(body);
            body = "";
            socket.write("250 queued\r\n");
            continue;
          }
          body += `${line}\r\n`;
          continue;
        }

        this.received.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (this.reject && line.toUpperCase().startsWith(this.reject.command)) {
          socket.write(`${this.reject.code} rejected\r\n`);
          continue;
        }
        if (verb === "EHLO") socket.write("250-fake.local\r\n250 SIZE 1000000\r\n");
        else if (verb === "MAIL" || verb === "RCPT") socket.write("250 ok\r\n");
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 send it\r\n");
        } else if (verb === "AUTH") socket.write("235 authenticated\r\n");
        else if (verb === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("502 unsupported\r\n");
      }
    });
    socket.on("error", () => {});
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}

const servers: FakeSmtpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startServer(reject: { command: string; code: number } | null = null) {
  const server = new FakeSmtpServer(reject);
  servers.push(server);
  return { server, port: await server.listen() };
}

function developmentDelivery(port: number, overrides = {}) {
  return new SmtpProjectAuthDelivery({
    host: "127.0.0.1",
    port,
    security: "plaintext",
    sender: "no-reply@example.com",
    actionBaseUrl: "http://localhost:3000/auth/callback",
    production: false,
    ...overrides,
  });
}

describe("SMTP Project Auth delivery configuration", () => {
  it("refuses an unencrypted transport in production", () => {
    expect(() =>
      new SmtpProjectAuthDelivery({
        host: "mail.example.com",
        security: "plaintext",
        sender: "no-reply@example.com",
        actionBaseUrl: "https://app.example.com/auth/callback",
        production: true,
      })
    ).toThrow(ConfigurationError);
  });

  it("never sends credentials over an unencrypted channel", () => {
    expect(() =>
      developmentDelivery(2525, { username: "user", password: "secret" })
    ).toThrow(ConfigurationError);
  });

  it("requires a username and a password together", () => {
    expect(() =>
      new SmtpProjectAuthDelivery({
        host: "mail.example.com",
        sender: "no-reply@example.com",
        actionBaseUrl: "https://app.example.com/auth/callback",
        username: "user",
        production: true,
      })
    ).toThrow(ConfigurationError);
  });

  it("requires HTTPS action links outside development loopback", () => {
    expect(() =>
      new SmtpProjectAuthDelivery({
        host: "mail.example.com",
        sender: "no-reply@example.com",
        actionBaseUrl: "http://app.example.com/auth/callback",
        production: true,
      })
    ).toThrow(ConfigurationError);
  });

  it("rejects an action base URL that carries credentials", () => {
    expect(() =>
      new SmtpProjectAuthDelivery({
        host: "mail.example.com",
        sender: "https://user:pass@app.example.com/",
        actionBaseUrl: "https://user:pass@app.example.com/auth/callback",
        production: true,
      })
    ).toThrow(ConfigurationError);
  });

  it("stays disabled when no SMTP host is configured", () => {
    expect(smtpProjectAuthDeliveryFromEnv({})).toBeNull();
  });

  it("refuses a partial SMTP configuration instead of guessing", () => {
    expect(() =>
      smtpProjectAuthDeliveryFromEnv({ QKERN_PROJECT_AUTH_SMTP_HOST: "mail.example.com" })
    ).toThrow(ConfigurationError);
  });
});

describe("SMTP Project Auth message", () => {
  it("carries the token, the purpose and the redirect target in the action link", () => {
    const rendered = developmentDelivery(2525).render(message());
    const link = /https?:\/\/\S+/.exec(Buffer.from(bodyOf(rendered), "base64").toString("utf8"));

    expect(link).not.toBeNull();
    const url = new URL(link![0]);
    expect(url.searchParams.get("token")).toBe(TOKEN);
    expect(url.searchParams.get("type")).toBe("magic_link");
    expect(url.searchParams.get("redirect_to")).toBe("https://app.example.com/welcome");
  });

  it("uses a fixed subject per purpose and exactly one recipient", () => {
    const rendered = developmentDelivery(2525).render(
      message({ purpose: "password_reset", email: "reset@example.com" }),
    );

    expect(rendered).toContain("Subject: Reset your password");
    expect(rendered).toContain("To: <reset@example.com>");
    expect(rendered).not.toMatch(/^Bcc:/m);
    expect(rendered.match(/^To:/gm)).toHaveLength(1);
  });

  it("refuses a recipient that could inject a header", () => {
    expect(() =>
      developmentDelivery(2525).render(message({ email: "victim@example.com\r\nBcc: attacker@example.com" }))
    ).toThrow(ConfigurationError);
  });

  it("refuses a redirect target that could inject a header", () => {
    expect(() =>
      developmentDelivery(2525).render(message({ redirectTo: "https://app.example.com/\r\nBcc: a@b.co" }))
    ).toThrow(ConfigurationError);
  });
});

describe("SMTP Project Auth delivery over a real socket", () => {
  it("completes the submission dialogue in order", async () => {
    const { server, port } = await startServer();

    await developmentDelivery(port).deliver(message());

    const verbs = server.received.map((line) => line.split(" ")[0].toUpperCase());
    expect(verbs).toEqual(["EHLO", "MAIL", "RCPT", "DATA", "QUIT"]);
    expect(server.received[1]).toBe("MAIL FROM:<no-reply@example.com>");
    expect(server.received[2]).toBe("RCPT TO:<app.user@example.com>");
    expect(server.bodies).toHaveLength(1);
  });

  it("delivers the token only inside the message body", async () => {
    const { server, port } = await startServer();

    await developmentDelivery(port).deliver(message());

    expect(server.received.join("\n")).not.toContain(TOKEN);
    expect(Buffer.from(bodyOf(server.bodies[0]), "base64").toString("utf8")).toContain(TOKEN);
  });

  it("reports a rejected recipient without leaking the token or the server text", async () => {
    const { port } = await startServer({ command: "RCPT", code: 550 });

    const error = await developmentDelivery(port).deliver(message()).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProjectAuthError);
    expect((error as ProjectAuthError).code).toBe("DELIVERY_UNAVAILABLE");
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain("rejected");
  });

  it("fails closed when the server never answers", async () => {
    const idle = createServer(() => {});
    await new Promise<void>((resolve) => idle.listen(0, "127.0.0.1", resolve));
    const address = idle.address();
    if (address === null || typeof address === "string") throw new Error("no port");

    const error = await developmentDelivery(address.port, { commandTimeoutMs: 300 })
      .deliver(message())
      .catch((cause: unknown) => cause);

    await new Promise<void>((resolve) => idle.close(() => resolve()));
    expect(error).toBeInstanceOf(ProjectAuthError);
  });
});

/** Returns the base64 payload of a rendered message, without its headers. */
function bodyOf(rendered: string): string {
  const separator = rendered.indexOf("\r\n\r\n");
  return rendered.slice(separator + 4).replace(/\r\n/g, "");
}
