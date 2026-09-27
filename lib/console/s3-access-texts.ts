import { recognisedByName } from "@/lib/server/errors/identity";

/**
 * Texte und Eingabepruefung der Ansicht Storage, S3-Zugang (2.78).
 *
 * Die Ansicht gibt Schluesselpaare aus und verwaltet sie. Sie kann nicht
 * versprechen, dass ein fremdes Werkzeug damit spricht, und darum steht der
 * Grund hier als Text und nicht als Fussnote.
 */

export const S3_ACCESS_WHAT =
  "Ein Schlüsselpaar erklärt, wer auf welche Buckets dieser Umgebung zugreifen soll und bis wann. Das Geheimnis erscheint beim Anlegen genau einmal; gespeichert wird nur sein Hash.";

/** Die Grenze, wörtlich. Sie steht oben auf der Seite, nicht im Kleingedruckten. */
export const S3_ACCESS_LIMIT =
  "Kein Endpunkt von QKERN nimmt ein solches Paar heute an. Wer es in ein fremdes Werkzeug einträgt, bekommt keine Verbindung. Das Paar ist eine Erklärung und noch kein Zugang.";

export const S3_ACCESS_WHY_NO_PROVIDER_KEYS =
  "Beim Objektspeicher selbst lässt sich kein Paar anlegen. QKERN spricht intern S3, aber der Anschluss kennt keine Operation für Zugangsdaten, und er legt alle Objekte aller Projekte in einen einzigen Bucket des Anbieters. Getrennt wird dort allein über das Präfix des Schlüssels. Ein Paar beim Anbieter wäre darum ein Zugang zum Speicher aller Kunden und nicht zu diesen Buckets.";

export const S3_ACCESS_WHY_NO_SIGNATURE_CHECK =
  "Gegen QKERN selbst lässt sich das Paar nicht prüfen, solange nur der Hash gespeichert ist. Eine S3-Signatur wird nachgerechnet, und die Rechnung braucht das Geheimnis; aus einem Hash kommt es nicht zurück. Entweder QKERN behält das Geheimnis, oder es prüft keine Signatur. Dieser Schnitt behält es nicht.";

export const S3_ACCESS_ONE_TIME =
  "Jetzt kopieren, danach zeigt es niemand mehr. Auch die Liste kennt es nicht.";

export const S3_ACCESS_REVOKE_MEANING =
  "Widerruf wirkt sofort und löscht nichts. Das Paar bleibt mit seinem Zeitpunkt in der Liste, damit die Spur erhalten bleibt.";

export const S3_ACCESS_NO_BUCKETS =
  "Diese Umgebung hat noch keinen Bucket. Ein Paar ohne Buckets wäre eine Erklärung über nichts, deshalb kommt der Bucket zuerst.";

export const S3_ACCESS_REASONS = {
  INVALID_NAME: "Der Name fehlt oder ist länger als 80 Zeichen.",
  NO_BUCKET: "Ein Paar braucht mindestens einen Bucket.",
  TOO_MANY_BUCKETS: "Mehr als 20 Buckets an einem Paar sind nicht vorgesehen.",
  INVALID_EXPIRY: "Der Ablauf liegt nicht zwischen fünf Minuten und einem Jahr in der Zukunft.",
} as const;

export type S3AccessReasonCode = keyof typeof S3_ACCESS_REASONS;

/** Eine abgewiesene Eingabe. Sie traegt den Code und den Grund, nie einen Wert. */
export class S3AccessError extends Error {
  readonly code: S3AccessReasonCode;
  readonly reason: string;
  constructor(code: S3AccessReasonCode) {
    super(`S3_ACCESS_REJECTED:${code}`);
    this.name = "S3AccessError";
    this.code = code;
    this.reason = S3_ACCESS_REASONS[code];
  }
}
recognisedByName(S3AccessError, "S3AccessError");

export const S3_ACCESS_MIN_TTL_MS = 5 * 60 * 1_000;
export const S3_ACCESS_MAX_TTL_MS = 366 * 24 * 60 * 60 * 1_000;
export const S3_ACCESS_MAX_BUCKETS = 20;

export type S3AccessDraft = {
  name: string;
  bucketIds: string[];
  expiresAt: string;
};

/**
 * Dieselbe Pruefung wie im Dienst, nur vor dem Absenden. Sie ersetzt ihn nicht:
 * Der Dienst prueft noch einmal, weil eine Ansicht keine Grenze ist.
 */
export function validateS3AccessDraft(input: {
  name: string;
  bucketIds: readonly string[];
  expiresAt: string;
  now: Date;
}): S3AccessDraft {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new S3AccessError("INVALID_NAME");
  const bucketIds = [...new Set(input.bucketIds)].sort();
  if (bucketIds.length < 1) throw new S3AccessError("NO_BUCKET");
  if (bucketIds.length > S3_ACCESS_MAX_BUCKETS) throw new S3AccessError("TOO_MANY_BUCKETS");
  const expiresAt = new Date(input.expiresAt);
  const ttl = expiresAt.getTime() - input.now.getTime();
  if (!Number.isFinite(expiresAt.getTime()) ||
      ttl < S3_ACCESS_MIN_TTL_MS || ttl > S3_ACCESS_MAX_TTL_MS) {
    throw new S3AccessError("INVALID_EXPIRY");
  }
  return Object.freeze({ name, bucketIds, expiresAt: expiresAt.toISOString() });
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function s3AccessTexts(): string[] {
  return [
    ...Object.values(S3_ACCESS_REASONS),
    S3_ACCESS_WHAT,
    S3_ACCESS_LIMIT,
    S3_ACCESS_WHY_NO_PROVIDER_KEYS,
    S3_ACCESS_WHY_NO_SIGNATURE_CHECK,
    S3_ACCESS_ONE_TIME,
    S3_ACCESS_REVOKE_MEANING,
    S3_ACCESS_NO_BUCKETS,
  ];
}
