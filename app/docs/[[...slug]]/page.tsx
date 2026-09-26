import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { GuideDocument } from "@/components/docs/guide-document";
import { loadGuidePage } from "@/lib/docs/load";
import { GUIDE_PAGES, pageBySlug } from "@/lib/docs/pages";
import { getLandingDictionary } from "@/lib/i18n/landing";
import { currentLocale } from "@/lib/i18n/server";
import styles from "../docs.module.css";

type Params = { slug?: string[] };

export function generateStaticParams(): Params[] {
  return GUIDE_PAGES.map((page) => ({ slug: page.slug ? [page.slug] : [] }));
}

function resolve(params: Params) {
  if ((params.slug?.length ?? 0) > 1) return undefined;
  return pageBySlug(params.slug?.[0] ?? "");
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = resolve(await params);
  if (!page) return {};
  const t = getLandingDictionary(await currentLocale());
  return { title: `${page.title} · QKERN ${t.docs.title}` };
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const page = resolve(await params);
  if (!page) notFound();
  const locale = await currentLocale();
  const t = getLandingDictionary(locale).docs;
  const loaded = await loadGuidePage(locale, page);
  return (
    <div className={styles.layout}>
      {/* Nur einfache Daten an die Client-Komponente. */}
      <DocsSidebar
        pages={GUIDE_PAGES.map(({ slug, title }) => ({ slug, title }))}
        headings={loaded.document.headings.map(({ level, id, text }) => ({ level, id, text }))}
        labels={{ pages: t.pages, onThisPage: t.onThisPage, menu: t.menu }}
      />
      <div className={styles.content}>
        {!loaded.translated && <p className={styles.pending}>{t.translationPending}</p>}
        <GuideDocument blocks={loaded.document.blocks} labels={{ copy: t.copy, copied: t.copied }} />
      </div>
    </div>
  );
}
