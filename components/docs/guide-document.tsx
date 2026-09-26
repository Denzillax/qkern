import { Fragment } from "react";
import Link from "next/link";
import type { Block, Inlines as InlineList } from "@/lib/docs/markdown";
import { assertSafeHref, guideHref, isExternal } from "@/lib/docs/links";
import { CopyButton } from "@/components/docs/copy-button";
import styles from "@/app/docs/docs.module.css";

/** Neue Arten in markdown.ts brechen hier den Typcheck statt still zu fehlen. */
function unreachable(value: never): never {
  throw new Error(`Unbekannte Art: ${JSON.stringify(value)}`);
}

function Inlines({ text }: { text: InlineList }) {
  return <>{text.map((inline, index) => {
    switch (inline.kind) {
      case "text": return <Fragment key={index}>{inline.text}</Fragment>;
      case "strong": return <strong key={index}>{inline.text}</strong>;
      case "em": return <em key={index}>{inline.text}</em>;
      case "code": return <code key={index}>{inline.text}</code>;
      case "link": {
        assertSafeHref(inline.href);
        const href = guideHref(inline.href);
        if (isExternal(href)) return <a key={index} href={href} rel="noreferrer">{inline.text}</a>;
        // Reine Anker bleiben auf der Seite und brauchen keinen Router.
        if (href.startsWith("#")) return <a key={index} href={href}>{inline.text}</a>;
        return <Link key={index} href={href}>{inline.text}</Link>;
      }
    }
    return unreachable(inline);
  })}</>;
}

/** Rendert die geparsten Bloecke einer Guide-Seite. */
export function GuideDocument({ blocks, labels }: { blocks: readonly Block[]; labels: { copy: string; copied: string } }) {
  return <article className={styles.article}>{blocks.map((block, index) => {
    switch (block.kind) {
      case "heading": {
        // Der Parser weist Links in Ueberschriften ab, darum ist der Selbstlink hier kein Link im Link.
        const Tag = `h${block.level}` as "h1" | "h2" | "h3";
        return <Tag key={index} id={block.id}><a href={`#${block.id}`} className={styles.anchor}><Inlines text={block.text} /></a></Tag>;
      }
      case "paragraph": return <p key={index}><Inlines text={block.text} /></p>;
      case "list": return <ul key={index}>{block.items.map((item, i) => <li key={i}><Inlines text={item} /></li>)}</ul>;
      case "ordered": return <ol key={index}>{block.items.map((item, i) => <li key={i}><Inlines text={item} /></li>)}</ol>;
      case "code": return (
        <div key={index} className={styles.code}>
          <span className={styles.language}>{block.language}</span>
          <CopyButton code={block.code} labels={labels} />
          <pre><code>{block.code}</code></pre>
        </div>
      );
      case "table": return (
        <div key={index} className={styles.tableWrap}>
          <table>
            <thead><tr>{block.header.map((cell, i) => <th key={i}><Inlines text={cell} /></th>)}</tr></thead>
            <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><Inlines text={cell} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      case "quote": return <aside key={index} className={styles.note}><Inlines text={block.text} /></aside>;
    }
    return unreachable(block);
  })}</article>;
}
