import type { FunctionSecretInspector, FunctionSecretStatus } from
  "@/lib/server/compute/function-secret-inspector";

/**
 * Die Vault-Uebersicht einer Projektumgebung (2.58).
 *
 * ## Was diese Naht tut
 *
 * Sie sammelt jede Secret-Referenz, die QKERN selbst kennt, gruppiert sie und
 * laesst den Inspektor aus 2.38 je Referenz genau einmal fragen, ob der Vault
 * sie aufloest. Das Ergebnis ist je Referenz ein Wort aus drei
 * (`present`, `missing`, `forbidden`) und die Liste der Stellen, die sie
 * benutzen.
 *
 * ## Was sie mit Absicht nicht tut
 *
 * Sie listet den Vault nicht. Es gibt in diesem Modul keinen LIST-Aufruf und
 * keinen Pfad, der einen Ordner aufzaehlt. Daraus folgt eine Grenze, die offen
 * dasteht und in der Ansicht woertlich steht: **Ein Geheimnis, auf das nichts
 * in QKERN zeigt, taucht hier nicht auf.** Es unsichtbar zu lassen ist die
 * ehrlichere Haelfte; die Alternative waere ein Verzeichnis fremder Pfade in
 * einer Web-Konsole, und wer die Konsole liest, erfuehre damit die Struktur des
 * Schluesselspeichers, ohne je eine Vault-Policy dafuer bekommen zu haben.
 *
 * Und sie traegt keinen Wert. Es gibt in diesem Modul keinen Typ, kein Feld und
 * keine Rueckgabe, die ein Geheimnis halten koennte; der Inspektor liefert nur
 * eines der drei Woerter, und mehr wird nie angefragt.
 */

/** Wer eine Referenz benutzt. Drei Quellen, mehr kennt QKERN heute nicht. */
export type VaultReferenceUserKind = "function" | "webhook" | "database-webhook";

export type VaultReferenceUser = Readonly<{
  kind: VaultReferenceUserKind;
  id: string;
  name: string;
}>;

/**
 * Eine Referenz mit allen Stellen, die sie benutzen.
 *
 * Gruppiert wird nach der Referenz, nicht nach dem Benutzer: Ein Geheimnis, das
 * zwei Webhooks signiert, ist ein Geheimnis. Es zweimal zu zeigen hiesse, den
 * Betreiber zweimal denselben Vault-Pfad pruefen zu lassen.
 */
export type VaultReferenceGroup = Readonly<{
  ref: string;
  users: readonly VaultReferenceUser[];
}>;

export type VaultReferenceRow = VaultReferenceGroup & Readonly<{ status: FunctionSecretStatus }>;

export type VaultReferenceCounts = Readonly<{
  total: number;
  present: number;
  missing: number;
  forbidden: number;
}>;

/**
 * Die drei Listen, aus denen die Uebersicht entsteht. Bewusst Strukturtypen
 * statt der Datensatztypen der Dienste: Dieses Modul soll nichts anderes sehen
 * als Name, Kennung und Referenz.
 */
export type VaultSecretSources = Readonly<{
  functions: ReadonlyArray<{ id: string; name: string; secretRefs: readonly string[] }>;
  webhooks: ReadonlyArray<{ id: string; name: string; signingSecretRef: string }>;
  databaseWebhooks: ReadonlyArray<{
    id: string; webhookId: string; name: string; signingSecretRef: string;
  }>;
}>;

const KIND_ORDER: Record<VaultReferenceUserKind, number> = {
  function: 0, webhook: 1, "database-webhook": 2,
};

/**
 * Sammelt und gruppiert, ohne zu fragen. Rein: kein Netz, keine Datenbank,
 * keine Zeit.
 *
 * Ein Datenbank-Webhook besitzt seit 2.50 **auch** eine ausgehende
 * Webhook-Definition aus 0032. Die Definition erscheint deshalb nicht noch
 * einmal als eigener Benutzer -- sonst stuende dieselbe Referenz unter zwei
 * Namen da und sae den Verdacht, es gaebe zwei Geheimnisse.
 */
export function groupSecretReferences(sources: VaultSecretSources): VaultReferenceGroup[] {
  const owned = new Set(sources.databaseWebhooks.map((entry) => entry.webhookId));
  const groups = new Map<string, Map<string, VaultReferenceUser>>();

  const add = (ref: unknown, user: VaultReferenceUser) => {
    if (typeof ref !== "string" || ref.trim() === "") return;
    const users = groups.get(ref) ?? new Map<string, VaultReferenceUser>();
    // Derselbe Benutzer mit derselben Referenz zaehlt einmal, auch wenn eine
    // Definition sie doppelt deklariert.
    users.set(`${user.kind}:${user.id}`, user);
    groups.set(ref, users);
  };

  for (const item of sources.functions) {
    for (const ref of item.secretRefs) {
      add(ref, { kind: "function", id: item.id, name: item.name });
    }
  }
  for (const item of sources.webhooks) {
    if (owned.has(item.id)) continue;
    add(item.signingSecretRef, { kind: "webhook", id: item.id, name: item.name });
  }
  for (const item of sources.databaseWebhooks) {
    add(item.signingSecretRef, { kind: "database-webhook", id: item.id, name: item.name });
  }

  return [...groups.entries()]
    .map(([ref, users]) => ({
      ref,
      users: [...users.values()].sort((left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
}

/**
 * Fragt den Inspektor je **Referenz** genau einmal.
 *
 * Nicht je Benutzer: Zwei Webhooks mit demselben Geheimnis sind eine Frage an
 * den Vault, nicht zwei. Die Fragen laufen nebeneinander; der Inspektor bringt
 * sein eigenes Zeitlimit mit.
 */
export async function collectVaultSecretOverview(
  sources: VaultSecretSources,
  inspector: FunctionSecretInspector,
): Promise<VaultReferenceRow[]> {
  const groups = groupSecretReferences(sources);
  const statuses = await Promise.all(groups.map((group) => inspector.hasSecret(group.ref)));
  return groups.map((group, index) => ({ ...group, status: statuses[index] }));
}

export function countVaultReferences(rows: readonly VaultReferenceRow[]): VaultReferenceCounts {
  return {
    total: rows.length,
    present: rows.filter((row) => row.status === "present").length,
    missing: rows.filter((row) => row.status === "missing").length,
    forbidden: rows.filter((row) => row.status === "forbidden").length,
  };
}
