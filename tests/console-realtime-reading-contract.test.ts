import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setConsoleLocale } from "@/components/console/console-i18n";
import { RealtimeInspectorView, REALTIME_PROTOCOL } from "@/components/console/realtime-inspector-view";
import {
  REALTIME_CAPTURE_FUNCTION,
  REALTIME_CAPTURE_INVITE,
  REALTIME_CAPTURE_PREPARED,
  REALTIME_CAPTURE_SCHEMA,
  REALTIME_CAPTURE_STATES,
  REALTIME_CAPTURE_STATE_TEXTS,
  REALTIME_TABLES_HONESTY,
  REALTIME_TABLES_SDK_NOTE,
  REALTIME_TERMS,
  REALTIME_TERM_TEXTS,
  realtimeCaptureState,
  realtimeChangesChannel,
  realtimeChangesExample,
  realtimeSocketTarget,
  type RealtimeCaptureTrigger,
} from "@/lib/console/realtime-texts";
import { changeChannel } from "@/lib/server/realtime/service";

/**
 * Realtime verstaendlich, ohne eine Faehigkeit zu versprechen, die es nicht
 * gibt (2.144).
 *
 * ## Der Befund, der diesen Vertrag noetig macht
 *
 * Ob Aenderungen einer Tabelle als Realtime-Nachricht ankommen, haengt an
 * genau einer Sache: einem Trigger je Zeile, der
 * `qkern_internal.capture_change()` ausfuehrt. Keine Publikation, kein
 * Replikationsslot, keine Zeile in einer Verwaltungstabelle. Und es gibt keine
 * Route, die diesen Trigger setzt: `/schema/triggers` kennt nur `GET`, eine
 * Schemaaenderung laeuft ueber ein Change Set.
 *
 * Der naheliegende Entwurf waere darum der falsche gewesen: eine Liste mit
 * Schaltern, die sich umlegen lassen und nichts bewirken. Dieser Vertrag haelt
 * fest, dass die Ansicht das nicht tut, und zwar nicht als Absichtserklaerung,
 * sondern gegen den Code: die Namen gegen die Migration, den Kanalnamen gegen
 * den Dienst, die Adresse gegen den WebSocket-Server, den SDK-Satz gegen das
 * SDK.
 *
 * ## Was er nicht kann
 *
 * Er faehrt keine Datenbank und keine Verbindung. Dass ein Trigger wirklich
 * eine Zeile in den Feed legt, sagen die Postgres-Stacks; dass der Beispielcode
 * im Browser laeuft, sagt niemand automatisch. Geprueft ist, dass er dieselben
 * Namen traegt wie der Server, der ihn annehmen muesste.
 */
const VIEW = "components/console/realtime-inspector-view.tsx";
const TEXTS = "lib/console/realtime-texts.ts";
const MIGRATION = "db/project/0003_qkern_change_feed.sql";
const SOCKET_SERVER = "lib/server/realtime/websocket-server.ts";
const SDK = "sdk/typescript/src/index.ts";
const SDK_PACKAGE = "sdk/typescript/package.json";
const SCHEMA_ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/schema/route.ts";
const TRIGGERS_ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/schema/triggers/route.ts";

async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const PROJECT_ID = "prj_realtime_reading";
const ENVIRONMENT = "development" as const;

function render(initialState?: "loading" | "ready" | "unavailable" | "error") {
  return renderToStaticMarkup(createElement(RealtimeInspectorView, {
    projectId: PROJECT_ID, environment: ENVIRONMENT, initialState,
  }));
}

describe("console realtime reading contract", () => {
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    // Keine Antwort, und das ist der Punkt: Die Ansicht muss ohne sie etwas
    // zeigen. Ein Aufruf, den es wider Erwarten doch gibt, geht nicht ins Netz.
    globalThis.fetch = (async () => {
      throw new Error("In diesem Vertrag antwortet nichts.");
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    setConsoleLocale("de");
  });

  it("baut keinen Schalter, weil es keine Route gibt, die ihn tragen koennte", async () => {
    // Erst der Beweis, dass es die Route nicht gibt: Beide gelesenen Routen
    // exportieren nur GET. Kaeme eine schreibende Methode dazu, faellt dieser
    // Fall, und dann ist ein Schalter erlaubt und diese Zusage ueberholt.
    for (const file of [SCHEMA_ROUTE, TRIGGERS_ROUTE]) {
      const route = await source(file);
      expect(route, `${file} exportiert eine schreibende Methode`)
        .not.toMatch(/export\s+(?:const|function|async function)\s+(?:POST|PUT|PATCH|DELETE)\b/);
      expect(route, `${file} exportiert kein GET mehr`).toMatch(/export function GET\b/);
    }

    const view = await source(VIEW);
    // Und dann, dass die Ansicht keinen Schalter zeigt. Seit 2.154 schreibt sie
    // an genau eine Stelle, und die ist kein Trigger: Sie legt einen Change Set
    // an, also eine Schemaaenderung, die durch Risiko, Freigabe und Protokoll
    // laeuft. Die Zusage ist damit nicht ueberholt, sondern genauer: kein
    // Umlegen ohne Route, und kein Wort, das eines verspricht.
    expect(view).not.toContain('type="checkbox"');
    const writes = [...view.matchAll(/method: "(?:POST|PUT|PATCH|DELETE)"/g)];
    expect(writes.length, "mehr als ein Schreibweg in dieser Ansicht").toBe(1);
    expect(view, "schreibt an eine andere Stelle als die Change Sets")
      .toContain('fetch("/api/v1/changesets"');
    for (const word of ["Einschalten", "Ausschalten", "Aktivieren", "Deaktivieren", "Realtime für diese Tabelle"]) {
      expect(view, `${word} verspricht einen Schalter`).not.toContain(`t("${word}")`);
    }
    // Das Wort, das wirklich dasteht, verspricht die Vorbereitung und nicht die
    // Wirkung.
    expect(view).toContain('t("Einschalten vorbereiten")');
    expect(REALTIME_CAPTURE_INVITE).toContain("Freigabe");
    expect(REALTIME_CAPTURE_PREPARED).toContain("Freigabe");
    // Der Satz, der an die Stelle des Schalters tritt, nennt beides: woran es
    // haengt und wie man es heute aendert.
    expect(REALTIME_TABLES_HONESTY).toContain("qkern_internal.capture_change");
    expect(REALTIME_TABLES_HONESTY).toContain("Change Set");
    expect(view).toContain("REALTIME_TABLES_HONESTY");
  });

  it("nimmt den Zustand je Tabelle aus einer echten Lesung und nicht aus einer Annahme", async () => {
    const view = await source(VIEW);
    // Zwei Lesungen, und beide stehen im Quelltext der Ansicht: `/schema`
    // nennt die Tabellen, `/schema/triggers` nennt die Trigger. Ohne die erste
    // fehlten die Tabellen ohne Erfassung, und das sind die interessanten.
    expect(view).toContain("/schema?schema=");
    expect(view).toContain("/schema/triggers?schema=");
    expect(view).toContain("realtimeCaptureState(");

    // Die beiden Namen, an denen der Zustand entschieden wird, stehen so in der
    // Migration, die den Feed anlegt. Ein Tippfehler waere eine Liste, in der
    // nichts erfasst aussieht, und niemand wuerde es merken.
    const migration = await source(MIGRATION);
    expect(migration).toContain(`CREATE OR REPLACE FUNCTION ${REALTIME_CAPTURE_SCHEMA}.${REALTIME_CAPTURE_FUNCTION}()`);

    const capturing = {
      table: "orders", orientation: "row", enabled: "origin",
      functionSchema: REALTIME_CAPTURE_SCHEMA, functionName: REALTIME_CAPTURE_FUNCTION,
    } satisfies RealtimeCaptureTrigger;

    // Kein Trigger: kommt nicht an.
    expect(realtimeCaptureState([], "orders")).toBe("off");
    // Ein Trigger auf eine andere Funktion zaehlt nicht. Eine Tabelle mit einem
    // `updated_at`-Trigger saehe sonst erfasst aus.
    expect(realtimeCaptureState([{ ...capturing, functionName: "touch_updated_at" }], "orders")).toBe("off");
    expect(realtimeCaptureState([{ ...capturing, functionSchema: "public" }], "orders")).toBe("off");
    // Der Trigger einer anderen Tabelle zaehlt nicht fuer diese.
    expect(realtimeCaptureState([capturing], "invoices")).toBe("off");
    // Je Anweisung zaehlt nicht: `capture_change` liest NEW und OLD.
    expect(realtimeCaptureState([{ ...capturing, orientation: "statement" }], "orders")).toBe("off");
    // Abgeschaltet und auf Replik gesetzt feuern im Alltag nicht.
    expect(realtimeCaptureState([{ ...capturing, enabled: "disabled" }], "orders")).toBe("paused");
    expect(realtimeCaptureState([{ ...capturing, enabled: "replica" }], "orders")).toBe("paused");
    // Und die beiden, die wirklich feuern.
    expect(realtimeCaptureState([capturing], "orders")).toBe("arrives");
    expect(realtimeCaptureState([{ ...capturing, enabled: "always" }], "orders")).toBe("arrives");

    // Jeder Zustand hat einen Satz, der ihn erklaert, und keiner behauptet, er
    // liesse sich hier umlegen.
    for (const state of REALTIME_CAPTURE_STATES) {
      const text = REALTIME_CAPTURE_STATE_TEXTS[state];
      expect(text.explains.length, state).toBeGreaterThan(40);
      expect(text.explains, state).toMatch(/[.!?]$/u);
    }
  });

  it("zeigt Beispielcode mit dem Kanalnamen, den der Dienst wirklich beliefert", async () => {
    // Der Kanalname der Console und der des Dienstes sind dieselbe Form. Liefen
    // sie auseinander, abonnierte der Beispielcode einen Kanal, auf dem nie
    // etwas ankommt, und der Fehler saehe nach einem Serverproblem aus.
    expect(realtimeChangesChannel("public", "orders")).toBe(changeChannel({ schema: "public", table: "orders" }));
    expect(realtimeChangesChannel("public", "orders")).toBe("changes:public.orders");

    // Die Adresse im Beispiel ist die, die der WebSocket-Server annimmt. Das
    // Muster kommt aus seinem Quelltext und nicht aus diesem Test.
    const server = await source(SOCKET_SERVER);
    const pattern = /url\.pathname\.match\((\/\^.+\/)\);/.exec(server);
    expect(pattern, "das Pfadmuster des Realtime-Servers ist nicht mehr zu finden").not.toBeNull();
    const accepted = new RegExp(pattern![1].slice(1, -1));
    const target = realtimeSocketTarget("ws://localhost:8788/", PROJECT_ID, ENVIRONMENT);
    expect(new URL(target).pathname).toMatch(accepted);

    const example = realtimeChangesExample({
      url: "ws://localhost:8788", projectId: PROJECT_ID, environment: ENVIRONMENT,
      schema: "public", table: "orders", protocol: REALTIME_PROTOCOL,
    });
    expect(example).toContain(target);
    expect(example).toContain('"changes:public.orders"');
    // Das Protokoll ist das, auf das der Server besteht.
    expect(server).toContain(`"${REALTIME_PROTOCOL}"`);
    expect(example).toContain(`"${REALTIME_PROTOCOL}"`);
    // Die Befehlsnamen sind die des Protokolls, nicht erfundene.
    const protocol = await source("lib/server/realtime/protocol.ts");
    for (const command of ["auth", "subscribe"]) {
      expect(protocol, command).toContain(`z.literal("${command}")`);
      expect(example, command).toContain(`type: "${command}"`);
    }
    // Ein `changes:`-Kanal braucht ein Access Token: Ein Public Key allein ist
    // `anon`, und `anon` darf dort nicht abonnieren. Ohne diese Zeile waere das
    // Beispiel Code, der mit REALTIME_ACCESS_DENIED endet.
    expect(example).toContain("accessToken");
    expect(protocol).toContain("accessToken");
  });

  it("nennt das SDK beim echten Namen und erfindet keine Realtime-Methode", async () => {
    const packaged = JSON.parse(await source(SDK_PACKAGE)) as { name: string };
    const sdk = await source(SDK);
    // Die beiden Namen im Ehrlichkeitssatz gibt es wirklich.
    expect(REALTIME_TABLES_SDK_NOTE).toContain(packaged.name);
    expect(packaged.name).toBe("@qkern/sdk");
    expect(sdk).toContain("export function createQkernClient");
    expect(REALTIME_TABLES_SDK_NOTE).toContain("createQkernClient");

    // Und das SDK hat wirklich keinen Realtime-Client. Bekommt es einen, faellt
    // dieser Fall, und dann gehoert das Beispiel umgeschrieben statt der Satz
    // stehengelassen.
    for (const word of ["WebSocket", "channel", "subscribe", "realtime"]) {
      expect(sdk, `das SDK kennt jetzt ${word}`).not.toContain(word);
    }
    // Darum steht im Beispiel die rohe WebSocket-API und keine Fabrik des SDK.
    const texts = await source(TEXTS);
    expect(texts).toContain("new WebSocket(");
    expect(texts).not.toContain("client.channel(");
    expect(texts).not.toContain("createQkernClient(");
  });

  it("kopiert nur ueber das eine gemeinsame Bauteil", async () => {
    const view = await source(VIEW);
    expect(view).toContain('from "@/components/console/copy-value"');
    expect(view).toContain("<CopyValue");
    // Kein zweites Kopierbauteil und kein roher Aufruf daneben.
    expect(view).not.toContain("navigator.clipboard");
    expect(view).not.toContain("CopyButton");
  });

  it("erklaert die vier Begriffe und sagt bei der Publikation, dass Realtime sie nicht nimmt", async () => {
    expect([...REALTIME_TERMS]).toEqual(["changeFeed", "publication", "presence", "cursor"]);
    for (const term of REALTIME_TERMS) {
      const text = REALTIME_TERM_TEXTS[term];
      expect(text.term.length, term).toBeGreaterThan(0);
      // Kurz, aber ein Satz: mindestens vierzig Zeichen und ein Schlusszeichen.
      expect(text.explains.length, term).toBeGreaterThan(40);
      expect(text.explains, term).toMatch(/[.!?]$/u);
    }
    // Der Change Feed ist eine Tabelle mit Triggern und kein Replikationsstrom.
    expect(REALTIME_TERM_TEXTS.changeFeed.explains).toContain("Trigger");
    // Und die Publikation wird genannt, aber nicht als Weg von Realtime.
    expect(REALTIME_TERM_TEXTS.publication.explains).toContain("Replikation");
    expect(REALTIME_TERM_TEXTS.publication.explains).toContain("nimmt ihn nicht");
  });

  it("rendert ohne jede Antwort und zeigt, dass gelesen wird", () => {
    setConsoleLocale("de");
    const loading = render();
    expect(loading).toContain("Tabellen werden gelesen…");
    // Der Satz, woran es haengt, steht in jedem Zustand da und nicht erst, wenn
    // eine Antwort gekommen ist.
    expect(loading).toContain("qkern_internal.capture_change");

    // Fertig ohne Daten ist der leere Zustand, und er erklaert sich.
    const ready = render("ready");
    expect(ready).toContain("Im Schema public steht keine Tabelle.");
    expect(ready).not.toContain("Tabellen werden gelesen…");

    // Eine Datenbank, die noch nicht bereit ist, ist etwas anderes als ein
    // Fehler, und beide sagen es.
    expect(render("unavailable")).toContain("Datenbank nicht bereit");
    expect(render("error")).toContain("Tabellen nicht verfügbar");

    // Der Inspector darunter steht in jedem dieser Zustaende noch da: Die neue
    // Lesung darf die alte Seite nicht ersetzen.
    for (const markup of [loading, ready, render("error")]) {
      expect(markup).toContain(REALTIME_PROTOCOL);
    }
  });
});
