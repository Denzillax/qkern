/**
 * Die Inhaltslogs je Aufruf (2.98): was ein Function-Container auf stdout
 * und stderr geschrieben hat, Zeile fuer Zeile, mit Zeitpunkt und Strom.
 *
 * Bis 2.97 hat QKERN beides verworfen. stdout war nur die JSON-Leitung
 * zwischen Host und Container, und eine Zeile, die kein JSON war, beendete den
 * Aufruf; stderr wurde gezaehlt und bei 8 KiB gekappt, nie gelesen. Migration
 * 0045 begruendete das mit der Herkunft: fremder Code, der alles gesehen haben
 * koennte. Die Begruendung bleibt richtig, die Folgerung war zu grob. Ein
 * Betreiber, der einen Fehlercode sieht und nicht erfaehrt, warum, kann den
 * Aufruf nicht verstehen. Deshalb werden die Zeilen jetzt aufgehoben, aber
 * unter harten Grenzen und getrennt vom Aufrufprotokoll.
 *
 * ## Die Grenzen
 *
 * Drei Zahlen, alle je Aufruf, alle im Code und in der Migration gleich:
 *
 * - `maxLineBytes`: Eine laengere Zeile wird abgeschnitten und traegt `cut`.
 * - `maxLines`: Weitere Zeilen werden gezaehlt, aber nicht behalten.
 * - `maxBytes`: Ueber die Summe der behaltenen Zeilen hinaus wird ebenfalls
 *   nur noch gezaehlt.
 *
 * Wird eine der drei Grenzen erreicht, steht `truncated` am Protokoll, und
 * `droppedLines` sagt, wie viele Zeilen fehlen. Das Protokoll tut nie so, als
 * waere es vollstaendig, wenn es das nicht ist.
 *
 * ## Geheimnisse
 *
 * QKERN streicht **keine** Werte aus den Zeilen, und zwar mit Grund: Es gibt
 * nichts, wogegen es streichen koennte. Der Prozess, der den Container
 * startet, kennt keinen Wert eines Geheimnisses. Die Definition traegt nur
 * Referenzen (`secretRefs`), der Container bekommt nur diese Referenzen ueber
 * stdin, `--env` wird nie gesetzt, und die Umgebung des Prozesses selbst
 * bleibt draussen (nur `PATH` geht mit; der Canary-Fall der Zertifizierung
 * prueft das). Ein Wert, den QKERN nicht hat, kann in keiner Zeile stehen,
 * die QKERN von sich aus liefert.
 *
 * Ein Filter, der trotzdem nach etwas suchte, waere eine Zusage ohne Deckung:
 * Er suggerierte, QKERN wuerde Geheimnisse aus dem Log halten, obwohl er den
 * Wert gar nicht kennt, den er halten soll. Was eine Function aus einer
 * vermittelten Ausgangsverbindung erhaelt und dann selbst ausgibt, ist ihre
 * Sache, genau wie der Inhalt ihrer Antwort. Die Verantwortung liegt bei der
 * Function, und das Handbuch sagt das woertlich.
 *
 * Das Modul ist rein: keine Datenbank, kein Docker, kein React.
 */

export type FunctionOutputStream = "stdout" | "stderr";

export type FunctionOutputLine = Readonly<{
  /** Zeitpunkt, an dem die Zeile den Host erreicht hat; ISO-8601. */
  at: string;
  stream: FunctionOutputStream;
  text: string;
  /** Die Zeile war laenger als `maxLineBytes` und ist abgeschnitten. */
  cut: boolean;
}>;

export type FunctionOutputRecord = Readonly<{
  lines: readonly FunctionOutputLine[];
  lineCount: number;
  stdoutLines: number;
  stderrLines: number;
  /** Bytes der behaltenen Zeilen, nach dem Abschneiden. */
  byteCount: number;
  /** Mindestens eine Grenze hat gegriffen. */
  truncated: boolean;
  /** Zeilen, die wegen `maxLines` oder `maxBytes` nicht behalten wurden. */
  droppedLines: number;
}>;

export type FunctionOutputLimits = Readonly<{
  maxBytes: number;
  maxLines: number;
  maxLineBytes: number;
}>;

/**
 * Die Grenzen je Aufruf. Migration 0069 prueft dieselben Zahlen als CHECK:
 * Wer eine aendert, aendert beide.
 */
export const FUNCTION_OUTPUT_LIMITS: FunctionOutputLimits = Object.freeze({
  maxBytes: 64 * 1024,
  maxLines: 500,
  maxLineBytes: 2 * 1024,
});

/** Was die Sandbox bekommt: eine Zeile je Aufruf, sonst nichts. */
export interface FunctionOutputSink {
  line(stream: FunctionOutputStream, text: string): void;
}

/** Ein Sink, der alles verwirft. Fuer Aufrufer ohne Protokoll. */
export const DISCARDING_OUTPUT_SINK: FunctionOutputSink = Object.freeze({
  line() { /* verworfen */ },
});

/**
 * Sammelt die Zeilen eines Aufrufs unter den Grenzen.
 *
 * Die Zeit kommt von aussen, damit ein Fall sie festhalten kann. Der
 * Zeitpunkt ist der des Eintreffens beim Host, nicht der des Schreibens im
 * Container: Der Container hat keine Uhr, der QKERN trauen muesste.
 */
export class FunctionOutputCollector implements FunctionOutputSink {
  private readonly lines: FunctionOutputLine[] = [];
  private stdoutLines = 0;
  private stderrLines = 0;
  private byteCount = 0;
  private droppedLines = 0;
  private cutLines = 0;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly limits: FunctionOutputLimits = FUNCTION_OUTPUT_LIMITS,
  ) {}

  line(stream: FunctionOutputStream, text: string): void {
    if (stream === "stdout") this.stdoutLines += 1;
    else this.stderrLines += 1;
    if (this.lines.length >= this.limits.maxLines) {
      this.droppedLines += 1;
      return;
    }
    const { text: kept, cut } = cutLine(text, this.limits.maxLineBytes);
    const bytes = Buffer.byteLength(kept, "utf8");
    if (this.byteCount + bytes > this.limits.maxBytes) {
      this.droppedLines += 1;
      return;
    }
    if (cut) this.cutLines += 1;
    this.byteCount += bytes;
    this.lines.push(Object.freeze({ at: this.now().toISOString(), stream, text: kept, cut }));
  }

  /** Gab es ueberhaupt etwas? Ohne Zeile wird keine Protokollzeile geschrieben. */
  isEmpty(): boolean {
    return this.lines.length === 0 && this.droppedLines === 0;
  }

  snapshot(): FunctionOutputRecord {
    return Object.freeze({
      lines: Object.freeze([...this.lines]),
      lineCount: this.lines.length,
      stdoutLines: this.stdoutLines,
      stderrLines: this.stderrLines,
      byteCount: this.byteCount,
      truncated: this.droppedLines > 0 || this.cutLines > 0,
      droppedLines: this.droppedLines,
    });
  }
}

/**
 * Schneidet eine Zeile auf hoechstens `maxBytes` UTF-8-Bytes, ohne ein
 * Mehrbyte-Zeichen zu zerreissen. Ein Wagenruecklauf am Ende faellt weg, damit
 * ein Container mit CRLF nicht anders aussieht als einer mit LF.
 */
export function cutLine(raw: string, maxBytes: number): { text: string; cut: boolean } {
  const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, cut: false };
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += character.length;
  }
  return { text: text.slice(0, end), cut: true };
}
