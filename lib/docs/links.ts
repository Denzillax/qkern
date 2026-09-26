import { GUIDE_PAGES } from "@/lib/docs/pages";

/** Dateiname ohne .md auf Website-Pfad, abgeleitet aus der einen Seitenliste. */
const PATH_BY_FILE: ReadonlyMap<string, string> = new Map(
  GUIDE_PAGES.map((page) => [page.file.replace(/\.md$/, ""), page.slug ? `/docs/${page.slug}` : "/docs"]),
);

/** Links auf andere Guide-Dateien werden zu Website-Pfaden; alles andere bleibt. */
export function guideHref(href: string): string {
  const match = /^([A-Z_]+)\.md(#.*)?$/.exec(href);
  if (!match) return href;
  const path = PATH_BY_FILE.get(match[1]);
  if (path === undefined) return href;
  return `${path}${match[2] ?? ""}`;
}

/** Ziele mit Schema (https:, mailto:) verlassen die Website und gehen nicht ueber den Router. */
export function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}
