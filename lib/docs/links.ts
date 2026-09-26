import { GUIDE_PAGES } from "@/lib/docs/pages";

/** Dateiname ohne .md auf Website-Pfad, abgeleitet aus der einen Seitenliste. */
const PATH_BY_FILE: ReadonlyMap<string, string> = new Map(
  GUIDE_PAGES.map((page) => [page.file.replace(/\.md$/, ""), page.slug ? `/docs/${page.slug}` : "/docs"]),
);

const GUIDE_FILE = /^(?:\.\/)?([A-Z_]+)\.md(#.*)?$/;

/** Links auf andere Guide-Dateien werden zu Website-Pfaden; alles andere bleibt. */
export function guideHref(href: string): string {
  const match = GUIDE_FILE.exec(href);
  if (!match) return href;
  const path = PATH_BY_FILE.get(match[1]);
  if (path === undefined) return href;
  return `${path}${match[2] ?? ""}`;
}

/** Ziele mit Schema (https:, mailto:) oder ohne Schema mit Host (//host) verlassen die Website. */
export function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/**
 * Erlaubt nur Ziele, die die Doku braucht: https, http, mailto, Anker,
 * Guide-Dateien und Pfade (auch //host, das isExternal als extern fuehrt).
 * Jedes andere Schema (javascript:, data: ...) wirft, bevor es als Link im
 * HTML landet; relative Pfade ohne Schema ebenfalls, die Doku braucht keine.
 */
export function assertSafeHref(href: string): void {
  if (/^(https?:|mailto:)/i.test(href)) return;
  if (href.startsWith("#") || href.startsWith("/") || GUIDE_FILE.test(href)) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) throw new Error(`Linkziel mit unerlaubtem Schema: ${href}`);
  throw new Error(`Linkziel nicht vorgesehen: ${href}`);
}
