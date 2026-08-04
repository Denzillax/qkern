import type { RealtimeJson, RealtimeScope } from "@/lib/server/realtime/model";

/**
 * Postgres Changes: Vertrag für die Zustellung von Datenbankänderungen.
 *
 * ## Warum getrennt vom Event-Log
 *
 * Broadcast-Ereignisse sind beim Schreiben bereits autorisiert: Der Absender hat
 * die Kanalpolicy passiert. Datenbankänderungen entstehen dagegen **außerhalb**
 * von QKERN — durch die Generated Data API, durch einen Migrationslauf, durch
 * einen Operator mit direkter Verbindung. Für sie gilt die Autorisierung des
 * Absenders nicht.
 *
 * Daraus folgt: **Row Level Security pro Ereignis und pro Abonnent.** Ob ein
 * Abonnent eine geänderte Zeile sehen darf, hängt von seinen Claims ab, nicht
 * vom Kanal. Zwei Abonnenten desselben Kanals dürfen unterschiedliche Teilmengen
 * derselben Änderung erhalten. Deshalb läuft CDC nicht über `RealtimeEventLog`,
 * dessen Ereignisse kanalweit sichtbar sind.
 *
 * ## Getroffene Entwurfsentscheidungen
 *
 * **Quelle: Trigger, nicht logische Replikation.** `db/project/0001` prüft für
 * jede Rolle einer Projektdatenbank ausdrücklich `rolreplication = false`.
 * Replikation zu verwenden hieße, diese Zusicherung umzukehren und jeder
 * Projektdatenbank ein Replikationsrecht zu geben. Ein hängender Konsument ließe
 * zudem den Slot unbegrenzt WAL halten, bis die Platte voll ist. Trigger sind
 * begrenzbar, und das Anschalten je Tabelle durchläuft den vorhandenen
 * Change-Set- und Approval-Weg.
 *
 * **Nutzlast: keine gespeicherten Zeilenwerte.** Der Feed hält ausschließlich
 * die Primärschlüsselwerte. Die Zeile wird je Abonnent frisch mit dessen Claims
 * gelesen; RLS autorisiert und erzeugt die Nutzlast in einem Schritt. Läge die
 * Zeile im Feed, bräuchte es eine zweite Sichtbarkeitsprüfung außerhalb der
 * Datenbank — eine Kopie der RLS-Logik und damit eine dauerhafte Fehlerquelle.
 *
 * **Löschungen: nur für `service_role`.** Nach einem `DELETE` existiert die
 * Zeile nicht mehr, RLS kann also nicht mehr beantworten, wer sie hätte sehen
 * dürfen. Sie trotzdem an alle Kanalabonnenten zu melden, würde die Existenz
 * eines Schlüssels offenlegen, den manche nie sehen durften. Löschungen erreichen
 * deshalb ausschließlich Abonnenten mit `service_role`. Das ist eine bewusste
 * Funktionslücke, keine Übersehung.
 *
 * **Rückstau: schließen statt still verwerfen.** Ein Abonnent, der nicht
 * mitkommt, verliert sein Abonnement mit einem eigenen Fehlercode. Ereignisse
 * stillschweigend zu überspringen würde demselben Vertrag widersprechen, den die
 * Cursor-Prüfung an anderer Stelle zusichert.
 */

export type RealtimeChangeOperation = "insert" | "update" | "delete";

/**
 * Eine erfasste Änderung. Enthält bewusst **keine** Zeilenwerte, nur den
 * Primärschlüssel und die Position im Feed.
 */
export type RealtimeChange = RealtimeScope & {
  position: number;
  schema: string;
  table: string;
  operation: RealtimeChangeOperation;
  key: Record<string, RealtimeJson>;
  committedAt: Date;
};

export interface RealtimeChangeSource {
  /**
   * Liest Änderungen mit Position größer `after`, höchstens `limit` Stück.
   * Der Aufrufer bestimmt den Takt; die Quelle hält keinen eigenen Zustand.
   */
  read(scope: RealtimeScope, after: number, limit: number): Promise<RealtimeChange[]>;

  /** Entfernt bestätigte Änderungen bis einschließlich `through`. */
  prune(scope: RealtimeScope, through: number): Promise<number>;
}

/** Claims eines Abonnenten, wie sie die Data Plane in RLS-Settings übersetzt. */
export type RealtimeSubscriberClaims = {
  role: "anon" | "authenticated" | "service_role";
  subject?: string;
  claims?: Record<string, RealtimeJson>;
};

/**
 * Liest die geänderte Zeile mit den Claims eines Abonnenten.
 *
 * Gibt `null` zurück, wenn der Abonnent sie nicht sehen darf — und ebenso, wenn
 * die Prüfung nicht durchgeführt werden konnte. Eine Implementierung muss
 * fail-closed sein: Im Zweifel wird nicht zugestellt.
 */
export interface RealtimeChangeReader {
  read(
    change: RealtimeChange,
    subscriber: RealtimeSubscriberClaims,
  ): Promise<Record<string, RealtimeJson> | null>;
}
