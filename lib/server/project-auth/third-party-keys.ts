import { createGuardedFetch, type AddressResolver } from "@/lib/server/net/guarded-fetch";
import { PROJECT_AUTH_THIRD_PARTY_BOUNDS } from "@/lib/server/project-auth/third-party";
import type { JsonWebKey } from "node:crypto";

/**
 * Der Schluesselsatz eines fremden Ausstellers: geholt, begrenzt, gehalten
 * (2.80).
 *
 * ## Warum das Holen nicht hier entschieden wird
 *
 * Der Weg nach draussen laeuft ueber `createGuardedFetch` aus
 * `lib/server/net/guarded-fetch.ts`, also ueber genau dieselbe Adresspruefung,
 * die die Ausgangsverbindungen einer Function nehmen. Das ist keine
 * Bequemlichkeit, sondern die Bedingung dafuer, dass die Zusage etwas wert ist:
 *
 * Hier gibt ein Betreiber eine Adresse ein, und QKERN holt sie. Das ist die
 * Form, in der serverseitige Anfragefaelschung entsteht. Eine zweite,
 * eigene Adresspruefung an dieser Stelle waere ein zweiter Ort, an dem eine
 * Regel steht, und damit ein zweiter Ort, an dem sie hinterherhinkt: Die
 * vorhandene loest den Namen auf, prueft **jede** aufgeloeste Adresse gegen
 * `isPubliclyRoutable`, haelt die geprufte Adresse fuer den Verbindungsaufbau
 * fest, schickt den Namen trotzdem als SNI mit und weist eine Umleitung ab.
 * Nichts davon soll hier noch einmal geschrieben werden.
 *
 * Was hier dazukommt, ist nur, was die vorhandene Stelle nicht wissen kann: die
 * Frist, die Groessengrenze fuer diese Antwort, die Form eines Schluesselsatzes
 * und wie lange er gilt.
 *
 * ## Warum der Satz nicht in der Datenbank steht
 *
 * Eine gespeicherte Kopie waere ein zweiter Wahrheitsort. Dreht der Aussteller
 * seinen Schluessel, prueft QKERN gegen einen Satz, den es nie wieder
 * nachfragen wuerde, und ein zurueckgezogener Schluessel bliebe gueltig. Der
 * Satz liegt darum im Prozessspeicher, mit einer Frist von fuenf Minuten.
 *
 * Der Preis dieser Wahl ist ehrlich zu nennen: Jeder Prozess haelt seinen
 * eigenen Satz. Mehrere Instanzen holen also mehrfach, und ein Neustart holt
 * neu. Das ist der richtige Preis: Der Schluesselsatz eines Ausstellers ist ein
 * paar Kilobyte, und die Alternative waere ein gemeinsamer Zwischenspeicher, der
 * selbst wieder eine Quelle der Wahrheit ist, die niemand prueft.
 *
 * ## Wie ein gedrehter Schluessel trotzdem ankommt
 *
 * Findet die Pruefung im gehaltenen Satz keinen passenden Schluessel, darf der
 * Dienst einmal auf `refresh` bestehen. Damit das kein Hebel wird, gilt dafuer
 * ein Mindestabstand: Wer mit einer erfundenen Schluessel-ID anklopft, loest
 * hoechstens alle 30 Sekunden ein Holen aus und nicht eines je Anfrage.
 */

export interface ProjectAuthThirdPartyKeyPort {
  /** Der gehaltene oder frisch geholte Satz. `null` heisst: heute nicht zu bekommen. */
  keys(jwksUri: string): Promise<readonly JsonWebKey[] | null>;
  /**
   * Besteht auf einem frischen Satz, wenn der Mindestabstand das zulaesst.
   * Sonst kommt der gehaltene Satz zurueck, und der Aufrufer weiss, dass sich
   * nichts geaendert hat.
   */
  refresh(jwksUri: string): Promise<readonly JsonWebKey[] | null>;
}

type Entry = {
  keys: readonly JsonWebKey[] | null;
  expiresAt: number;
  /** Frueheste Zeit, zu der ein erzwungenes Holen wieder erlaubt ist. */
  refreshableAt: number;
};

export type ProjectAuthThirdPartyKeyOptions = {
  fetchFn?: typeof fetch;
  /** Ersetzt die Namensaufloesung. Nur fuer die Zertifizierung der Adresspolicy. */
  resolver?: AddressResolver;
  now?: () => Date;
  ttlSeconds?: number;
  failureTtlSeconds?: number;
  timeoutMs?: number;
  maxBytes?: number;
};

export class ProjectAuthThirdPartyKeySets implements ProjectAuthThirdPartyKeyPort {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<readonly JsonWebKey[] | null>>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: ProjectAuthThirdPartyKeyOptions = {}) {
    this.maxBytes = options.maxBytes ?? PROJECT_AUTH_THIRD_PARTY_BOUNDS.jwksBytes.max;
    this.timeoutMs = options.timeoutMs ?? PROJECT_AUTH_THIRD_PARTY_BOUNDS.jwksTimeoutMs;
    // Ohne eingespeisten Transport wird der geprufte Weg genommen. Die
    // Groessengrenze steht auch im Transport, nicht nur beim Lesen danach: Eine
    // Antwort ohne `content-length` soll nicht erst vollstaendig im Speicher
    // liegen, bevor jemand merkt, dass sie zu gross ist.
    this.fetchFn = options.fetchFn ?? createGuardedFetch({
      resolver: options.resolver,
      maxResponseBytes: this.maxBytes,
      timeoutMs: this.timeoutMs,
    });
    this.now = options.now ?? (() => new Date());
    this.ttlMs = (options.ttlSeconds ?? PROJECT_AUTH_THIRD_PARTY_BOUNDS.jwksTtlSeconds) * 1_000;
    this.failureTtlMs = (options.failureTtlSeconds ?? PROJECT_AUTH_THIRD_PARTY_BOUNDS.jwksFailureTtlSeconds) * 1_000;
  }

  async keys(jwksUri: string): Promise<readonly JsonWebKey[] | null> {
    const held = this.entries.get(jwksUri);
    if (held && held.expiresAt > this.now().getTime()) return held.keys;
    return this.load(jwksUri);
  }

  async refresh(jwksUri: string): Promise<readonly JsonWebKey[] | null> {
    const held = this.entries.get(jwksUri);
    if (held && held.refreshableAt > this.now().getTime()) return held.keys;
    return this.load(jwksUri);
  }

  /**
   * Holt den Satz, und zwar je Adresse nur einmal gleichzeitig.
   *
   * Ohne diese Zusammenfassung loesten zehn gleichzeitige Anfragen mit
   * abgelaufenem Satz zehn Verbindungen zum Aussteller aus. Das ist die Form
   * von Last, die ein fremder Dienst als Angriff wertet, und der Angreifer
   * waere QKERN.
   */
  private load(jwksUri: string): Promise<readonly JsonWebKey[] | null> {
    const running = this.inFlight.get(jwksUri);
    if (running) return running;
    const started = this.fetchKeys(jwksUri).then((keys) => {
      const at = this.now().getTime();
      this.entries.set(jwksUri, {
        keys,
        // Ein Fehlversuch wird kuerzer gehalten als ein Erfolg. Er wird
        // ueberhaupt gehalten, weil sonst jede Anfrage in dieselbe Wand
        // laeuft: Ein Aussteller, der gerade nicht antwortet, bekaeme von
        // QKERN eine Anfrage je Token.
        expiresAt: at + (keys ? this.ttlMs : this.failureTtlMs),
        refreshableAt: at + this.failureTtlMs,
      });
      return keys;
    }).finally(() => {
      this.inFlight.delete(jwksUri);
    });
    this.inFlight.set(jwksUri, started);
    return started;
  }

  /**
   * Eine Antwort ist erst ein Schluesselsatz, wenn sie einer ist.
   *
   * Geprueft wird der Status, die angekuendigte Groesse, die wirkliche Groesse,
   * die Form (`{"keys":[...]}`) und die Anzahl. Was durchfaellt, ist `null` und
   * keine Ausnahme: Ein Aussteller, der Unsinn liefert, ist ein Aussteller, mit
   * dem heute nicht geprueft werden kann, und das ist ein Zustand und kein
   * Programmfehler.
   *
   * `redirect: "error"`: Eine Umleitung fuehrt an ein Ziel, das die
   * Adresspruefung nie gesehen hat. Ihr zu folgen hiesse, einem fremden Dienst
   * die Wahl des Ziels zu ueberlassen, und genau das darf ein Anbieter nicht.
   */
  private async fetchKeys(jwksUri: string): Promise<readonly JsonWebKey[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(jwksUri, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.maxBytes) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > this.maxBytes) return null;
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const list = (parsed as { keys?: unknown }).keys;
      if (!Array.isArray(list) || list.length < 1 ||
          list.length > PROJECT_AUTH_THIRD_PARTY_BOUNDS.jwksKeys.max) return null;
      // Nur Objekte. Ein Eintrag, der keines ist, wird weggelassen und nicht
      // zum Grund, den ganzen Satz zu verwerfen: Ein Aussteller darf einen
      // Schluessel fuehren, den diese Fassung nicht versteht.
      const keys = list.filter((entry): entry is JsonWebKey =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
      return keys.length > 0 ? keys : null;
    } catch {
      // Die Ursache kann Ziel und Netzwerkdetails tragen und bleibt draussen.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
