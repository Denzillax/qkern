import { SiteHeader } from "@/components/site-header";

/** Gleicher Kopf und gleiche Breite wie die Startseite. */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>
    <SiteHeader />
    <main className="container">{children}</main>
  </>;
}
