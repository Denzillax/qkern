import { describe, expect, it } from "vitest";
import { assertSafeHref, guideHref, isExternal } from "@/lib/docs/links";

describe("guideHref", () => {
  it("maps guide files to website paths", () => {
    expect(guideHref("GLOSSAR.md#tabelle")).toBe("/docs/glossar#tabelle");
    expect(guideHref("WAS_IST_QKERN.md")).toBe("/docs");
    expect(guideHref("FUER_GRUENDER.md")).toBe("/docs/gruender");
    expect(guideHref("./GLOSSAR.md")).toBe("/docs/glossar");
    expect(guideHref("./SCHNELLSTART.md#start")).toBe("/docs/schnellstart#start");
  });

  it("leaves everything else unchanged", () => {
    expect(guideHref("https://x")).toBe("https://x");
    expect(guideHref("UNBEKANNT.md")).toBe("UNBEKANNT.md");
    expect(guideHref("#anker")).toBe("#anker");
  });

  it("tells external links from internal ones", () => {
    expect(isExternal("https://x")).toBe(true);
    expect(isExternal("mailto:a@b.ch")).toBe(true);
    expect(isExternal("//example.com/x")).toBe(true);
    expect(isExternal("/docs/glossar")).toBe(false);
    expect(isExternal("#anker")).toBe(false);
  });
});

describe("assertSafeHref", () => {
  it("allows the targets the guide uses", () => {
    for (const href of ["https://x.ch", "http://localhost:3000", "mailto:a@b.ch", "#anker", "GLOSSAR.md", "GLOSSAR.md#tabelle", "./GLOSSAR.md", "/console"]) {
      expect(() => assertSafeHref(href), href).not.toThrow();
    }
  });

  it("rejects any other scheme and relative paths", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///c", "ftp://x"]) {
      expect(() => assertSafeHref(href), href).toThrow(/Schema/);
    }
    expect(() => assertSafeHref("bild.png")).toThrow(/nicht vorgesehen/);
  });
});
