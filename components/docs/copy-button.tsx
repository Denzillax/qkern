"use client";

import { CopyValue } from "@/components/console/copy-value";

/**
 * Kopiert einen Codeblock der Dokumentation.
 *
 * Seit 2.137 nur noch eine Huelle: Der Mechanismus (Rueckmeldung, stabile
 * Breite, versteckte Bestaetigung) steht in `CopyValue` und gilt damit fuer
 * Docs und Console gleich. Diese Huelle bleibt, weil die Docs ihre eigene
 * Knopfklasse tragen und weil jeder Aufruf sonst angefasst werden muesste.
 */
export function CopyButton({ code, labels }: { code: string; labels: { copy: string; copied: string } }) {
  return <CopyValue value={code} labels={labels} className="ghost-button docs-copy" />;
}
