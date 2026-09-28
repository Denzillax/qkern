"use client";

import { Blocks } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { PLACEHOLDERS, groupOf, isPlaceholder, type ViewId } from "@/components/console/navigation";

/**
 * Ein Menüpunkt, den Supabase Studio hat und QKERN noch nicht: sagt, wie er
 * dort heisst, was das Backend schon kann, und zeigt die Nachbarn der Gruppe.
 */
export function PlaceholderView({ view, navigate }: { view: ViewId; navigate: (view: ViewId) => void }) {
  if (!isPlaceholder(view)) return null;
  const entry = PLACEHOLDERS[view];
  const group = groupOf(view);
  const backendLabel = { vorhanden: t("Backend vorhanden"), teilweise: t("Backend teilweise"), fehlt: t("Backend fehlt") }[entry.backend];
  return <div className="placeholder-view">
    <article className="console-card placeholder-state"><Blocks size={26}/><div><span className="console-kicker">{t(group.label)} · {t("Platzhalter")}</span><h2>{t(entry.label)}: {t("noch nicht verbunden")}</h2><p>{t(entry.note)}</p><div className="placeholder-meta"><span>Bei Supabase: {entry.supabase}</span><span className={`backend-${entry.backend}`}>{backendLabel}</span></div></div></article>
    {group.children && group.children.length > 1 && <article className="console-card"><div className="card-head"><div><span>{t(group.label).toUpperCase()}</span><h3>{t("Weitere Seiten dieser Gruppe")}</h3></div></div><div className="placeholder-siblings">{group.children.map((child) => <button key={child.id} type="button" className={child.id === view ? "active" : ""} onClick={() => navigate(child.id)}><i style={{ background: isPlaceholder(child.id) ? "var(--qkern-text-muted)" : "var(--qkern-success)" }}/>{t(child.label)}</button>)}</div></article>}
  </div>;
}
