import type {
  RealtimeJson,
  RealtimePresenceEntry,
  RealtimeScope,
} from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";

/**
 * Presence, die einen Prozess ueberlebt.
 *
 * ## Was Presence ist, und warum sie eine Pacht braucht
 *
 * Presence ist der Zustand, den ein Abonnent eines Kanals ueber sich
 * bekanntgibt: wer da ist und was er tut. Sie ist damit die einzige Angabe im
 * Produkt, die etwas **Lebendes** behauptet. Jede andere Zeile sagt, dass etwas
 * geschehen ist; eine Presence-Zeile sagt, dass gerade jemand da ist.
 *
 * Daraus folgt die eine Entscheidung, an der dieser Port haengt: **Ein Eintrag
 * laeuft ab, wenn ihn niemand erneuert.** Eine Verbindung verschwindet auch
 * ohne Abmeldung, und zwar regelmaessig: gekapptes Netz, getoeteter Prozess,
 * abgestuerzter Rechner. Ein Leave schreibt in diesen Faellen niemand. Ein
 * Eintrag ohne Frist bliebe also stehen und zeigte auf Dauer Abwesende an --
 * und das ist schlimmer als gar keine Presence, weil eine leere Liste ehrlich
 * ist und eine falsche nicht.
 *
 * Die Pacht wirkt in zwei getrennten Stufen, und die Trennung ist der Kern:
 *
 * 1. **`list` gibt nur zurueck, was zum genannten Zeitpunkt noch gilt.** Die
 *    Sichtbarkeit endet am Ablauf, nicht am Loeschen. Eine abgelaufene Zeile
 *    zaehlt fuer keinen Leser mehr, auch wenn sie noch steht.
 * 2. **`prune` entfernt die Zeile eine Frist nach dem Ablauf.** Das ist Betrieb
 *    und kein Zustellpfad, genau wie beim Event-Log.
 *
 * Ohne Stufe 1 waere Stufe 2 ein Fenster, in dem Abwesende als anwesend gelten.
 * Ohne Stufe 2 waere Stufe 1 eine Tabelle, die von Waisen lebt.
 *
 * ## Warum der Scope-Schnitt so liegt
 *
 * Gelesen wird je Kanal, geschrieben je Eintrag, aufgeraeumt je Scope. Der
 * Aufraeumer kennt bewusst keinen Kanal: Eine Waise entsteht nicht in einem
 * Kanal, sondern in einer Instanz, und sie kann in jedem Kanal liegen, den
 * diese Instanz bedient hat.
 */

/** Ein Eintrag, wie ihn der Dienst schreibt. */
export type RealtimePresenceWrite = RealtimePresenceEntry & {
  /** Instanz, deren Verbindung diesen Eintrag haelt. Kein Abonnent erfaehrt sie. */
  instanceId: string;
  trackedAt: Date;
  expiresAt: Date;
};

export interface RealtimePresenceStore {
  /**
   * Legt einen Eintrag an oder schreibt ihn fort. Derselbe Schluessel im
   * selben Kanal ist derselbe Eintrag; ein zweites `track` ersetzt den Zustand
   * und erneuert die Pacht.
   */
  put(scope: RealtimeScope, channel: string, entry: RealtimePresenceWrite): Promise<void>;

  /** Entfernt einen Eintrag. Die ausdrueckliche Abmeldung. */
  remove(scope: RealtimeScope, channel: string, presenceKey: string): Promise<void>;

  /**
   * Alle zum Zeitpunkt `now` gueltigen Eintraege eines Kanals, ueber alle
   * Instanzen hinweg. Hoechstens `limit` Stueck, nach Schluessel geordnet,
   * damit zwei Instanzen denselben Schnitt sehen.
   */
  list(
    scope: RealtimeScope, channel: string, now: Date, limit: number,
  ): Promise<RealtimePresenceEntry[]>;

  /**
   * Verlaengert die Pacht der genannten eigenen Eintraege und gibt zurueck, wie
   * viele es waren. Fremde Eintraege bleiben unberuehrt: Eine Instanz darf nur
   * fuer ihre eigenen Verbindungen behaupten, dass sie noch da sind.
   */
  renew(
    scope: RealtimeScope, channel: string, instanceId: string,
    presenceKeys: readonly string[], expiresAt: Date,
  ): Promise<number>;

  /**
   * Loescht abgelaufene Eintraege, hoechstens `limit` Stueck, und gibt zurueck
   * wie viele. Der Aufrufer wiederholt, solange eine volle Portion kam.
   */
  prune(scope: RealtimeScope, expiredBefore: Date, limit: number): Promise<number>;
}

export const MAX_PRESENCE_PER_CHANNEL = 1_000;

/**
 * Prozesslokale Presence. Der Default fuer Test und Entwicklung, und
 * ausdruecklich **kein** Ersatz: Sie ueberlebt keinen Neustart und erreicht
 * keine zweite Instanz. Sie fuehrt die Pacht trotzdem mit, damit derselbe
 * Vertrag gilt und ein Fall, der den Ablauf prueft, hier wie dort faellt.
 */
export class MemoryRealtimePresenceStore implements RealtimePresenceStore {
  private readonly entries = new Map<string, Map<string, RealtimePresenceWrite>>();

  async put(scope: RealtimeScope, channel: string, entry: RealtimePresenceWrite): Promise<void> {
    assertLease(entry);
    const key = channelKey(scope, channel);
    const channelEntries = this.entries.get(key) ?? new Map<string, RealtimePresenceWrite>();
    channelEntries.set(entry.presenceKey, clone(entry));
    this.entries.set(key, channelEntries);
  }

  async remove(scope: RealtimeScope, channel: string, presenceKey: string): Promise<void> {
    const channelEntries = this.entries.get(channelKey(scope, channel));
    channelEntries?.delete(presenceKey);
  }

  async list(
    scope: RealtimeScope, channel: string, now: Date, limit: number,
  ): Promise<RealtimePresenceEntry[]> {
    bounded(limit);
    const channelEntries = this.entries.get(channelKey(scope, channel));
    if (!channelEntries) return [];
    return [...channelEntries.values()]
      .filter((entry) => entry.expiresAt.getTime() > now.getTime())
      .sort((left, right) => (left.presenceKey < right.presenceKey ? -1 : 1))
      .slice(0, limit)
      .map((entry) => ({ presenceKey: entry.presenceKey, state: structuredClone(entry.state) }));
  }

  async renew(
    scope: RealtimeScope, channel: string, instanceId: string,
    presenceKeys: readonly string[], expiresAt: Date,
  ): Promise<number> {
    const channelEntries = this.entries.get(channelKey(scope, channel));
    if (!channelEntries) return 0;
    let renewed = 0;
    for (const presenceKey of presenceKeys) {
      const entry = channelEntries.get(presenceKey);
      if (!entry || entry.instanceId !== instanceId) continue;
      entry.expiresAt = new Date(expiresAt);
      renewed += 1;
    }
    return renewed;
  }

  async prune(scope: RealtimeScope, expiredBefore: Date, limit: number): Promise<number> {
    bounded(limit);
    const prefix = `${scope.organizationId}\u0000${scope.projectId}\u0000${scope.environment}\u0000`;
    let removed = 0;
    for (const [key, channelEntries] of this.entries) {
      if (!key.startsWith(prefix)) continue;
      for (const [presenceKey, entry] of channelEntries) {
        if (removed >= limit) return removed;
        if (entry.expiresAt.getTime() >= expiredBefore.getTime()) continue;
        channelEntries.delete(presenceKey);
        removed += 1;
      }
    }
    return removed;
  }
}

function clone(entry: RealtimePresenceWrite): RealtimePresenceWrite {
  return {
    presenceKey: entry.presenceKey,
    state: structuredClone(entry.state) as Record<string, RealtimeJson>,
    instanceId: entry.instanceId,
    trackedAt: new Date(entry.trackedAt),
    expiresAt: new Date(entry.expiresAt),
  };
}

function channelKey(scope: RealtimeScope, channel: string) {
  return `${scope.organizationId}\u0000${scope.projectId}\u0000${scope.environment}\u0000${channel}`;
}

function assertLease(entry: RealtimePresenceWrite) {
  if (!(entry.expiresAt instanceof Date) || !(entry.trackedAt instanceof Date)
    || Number.isNaN(entry.expiresAt.getTime()) || Number.isNaN(entry.trackedAt.getTime())
    || entry.expiresAt.getTime() <= entry.trackedAt.getTime()) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
}

function bounded(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PRESENCE_PER_CHANNEL) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return limit;
}
