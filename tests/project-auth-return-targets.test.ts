import { describe, expect, it } from "vitest";
import {
  effectiveProjectAuthReturnTargets,
  parseProjectAuthReturnTarget,
  parseProjectAuthReturnTargets,
  projectAuthReturnTargetAllowed,
  PROJECT_AUTH_RETURN_TARGET_LIMIT,
} from "@/lib/server/project-auth/return-targets";

/**
 * Die Entscheidung ueber ein Ruecksprungziel (2.54), einzeln geprueft.
 *
 * Der tragende Satz steht in zwei Formen hier: Die Liste einer
 * Projektumgebung **verengt** die aeussere Grenze des Betriebs und weitet sie
 * nie. Ein Eintrag, der sie weiten wuerde, wird abgelehnt — beim Schreiben
 * mit Grund, und an der Grenze selbst stillschweigend, weil ein Aufrufer
 * dort nichts ueber die Konfiguration erfahren soll.
 *
 * Die PostgreSQL-Seite deckt der Fall "(2.54)" in postgres.integration ab.
 */
const BOUND = new Set(["https://app.test", "https://admin.app.test", "http://localhost:3000"]);

describe("project auth return targets", () => {
  it("accepts an exact origin and nothing that only looks like one", () => {
    expect(parseProjectAuthReturnTarget("https://app.test")).toEqual({ ok: true, origin: "https://app.test" });
    expect(parseProjectAuthReturnTarget("https://app.test:8443"))
      .toEqual({ ok: true, origin: "https://app.test:8443" });
    // Alles, was mehr als eine Herkunft ist, faellt durch — auch der
    // Schraegstrich am Ende, den eine Adresszeile gern anhaengt.
    for (const entry of [
      "https://app.test/", "https://app.test/callback", "https://app.test?x=1",
      "https://app.test#top", "https://app.test/#", " https://app.test/ ".trim() + "/",
    ]) {
      expect(parseProjectAuthReturnTarget(entry), entry).toEqual({ ok: false, reason: "not_an_origin" });
    }
  });

  it("refuses every hostile shape with its own reason", () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [42, "not_a_string"],
      [null, "not_a_string"],
      ["", "empty"],
      ["   ", "empty"],
      [`https://${"a".repeat(260)}.test`, "too_long"],
      ["https://*.app.test", "wildcard"],
      ["*", "wildcard"],
      ["https://app.test/*", "wildcard"],
      ["app.test", "not_a_url"],
      ["//app.test", "not_a_url"],
      ["not a url at all", "not_a_url"],
      ["http://app.test", "insecure_scheme"],
      ["ftp://app.test", "insecure_scheme"],
      // javascript: und data: parsen als URL, haben aber keine Herkunft;
      // `origin` ist dort "null" und stimmt nie mit der Eingabe ueberein.
      ["javascript:alert(1)", "not_an_origin"],
      ["data:text/html,<script>", "not_an_origin"],
      ["https://user:secret@app.test", "carries_credentials"],
    ];
    for (const [value, reason] of cases) {
      expect(parseProjectAuthReturnTarget(value), String(value)).toEqual({ ok: false, reason });
    }
  });

  it("allows http only on a local development host", () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      expect(parseProjectAuthReturnTarget(`http://${host}:3000`)).toEqual({ ok: true, origin: `http://${host}:3000` });
    }
    // Ein Hostname, der nur so aussieht, ist keiner.
    for (const entry of ["http://localhost.attacker.test", "http://127.0.0.1.attacker.test", "http://10.0.0.1"]) {
      expect(parseProjectAuthReturnTarget(entry), entry).toEqual({ ok: false, reason: "insecure_scheme" });
    }
  });

  it("refuses a target that would widen the outer bound", () => {
    // Der Kern: Was der Betrieb nie erlaubt hat, kommt auch mit einem
    // Console-Schreibzugriff nicht hinein — und zwar mit Grund, nicht
    // stillschweigend weggelassen.
    const widened = parseProjectAuthReturnTargets(["https://app.test", "https://attacker.test"], BOUND);
    expect(widened).toEqual({ ok: false, reason: "outside_outer_bound", value: "https://attacker.test" });

    // Auch ein Nachbar-Host, der nur mit der erlaubten Herkunft anfaengt
    // oder aufhoert, ist eine andere Herkunft.
    for (const entry of ["https://app.test.attacker.test", "https://evil-app.test", "https://app.test:8443"]) {
      expect(parseProjectAuthReturnTargets([entry], BOUND), entry)
        .toEqual({ ok: false, reason: "outside_outer_bound", value: entry });
    }
    // Nichts davon hat etwas an der Grenze geaendert.
    expect([...BOUND]).toEqual(["https://app.test", "https://admin.app.test", "http://localhost:3000"]);
  });

  it("narrows, keeps the order, drops duplicates and counts the limit", () => {
    expect(parseProjectAuthReturnTargets(["https://admin.app.test", "https://app.test", "https://app.test"], BOUND))
      .toEqual({ ok: true, targets: ["https://admin.app.test", "https://app.test"] });
    expect(parseProjectAuthReturnTargets([], BOUND)).toEqual({ ok: true, targets: [] });
    const many = Array.from({ length: PROJECT_AUTH_RETURN_TARGET_LIMIT + 1 }, () => "https://app.test");
    expect(parseProjectAuthReturnTargets(many, BOUND))
      .toEqual({ ok: false, reason: "too_many", value: String(many.length) });
  });

  it("decides a single redirect against both bounds", () => {
    const narrowed = ["https://app.test"];
    // In beiden: erlaubt.
    expect(projectAuthReturnTargetAllowed({
      value: "https://app.test/willkommen?ref=1", outerBound: BOUND, allowList: narrowed,
    })).toBe(true);
    // In der aeusseren Grenze, aber von der Umgebung ausgeschlossen.
    expect(projectAuthReturnTargetAllowed({
      value: "https://admin.app.test/x", outerBound: BOUND, allowList: narrowed,
    })).toBe(false);
    // Leere Liste verengt nicht: dann gilt die aeussere Grenze.
    expect(projectAuthReturnTargetAllowed({
      value: "https://admin.app.test/x", outerBound: BOUND, allowList: [],
    })).toBe(true);
    // Ausserhalb beider.
    expect(projectAuthReturnTargetAllowed({
      value: "https://attacker.test/", outerBound: BOUND, allowList: [],
    })).toBe(false);
  });

  it("refuses credentials, a fragment and an unparsable value at the redirect itself", () => {
    for (const value of [
      "https://user:secret@app.test/callback",
      "https://app.test/callback#token",
      "not a url",
      "javascript:alert(1)",
      "",
    ]) {
      expect(projectAuthReturnTargetAllowed({ value, outerBound: BOUND, allowList: [] }), value).toBe(false);
    }
  });

  it("computes what really applies", () => {
    expect(effectiveProjectAuthReturnTargets(BOUND, [])).toEqual([...BOUND]);
    expect(effectiveProjectAuthReturnTargets(BOUND, ["https://app.test"])).toEqual(["https://app.test"]);
    // Eine Liste, die etwas nennt, das die Grenze nicht hat, kann daraus
    // nichts machen: die Schnittmenge bleibt leer.
    expect(effectiveProjectAuthReturnTargets(BOUND, ["https://attacker.test"])).toEqual([]);
  });
});
