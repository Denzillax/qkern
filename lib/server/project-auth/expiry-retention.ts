import type { ProjectAuthScope } from "@/lib/server/project-auth/model";

/**
 * Was eine Runde je Umgebung entfernt hat. Nur Zahlen: keine Id, keine
 * Pruefsumme, keine Adresse, kein Ruecksprungziel.
 */
export type ProjectAuthExpiryRemoval = Readonly<{
  oneTimeTokens: number;
  oauthTokens: number;
  oauthCodes: number;
}>;

export const NOTHING_REMOVED: ProjectAuthExpiryRemoval = Object.freeze({
  oneTimeTokens: 0, oauthTokens: 0, oauthCodes: 0,
});

/**
 * Die drei Schritte einer Runde, jeder mit einer harten Obergrenze.
 *
 * Jede Methode loescht **hoechstens** `limit` Zeilen und gibt zurueck, wie
 * viele es waren. Der Aufrufer wiederholt, solange eine volle Portion kam; so
 * bleibt eine einzelne Anweisung kurz, und keine Runde haelt eine Tabelle
 * laenger fest, als eine Portion dauert.
 */
export interface ProjectAuthExpiryStore {
  /** Einmal-Token aus 0024, seit 0060 auch die Passkey-Herausforderungen. */
  deleteExpiredOneTimeTokens(
    scope: ProjectAuthScope, expiredBefore: Date, limit: number): Promise<number>;
  /** OAuth-Token aus 0062. */
  deleteExpiredOAuthTokens(
    scope: ProjectAuthScope, expiredBefore: Date, limit: number): Promise<number>;
  /** OAuth-Codes aus 0062, und zwar nur solche, an denen kein Token mehr haengt. */
  deleteExpiredOAuthCodes(
    scope: ProjectAuthScope, expiredBefore: Date, limit: number): Promise<number>;
}

export type ProjectAuthExpiryRetentionOptions = {
  store: ProjectAuthExpiryStore;
  scopes: readonly ProjectAuthScope[];
  /** Die Frist nach dem Ablauf. Siehe die Klasse: warum sie nicht null ist. */
  graceMs: number;
  /** Zeilen je Anweisung. */
  batchSize: number;
  /** Anweisungen je Tabelle, Umgebung und Runde. */
  maxBatches: number;
  intervalMs?: number;
  now?: () => Date;
  /** Erhaelt den Index der Umgebung und drei Zahlen, sonst nichts. */
  onPruned?: (scopeIndex: number, removed: ProjectAuthExpiryRemoval) => void;
  /** Erhaelt den Index der Umgebung und einen festen Code, nie die Ursache. */
  onFailure?: (scopeIndex: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Raeumt abgelaufene Einmal-Artefakte von Project Auth auf.
 *
 * ## Warum es diesen Aufraeumer gibt
 *
 * Drei Tabellen halten Dinge, die genau einmal und nur kurz gelten:
 * `project_auth_one_time_tokens` (Bestaetigungslink, Magic Link,
 * Passwort-Reset, OIDC-Zustand, MFA- und Passkey-Herausforderung),
 * `project_auth_oauth_codes` und `project_auth_oauth_tokens`. Jede Pruefung
 * sieht auf die Uhr, also gilt eine abgelaufene Zeile nicht mehr. Geloescht
 * hat sie trotzdem nie jemand. 0062 hat das selbst zugegeben, statt einen
 * Auftrag zu behaupten, der nicht laeuft.
 *
 * ## Die Frist nach dem Ablauf
 *
 * Eine Zeile, die vor einer Sekunde abgelaufen ist, ist der Gegenstand der
 * Fehlersuche, die gerade anfaengt: "Mein Magic Link ging nicht", "der Ablauf
 * brach beim Einloesen ab". Ist sie weg, sieht ein abgelaufener Code aus wie
 * ein erfundener, und genau diesen Unterschied will der Betreiber sehen.
 * Darum wird nicht am Ablauf geloescht, sondern eine Frist spaeter.
 *
 * Der Vorgabewert ist **24 Stunden**, und die Zahl ist zweifach begruendet:
 *
 * 1. Sie ist laenger als die laengste Lebensdauer, die eines dieser Artefakte
 *    haben kann. Ein OAuth-Token gilt hoechstens zwoelf Stunden (0062), ein
 *    Code Minuten, ein Einmal-Token Stunden. Eine Zeile, die vor 24 Stunden
 *    ablief, kann darum nirgends mehr das Gegenstueck von etwas Gueltigem sein.
 * 2. Sie deckt einen ganzen Betriebstag ab. Was morgens schiefging, hat am
 *    Abend noch seine Zeilen.
 *
 * Laenger waere keine Frist mehr, sondern eine zweite Aufbewahrung, und die
 * gehoert ins Audit und nicht in eine Tabelle mit Pruefsummen von Token.
 *
 * ## Was er stehen laesst
 *
 * **Verbraucht ist kein Loeschgrund.** Geloescht wird nach `expires_at`, nicht
 * nach `consumed_at`. Ein verbrauchtes, noch nicht abgelaufenes Token ist die
 * Zeile, an der ein zweites Einloesen auffliegt; sie vorher wegzunehmen hiesse,
 * den Wiedereinspielangriff unsichtbar zu machen.
 *
 * **Spuren bleiben.** Sitzungen (auch widerrufene), Nutzer, Passkeys,
 * OAuth-Clients, API- und S3-Schluessel und jede Audit-Zeile fasst dieser
 * Aufraeumer nicht an. Ein widerrufener Schluessel ist eine Spur, kein Abfall.
 *
 * ## Die Reihenfolge, und warum sie keine Geschmacksfrage ist
 *
 * `project_auth_oauth_tokens.code_id` haengt mit ON DELETE CASCADE am Code. Ein
 * abgelaufener Code, an dem ein noch gueltiges Token haengt, darf darum nicht
 * fallen: Er risse das Token mit, und ein Nutzer verloere mitten in der Sitzung
 * den Zugang einer Anwendung, der er zugestimmt hat. Erst die abgelaufenen
 * Token, dann die Codes ohne Token: In derselben Runde wird so der eben
 * geleerte Code gleich mit erledigt.
 */
export class ProjectAuthExpiryRetentionRuntime {
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopping = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: ProjectAuthExpiryRetentionOptions) {
    this.intervalMs = bounded(options.intervalMs ?? 3_600_000, 1_000, 86_400_000);
    // Untergrenze eine Minute: Eine Frist von null Sekunden waere genau die
    // Loeschung, gegen die die Begruendung oben argumentiert.
    bounded(options.graceMs, 60_000, 365 * 86_400_000);
    bounded(options.batchSize, 1, 5_000);
    bounded(options.maxBatches, 1, 1_000);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
  }

  async runOnce(): Promise<ProjectAuthExpiryRemoval> {
    const expiredBefore = new Date(this.now().getTime() - this.options.graceMs);
    let total = NOTHING_REMOVED;
    for (const [scopeIndex, scope] of this.options.scopes.entries()) {
      if (this.stopping) break;
      // Der Zaehler steht **ausserhalb** des try. Scheitert der zweite
      // Schritt, sind die Zeilen des ersten trotzdem weg, und eine Meldung,
      // die dann Null sagt, waere eine Behauptung ueber etwas, das
      // stattgefunden hat. Gemeldet wird, was getan wurde, auch wenn die Runde
      // danach abbricht.
      const removed = { oneTimeTokens: 0, oauthTokens: 0, oauthCodes: 0 };
      try {
        await this.pruneScope(scope, expiredBefore, removed);
      } catch {
        // Eine Umgebung, die gerade klemmt, darf die uebrigen nicht aufhalten.
        // Die Ursache bleibt draussen: Sie kann eine Datenbankmeldung tragen.
        this.options.onFailure?.(scopeIndex);
      }
      total = Object.freeze({
        oneTimeTokens: total.oneTimeTokens + removed.oneTimeTokens,
        oauthTokens: total.oauthTokens + removed.oauthTokens,
        oauthCodes: total.oauthCodes + removed.oauthCodes,
      });
      // Nur Runden, in denen etwas geschehen ist. Eine leere Runde zu melden
      // hiesse, den Takt zu protokollieren statt die Arbeit.
      if (removed.oneTimeTokens + removed.oauthTokens + removed.oauthCodes > 0) {
        this.options.onPruned?.(scopeIndex, Object.freeze({ ...removed }));
      }
    }
    return total;
  }

  async run(): Promise<void> {
    this.stopping = false;
    while (!this.stopping) {
      try { await this.runOnce(); } catch { /* naechste Runde */ }
      if (this.stopping) break;
      await this.sleep(this.intervalMs);
    }
  }

  stop(): void {
    this.stopping = true;
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async pruneScope(
    scope: ProjectAuthScope, expiredBefore: Date,
    into: { oneTimeTokens: number; oauthTokens: number; oauthCodes: number },
  ): Promise<void> {
    const { store } = this.options;
    await this.drain(into, "oneTimeTokens",
      (limit) => store.deleteExpiredOneTimeTokens(scope, expiredBefore, limit));
    // Erst die Token, dann die Codes. Siehe den Kommentar an der Klasse: Die
    // Umkehrung risse gueltige Token mit.
    await this.drain(into, "oauthTokens",
      (limit) => store.deleteExpiredOAuthTokens(scope, expiredBefore, limit));
    await this.drain(into, "oauthCodes",
      (limit) => store.deleteExpiredOAuthCodes(scope, expiredBefore, limit));
  }

  /**
   * Haeppchenweise, mit Obergrenze.
   *
   * Aufgehoert wird, sobald eine Portion nicht mehr voll ist (dann ist nichts
   * mehr faellig) oder die Zahl der Portionen erreicht ist (dann macht die
   * naechste Runde weiter). Eine Tabelle mit Millionen Altlasten wird so ueber
   * viele Runden leer, statt in einer einzigen Anweisung gesperrt zu werden.
   *
   * Gezaehlt wird nach jeder Portion und nicht am Ende: Bricht die dritte ab,
   * sind die ersten beiden trotzdem geloescht.
   */
  private async drain(
    into: { oneTimeTokens: number; oauthTokens: number; oauthCodes: number },
    field: keyof typeof into,
    step: (limit: number) => Promise<number>,
  ): Promise<void> {
    const { batchSize, maxBatches } = this.options;
    for (let round = 0; round < maxBatches; round += 1) {
      if (this.stopping) break;
      const deleted = await step(batchSize);
      into[field] += deleted;
      if (deleted < batchSize) break;
    }
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError("A project auth retention setting is out of range.");
  }
  return value;
}
