"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import styles from "@/app/docs/docs.module.css";

/** Seitenliste und Abschnitte der aktuellen Seite; auf schmalen Schirmen zugeklappt. */
export function DocsSidebar({ pages, headings, labels, headingsLang }: {
  pages: ReadonlyArray<{ slug: string; title: string }>;
  headings: ReadonlyArray<{ level: 2 | 3; id: string; text: string }>;
  labels: { pages: string; onThisPage: string; menu: string };
  /** "de", wenn die Seite auf Deutsch zurueckfiel; die Abschnittstitel kommen dann aus dem deutschen Text. Seitentitel stehen immer in der Sprache der Website. */
  headingsLang?: "de";
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sections = headings.filter((heading) => heading.level === 2);
  return (
    <nav className={open ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar} aria-label={labels.menu}>
      <button type="button" className={styles.sidebarToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        {labels.menu} <ChevronDown size={14} aria-hidden />
      </button>
      <div className={styles.sidebarBody}>
        <span className={styles.sidebarLabel}>{labels.pages}</span>
        {pages.map((page) => {
          const href = page.slug ? `/docs/${page.slug}` : "/docs";
          const current = pathname === href;
          return <Link key={href} href={href} className={current ? styles.active : undefined} aria-current={current ? "page" : undefined} onClick={() => setOpen(false)}>{page.title}</Link>;
        })}
        {sections.length > 0 && <>
          <span className={styles.sidebarLabel}>{labels.onThisPage}</span>
          {sections.map((heading) => <a key={heading.id} href={`#${heading.id}`} className={styles.headingLink} lang={headingsLang} onClick={() => setOpen(false)}>{heading.text}</a>)}
        </>}
      </div>
    </nav>
  );
}
