import { describe, expect, it } from "vitest";
import { guideHref, isExternal } from "@/lib/docs/links";

describe("guideHref", () => {
  it("maps guide files to website paths", () => {
    expect(guideHref("GLOSSAR.md#tabelle")).toBe("/docs/glossar#tabelle");
    expect(guideHref("WAS_IST_QKERN.md")).toBe("/docs");
    expect(guideHref("FUER_GRUENDER.md")).toBe("/docs/gruender");
  });

  it("leaves everything else unchanged", () => {
    expect(guideHref("https://x")).toBe("https://x");
    expect(guideHref("UNBEKANNT.md")).toBe("UNBEKANNT.md");
    expect(guideHref("#anker")).toBe("#anker");
  });

  it("tells external links from internal ones", () => {
    expect(isExternal("https://x")).toBe(true);
    expect(isExternal("mailto:a@b.ch")).toBe(true);
    expect(isExternal("/docs/glossar")).toBe(false);
    expect(isExternal("#anker")).toBe(false);
  });
});
