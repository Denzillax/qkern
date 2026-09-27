import { describe, expect, it } from "vitest";
import {
  DASHBOARD_EVENT_KINDS,
  DashboardWebhookError,
  dashboardEventType,
  validateDashboardWebhook,
  type DashboardEventKind,
} from "@/lib/console/dashboard-webhooks";
import {
  DashboardWebhookCollector,
  DashboardWebhookCollectorError,
  DashboardWebhookService,
  type DashboardEventRow,
  type DashboardWebhookBinding,
} from "@/lib/server/compute/dashboard-webhooks";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

/**
 * Die Dashboard-Webhooks (2.75) ohne Datenbank: die Pruefung der Eingabe, die
 * Reihenfolge der Arten und das Verhalten des Sammlers an den Kanten, die in
 * einem echten Lauf schwer herzustellen sind -- eine Position, die nicht
 * gelesen werden kann, und ein Webhook, der zwischen zwei Runden abgeschaltet
 * wird.
 *
 * Die Kette selbst -- echtes Ereignis, Outbox, Signatur, Zustellversuch --
 * belegt der Fall "(2.75)" in `tests/postgres.integration.test.ts`. Hier steht
 * nichts, was dort besser stuende.
 */

const scope: WebhookOutboxScope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  environment: "development",
};

const secretRef = "vault:dashboard-webhooks/chat";

function entry(id: string, at: string, action: string): DashboardEventRow {
  return Object.freeze({
    cursor: `${at}#${id}`,
    record: Object.freeze({
      id, createdAt: at, action, status: "success",
      environment: scope.environment, projectId: scope.projectId,
      resource: "33333333-3333-4333-8333-333333333333",
    }),
  });
}

class Reader {
  readonly reads: Array<{ kind: DashboardEventKind; after: string | null }> = [];

  constructor(private readonly rows: Map<DashboardEventKind, DashboardEventRow[]>) {}

  async tip(_scope: WebhookOutboxScope, kind: DashboardEventKind) {
    const rows = this.rows.get(kind) ?? [];
    return rows.length === 0 ? null : rows[rows.length - 1].cursor;
  }

  async read(_scope: WebhookOutboxScope, kind: DashboardEventKind,
    input: { after: string | null; limit: number }) {
    this.reads.push({ kind, after: input.after });
    const rows = this.rows.get(kind) ?? [];
    const fresh = input.after === null
      ? rows
      : rows.filter((row) => row.cursor > (input.after as string));
    return fresh.slice(0, input.limit);
  }
}

class Outbox {
  readonly enqueued: Array<{ webhookId: string; eventType: string; payload: unknown }> = [];

  async enqueue(_scope: WebhookOutboxScope, input: {
    webhookId: string; eventType: string; payload: unknown;
  }) {
    this.enqueued.push({ ...input });
    return { id: `delivery-${this.enqueued.length}` } as never;
  }
}

class Cursors {
  readonly positions = new Map<string, string>();
  readonly begun: string[] = [];
  failLoad = false;

  async load(_scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind) {
    if (this.failLoad) throw new Error("cursor unreadable");
    return this.positions.get(`${webhookId}:${kind}`) ?? null;
  }

  async begin(_scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind,
    position: string) {
    const key = `${webhookId}:${kind}`;
    if (this.positions.has(key)) return;
    this.positions.set(key, position);
    this.begun.push(key);
  }

  async advance(_scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind,
    position: string) {
    this.positions.set(`${webhookId}:${kind}`, position);
  }
}

class Bindings {
  constructor(public bindings: DashboardWebhookBinding[]) {}

  async activeDashboardWebhooks() {
    return this.bindings;
  }
}

const admin = {
  organizationId: scope.organizationId,
  actorRef: "admin@qkern.test",
  role: "admin" as const,
  subject: "44444444-4444-4444-8444-444444444444",
};

describe("dashboard webhook definition", () => {
  it("orders the kinds like the fixed list and derives the event types from them", () => {
    const draft = validateDashboardWebhook({
      name: "ereignisse-an-chat",
      url: "https://chat.example.com/qkern",
      kinds: ["environment_added", "migration_applied"],
      signingSecretRef: secretRef,
    });
    expect(draft.kinds).toEqual(["migration_applied", "environment_added"]);
    expect(draft.eventTypes).toEqual(["project.migration_applied", "project.environment_added"]);
    expect(draft.enabled).toBe(true);
    // Kein Feld fuer einen Geheimniswert, nirgends -- nur die Referenz.
    expect(Object.keys(draft).sort()).toEqual(
      ["enabled", "eventTypes", "kinds", "name", "signingSecretRef", "url"]);
  });

  it("names the reason for every rejected input", () => {
    const rejected: Array<[Parameters<typeof validateDashboardWebhook>[0], string]> = [
      [{ name: "AB", url: "https://chat.example.com", kinds: ["migration_applied"], signingSecretRef: secretRef }, "INVALID_NAME"],
      [{ name: "chat", url: "https://chat.example.com", kinds: [], signingSecretRef: secretRef }, "NO_KINDS"],
      [{ name: "chat", url: "https://chat.example.com", kinds: ["deployment"], signingSecretRef: secretRef }, "UNKNOWN_KIND"],
      [{ name: "chat", url: "https://chat.example.com", kinds: ["migration_applied", "migration_applied"], signingSecretRef: secretRef }, "DUPLICATE_KIND"],
      [{ name: "chat", url: "http://chat.example.com", kinds: ["migration_applied"], signingSecretRef: secretRef }, "INVALID_URL"],
      [{ name: "chat", url: "https://127.0.0.1/qkern", kinds: ["migration_applied"], signingSecretRef: secretRef }, "INVALID_URL"],
      [{ name: "chat", url: "https://chat.example.com", kinds: ["migration_applied"], signingSecretRef: "" }, "INVALID_SECRET_REF"],
    ];
    for (const [input, code] of rejected) {
      try {
        validateDashboardWebhook(input);
        expect.unreachable(`${code} wurde nicht abgewiesen`);
      } catch (error) {
        expect(error, code).toBeInstanceOf(DashboardWebhookError);
        expect((error as DashboardWebhookError).code).toBe(code);
        expect((error as DashboardWebhookError).reason.length).toBeGreaterThan(20);
      }
    }
  });

  it("keeps a principal that is not an administrator out of every method", async () => {
    const service = new DashboardWebhookService({
      repository: {
        list: async () => [], get: async () => null,
        create: async () => { throw new Error("must not be reached"); },
        setEnabled: async () => null,
      },
    });
    const member = { ...admin, role: "authenticated" as const };
    await expect(service.list(member, scope)).rejects.toBeInstanceOf(ComputeDefinitionError);
    await expect(service.get(member, scope, admin.subject))
      .rejects.toBeInstanceOf(ComputeDefinitionError);
  });

  it("says nothing about the collector when no store is wired", async () => {
    const service = new DashboardWebhookService({
      repository: {
        list: async () => [], get: async () => null,
        create: async () => { throw new Error("must not be reached"); },
        setEnabled: async () => null,
      },
    });
    // `null` heisst "diese Installation fuehrt keine Position", nicht "noch nie
    // gemeldet". Die Ansicht muss beides unterscheiden koennen.
    expect(await service.collectorState(admin, scope)).toBeNull();
  });
});

describe("dashboard webhook collector", () => {
  const webhookId = "55555555-5555-4555-8555-555555555555";
  const binding: DashboardWebhookBinding = Object.freeze({
    webhookId, kinds: Object.freeze(["migration_applied" as DashboardEventKind]), schemaVersion: 1,
  });

  function collector(rows: DashboardEventRow[], cursors = new Cursors()) {
    const reader = new Reader(new Map([["migration_applied" as DashboardEventKind, rows]]));
    const outbox = new Outbox();
    const bindings = new Bindings([binding]);
    return {
      reader, outbox, cursors, bindings,
      collector: new DashboardWebhookCollector({
        reader, bindings, outbox, cursors, scope,
      }),
    };
  }

  it("starts at the tip and does not send the past", async () => {
    const past = [
      entry("aaaaaaa1-1111-4111-8111-111111111111", "2026-09-27T08:00:00.000Z", "migration.apply.completed"),
      entry("aaaaaaa2-1111-4111-8111-111111111111", "2026-09-27T08:01:00.000Z", "migration.apply.completed"),
    ];
    const fixture = collector(past);
    expect(await fixture.collector.poll()).toBe(0);
    expect(fixture.outbox.enqueued).toEqual([]);
    // Und die Spitze wird sofort festgehalten: Ohne dieses Schreiben spraenge ein
    // Neustart auf die inzwischen gewachsene Spitze.
    expect(fixture.cursors.begun).toEqual([`${webhookId}:migration_applied`]);
    expect(fixture.cursors.positions.get(`${webhookId}:migration_applied`))
      .toBe(past[1].cursor);
  });

  it("sends one notice per event and moves the position with each one", async () => {
    const rows = [
      entry("aaaaaaa1-1111-4111-8111-111111111111", "2026-09-27T08:00:00.000Z", "migration.apply.completed"),
    ];
    const fixture = collector(rows);
    expect(await fixture.collector.poll()).toBe(0);
    rows.push(
      entry("aaaaaaa2-1111-4111-8111-111111111111", "2026-09-27T09:00:00.000Z", "migration.apply.completed"),
      entry("aaaaaaa3-1111-4111-8111-111111111111", "2026-09-27T09:01:00.000Z", "migration.apply.failed"),
    );
    expect(await fixture.collector.poll()).toBe(2);
    expect(fixture.outbox.enqueued.map((item) => item.eventType))
      .toEqual(["project.migration_applied", "project.migration_applied"]);
    // Keine Ladung: je Ereignis eine Huelle mit genau einem Ereignis darin.
    for (const enqueued of fixture.outbox.enqueued) {
      expect(Object.keys(enqueued.payload as object).sort())
        .toEqual(["event", "kind", "schemaVersion"]);
    }
    expect(fixture.cursors.positions.get(`${webhookId}:migration_applied`))
      .toBe(rows[2].cursor);
    // Und der naechste Lauf holt nichts doppelt.
    expect(await fixture.collector.poll()).toBe(0);
  });

  it("refuses to start when the stored position cannot be read", async () => {
    const cursors = new Cursors();
    cursors.failLoad = true;
    const fixture = collector([
      entry("aaaaaaa1-1111-4111-8111-111111111111", "2026-09-27T08:00:00.000Z", "migration.apply.completed"),
    ], cursors);
    // Kein Ersatzwert: Die Spitze uebersprunge, was seit dem letzten Lauf
    // entstanden ist, und der Anfang meldete die ganze Geschichte.
    await expect(fixture.collector.poll()).rejects.toBeInstanceOf(DashboardWebhookCollectorError);
    expect(fixture.outbox.enqueued).toEqual([]);
  });

  it("collects nothing for a binding that is no longer active", async () => {
    const rows = [
      entry("aaaaaaa1-1111-4111-8111-111111111111", "2026-09-27T08:00:00.000Z", "migration.apply.completed"),
    ];
    const fixture = collector(rows);
    expect(await fixture.collector.poll()).toBe(0);
    // Abgeschaltet heisst: Die Liste der aktiven Kopplungen ist leer. Das
    // Ereignis bleibt in der Audit-Kette stehen, und beim Einschalten laeuft
    // nicht auf einmal alles los -- die Position ist schon weiter.
    fixture.bindings.bindings = [];
    rows.push(entry("aaaaaaa2-1111-4111-8111-111111111111", "2026-09-27T09:00:00.000Z", "migration.apply.completed"));
    expect(await fixture.collector.poll()).toBe(0);
    expect(fixture.outbox.enqueued).toEqual([]);
  });

  it("gives every kind an event type the outbox column can hold", () => {
    for (const kind of DASHBOARD_EVENT_KINDS) {
      expect(dashboardEventType(kind)).toMatch(/^project\.[a-z_]{1,50}$/);
    }
  });
});
