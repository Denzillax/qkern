import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAuthMailHandlers } from
  "@/app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/mail/route";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth/http";
import { authRuntime } from "@/lib/server/auth/runtime";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { projectAuthMailSettings } from "@/lib/server/project-auth/mail-settings";
import { tenancyService } from "@/lib/server/tenancy-service";

/**
 * Der Mailweg als Lesewert (2.54).
 *
 * Zwei Zusagen stehen hier auf dem Pruefstand, und beide sind
 * Sicherheitszusagen: Das Passwort des Mailkontos verlaesst den Server nie,
 * und es gibt keinen Schreibweg — weil es nichts gaebe, wohin er schriebe.
 */
const SECRET = "a-very-secret-mail-password";
const ENV = {
  QKERN_PROJECT_AUTH_SMTP_HOST: "mail.test",
  QKERN_PROJECT_AUTH_SMTP_PORT: "2525",
  QKERN_PROJECT_AUTH_SMTP_SECURITY: "starttls",
  QKERN_PROJECT_AUTH_SMTP_USERNAME: "postmaster",
  QKERN_PROJECT_AUTH_SMTP_PASSWORD: SECRET,
  QKERN_PROJECT_AUTH_SMTP_SENDER: "noreply@qkern.test",
  QKERN_PROJECT_AUTH_ACTION_BASE_URL: "https://app.test/auth/action",
} as const;

async function fixture() {
  const nonce = randomUUID();
  const registration = await authRuntime.service.register({
    email: `mail-route-${nonce}@qkern.test`,
    password: "a sufficiently long mail route test password",
    rateLimitKey: nonce,
  });
  const membership = await tenancyService.ensureWorkspace(registration.user);
  const projects = await controlPlaneService.listProjects({
    organizationId: membership.organization.id,
    actor: { id: registration.user.id, ref: registration.user.email, type: "user" },
  });
  const project = projects[0];
  const base = `https://qkern.test/api/v1/projects/${project.id}`
    + "/environments/development/auth/admin/mail";
  const cookie = `${SESSION_COOKIE_NAME}=${registration.token}`;
  return {
    registration, project, base,
    read: (query = "") => new NextRequest(`${base}${query}`, { headers: { cookie } }),
    params: { params: Promise.resolve({ projectId: project.id, environment: "development" }) },
    handlers: createProjectAuthMailHandlers(() => projectAuthMailSettings(ENV)),
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("project auth admin mail route", () => {
  it("shows every effective value with its origin, no-store, and never the password", async () => {
    const built = await fixture();
    const response = await built.handlers.GET(built.read(), built.params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data).toMatchObject({
      mode: "smtp",
      host: { value: "mail.test", origin: "environment" },
      port: { value: "2525", origin: "environment" },
      security: { value: "starttls", origin: "environment" },
      sender: { value: "noreply@qkern.test", origin: "environment" },
      actionBaseUrl: { value: "https://app.test/auth/action", origin: "environment" },
      authenticated: true,
      templatesEditable: false,
      languages: ["en"],
    });
    const serialized = JSON.stringify(body);
    // Das Passwort nie, auch nicht gekuerzt, und auch nicht der Benutzername:
    // Beides zusammen waere eine Zugangsdatenzeile.
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(SECRET.slice(0, 8));
    expect(serialized).not.toContain("postmaster");
    // Keine zusammengesetzte Verbindungszeichenkette.
    expect(serialized).not.toMatch(/smtps?:\/\//);
    expect(serialized).not.toMatch(/:\/\/[^"]*@mail\.test/);
    // Ausserhalb der Vorlagen — die heissen von Haus aus "password_reset" —
    // kommt das Wort Passwort gar nicht vor, und ein Feld dafuer gibt es nicht.
    const { templates: _templates, ...settings } = body.data as Record<string, unknown>;
    expect(JSON.stringify(settings)).not.toMatch(/password|dsn|credential|username/i);
    expect(Object.keys(body.data).sort()).toEqual([
      "actionBaseUrl", "authenticated", "host", "languages", "mode", "port",
      "security", "sender", "templates", "templatesEditable",
    ]);
  });

  it("falls back to the port and the security the adapter would take, and marks it as a default", async () => {
    const built = await fixture();
    const handlers = createProjectAuthMailHandlers(() => projectAuthMailSettings({
      QKERN_PROJECT_AUTH_SMTP_HOST: "mail.test",
      QKERN_PROJECT_AUTH_SMTP_SENDER: "noreply@qkern.test",
      QKERN_PROJECT_AUTH_ACTION_BASE_URL: "https://app.test/auth/action",
    }));
    const body = await (await handlers.GET(built.read(), built.params)).json();
    expect(body.data.port).toEqual({ value: "587", origin: "default" });
    expect(body.data.security).toEqual({ value: "starttls", origin: "default" });
    expect(body.data.authenticated).toBe(false);
  });

  it("says plainly when there is no mail path at all", async () => {
    const built = await fixture();
    for (const [env, mode] of [
      [{}, "disabled"],
      [{ QKERN_PROJECT_AUTH_DEV_EXPOSE_TOKENS: "true" }, "development_noop"],
    ] as const) {
      const handlers = createProjectAuthMailHandlers(() => projectAuthMailSettings(env));
      const body = await (await handlers.GET(built.read(), built.params)).json();
      expect(body.data.mode).toBe(mode);
      expect(body.data.host).toEqual({ value: null, origin: "unset" });
      expect(body.data.authenticated).toBe(false);
    }
  });

  it("shows the three fixed texts that really go out, with a sample link and no real token", async () => {
    const built = await fixture();
    const body = await (await built.handlers.GET(built.read(), built.params)).json();
    expect(body.data.templates.map((template: { purpose: string }) => template.purpose))
      .toEqual(["email_verification", "magic_link", "password_reset"]);
    expect(body.data.templates[1]).toMatchObject({
      subject: "Your sign-in link",
      intro: "Open the link below to sign in.",
    });
    for (const template of body.data.templates as ReadonlyArray<{ intro: string; body: string }>) {
      expect(template.body).toContain(template.intro);
      expect(template.body).toContain("This link expires at");
      expect(template.body).toContain("qk_example_token");
    }
    // Der Betreff der Route und der Betreff des Versands sind derselbe Wert,
    // nicht zwei abgeschriebene.
    const delivery = await readFile(
      path.resolve(process.cwd(), "lib/server/project-auth/smtp-delivery.ts"), "utf8",
    );
    expect(delivery).toContain("PROJECT_AUTH_MAIL_SUBJECTS[message.purpose]");
    expect(delivery).toContain("projectAuthMailBody(message.purpose, link, message.expiresAt)");
  });

  it("has no write verb at all", async () => {
    const route = await readFile(path.resolve(process.cwd(),
      "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/mail/route.ts"), "utf8");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:PUT|POST|PATCH|DELETE)\b/);
    expect(route).not.toContain("safeJson");
    const handlers = Object.keys(createProjectAuthMailHandlers());
    expect(handlers).toEqual(["GET"]);
  });

  it("requires a console session and the project auth admin capability, and takes no query", async () => {
    const built = await fixture();
    expect((await built.handlers.GET(new NextRequest(built.base), built.params)).status).toBe(401);
    expect((await built.handlers.GET(built.read("?host=x"), built.params)).status).toBe(400);

    const resolve = tenancyService.resolve.bind(tenancyService);
    vi.spyOn(tenancyService, "resolve").mockImplementation(async (user, requested) => ({
      ...(await resolve(user, requested)), role: "developer",
    }));
    expect((await built.handlers.GET(built.read(), built.params)).status).toBe(404);
  });
});
