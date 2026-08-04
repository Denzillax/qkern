import type { RealtimeJson, RealtimeScope } from "@/lib/server/realtime/model";

/**
 * Vorbereiteter Port für Postgres Changes (CDC).
 *
 * **Dieser Port ist bewusst nicht implementiert.** Er hält die Architektur für
 * den nächsten Slice fest, damit dieser nicht neu entworfen werden muss, und
 * er markiert die Stelle, an der die Grenze verläuft.
 *
 * ## Warum getrennt vom Event-Log
 *
 * Broadcast-Ereignisse entstehen im Dienst und sind bereits autorisiert, wenn
 * sie in den Log geschrieben werden: Der Absender hat die Kanalpolicy passiert.
 * Datenbankänderungen entstehen dagegen **außerhalb** von QKERN — durch die
 * Generated Data API, durch einen Migrationslauf, durch einen Operator mit
 * direkter Verbindung. Für sie gilt die Autorisierung des Absenders nicht.
 *
 * Daraus folgt die zentrale Anforderung: **RLS pro Ereignis und pro Abonnent.**
 * Ob ein Abonnent eine geänderte Zeile sehen darf, hängt von seinen Claims ab,
 * nicht vom Kanal. Zwei Abonnenten desselben Kanals dürfen unterschiedliche
 * Teilmengen derselben Änderung erhalten. Ein Fan-out, der die Zeile einmal
 * autorisiert und dann an alle verteilt, wäre ein Cross-Tenant-Leck.
 *
 * Deshalb darf CDC **nicht** über `RealtimeEventLog` laufen. Dessen Ereignisse
 * sind kanalweit sichtbar; genau das ist bei Broadcast korrekt und bei
 * Datenänderungen falsch.
 *
 * ## Offene Entwurfsentscheidungen für den nächsten Slice
 *
 * 1. **Quelle**: logische Replikation (`pgoutput`/`wal2json`) gegen
 *    tabellenbezogene Trigger. Replikation sieht jede Änderung ohne
 *    Schemaeingriff, verlangt aber einen Replikations-Slot, dessen unbegrenztes
 *    Wachstum bei hängendem Konsumenten die Datenbank füllt. Trigger sind
 *    einfacher zu begrenzen, ändern aber das Nutzerschema.
 * 2. **Autorisierung**: Prüfung pro Abonnent über eine tenantgebundene
 *    Transaktion mit den Claims des Abonnenten, oder vorberechnete Sichtbarkeit
 *    beim Einlesen. Ersteres ist korrekt und teuer, Letzteres schnell und
 *    schwer korrekt zu halten.
 * 3. **Rückstau**: Ein langsamer Abonnent darf den Slot nicht wachsen lassen.
 *    Es braucht eine Grenze, ab der ein Abonnent abgeworfen statt gepuffert
 *    wird, und einen Weg, das dem Client mitzuteilen statt still zu verwerfen.
 *
 * Keine dieser Fragen ist beantwortet. Sie zu beantworten ist der Inhalt des
 * Slice, nicht seine Voraussetzung.
 */
export type RealtimeChangeOperation = "insert" | "update" | "delete";

export type RealtimeChange = RealtimeScope & {
  /** Schema und Tabelle der geänderten Zeile. */
  schema: string;
  table: string;
  operation: RealtimeChangeOperation;
  /** Monotone Position in der Änderungsquelle, für Wiederaufnahme. */
  position: string;
  /** Zeilenwerte nach der Änderung; bei `delete` die Primärschlüsselwerte. */
  record: Record<string, RealtimeJson>;
  /** Zeilenwerte vor der Änderung, sofern die Quelle sie liefert. */
  previous?: Record<string, RealtimeJson>;
  committedAt: Date;
};

export interface RealtimeChangeSource {
  /**
   * Liefert Änderungen ab `position`. Der Aufrufer bestätigt Verarbeitung über
   * `acknowledge`, damit die Quelle ihren Fortschritt begrenzen kann.
   */
  stream(from: string | null, handler: (change: RealtimeChange) => Promise<void>): Promise<void>;
  acknowledge(position: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Entscheidet je Abonnent, ob eine Änderung sichtbar ist.
 *
 * Getrennt vom Transport, weil die Antwort von den Claims des Abonnenten
 * abhängt und nicht vom Kanal. Eine Implementierung muss fail-closed sein: Im
 * Zweifel wird nicht zugestellt.
 */
export interface RealtimeChangeVisibility {
  visible(change: RealtimeChange, subscriberClaims: Record<string, RealtimeJson>): Promise<boolean>;
}
