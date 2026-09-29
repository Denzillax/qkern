import { recognisedByName } from "@/lib/server/errors/identity";

/**
 * Texte und Eingabepruefung der Ansicht Storage, S3-Zugang (2.78, Endpunkt 2.96).
 *
 * Die Ansicht gibt Schluesselpaare aus und verwaltet sie. Seit 2.96 nimmt der
 * Endpunkt `/s3` ein Paar an. Was er kann und was nicht, steht hier als Text
 * auf der Seite, damit niemand eine Operation ausprobieren muss, um zu
 * erfahren, dass sie fehlt.
 */

export const S3_ACCESS_WHAT =
  "Ein Schlüsselpaar erklärt, wer auf welche Buckets dieser Umgebung zugreifen soll und bis wann. Das Geheimnis erscheint beim Anlegen genau einmal. Gespeichert werden sein Hash und ein verschlüsseltes Abbild, mit dem der Endpunkt eine Signatur nachrechnen kann.";

/** Der Endpunkt, woertlich. Er steht oben auf der Seite. */
export const S3_ACCESS_ENDPOINT =
  "Der Endpunkt hängt an dieser Adresse unter /s3, pfadadressiert, mit Signatur Version 4 im Header. Ein Werkzeug bekommt diese Adresse mit dem Anhang /s3 als Endpunkt, den öffentlichen Teil als Access Key und das Geheimnis als Secret. Die Region ist frei wählbar, denn QKERN prüft sie nicht.";

export const S3_ACCESS_ROLE =
  "Ein Paar handelt als Service-Rolle seiner Umgebung, beschränkt auf seinen Bucket-Satz. Es liest Buckets mit der Leseregel public oder service und schreibt in Buckets mit der Schreibregel service. Ein Bucket mit der Regel private bleibt auch mit Paar geschlossen und antwortet wie ein unbekannter Bucket.";

export const S3_ACCESS_OPERATIONS_BUILT =
  "Was geht: Buckets auflisten, Objekte auflisten (ListObjectsV2 mit Präfix und Trennzeichen), HEAD, lesen, schreiben in einem Stück bis 64 MiB, löschen. Jeder Schreibvorgang läuft durch dieselbe Prüfung wie die REST-Routen: Regel des Buckets, MIME-Liste, Grösse, Quota, Virenprüfung. Ein Objekt ist erst lesbar, wenn der Scanner es freigegeben hat.";

export const S3_ACCESS_OPERATIONS_MISSING =
  "Was nicht geht: Multipart-Uploads über S3, Presigned URLs, Range-Anfragen, CopyObject, ListObjects in Version 1, Buckets anlegen oder löschen, ACLs, Versionen, Tags. Jede dieser Operationen antwortet mit 501 und nennt sich beim Namen. Uploads in Stücken (aws-chunked, STREAMING im Hash-Header) antworten ebenfalls mit 501; das Werkzeug muss den SHA-256 des ganzen Körpers senden oder UNSIGNED-PAYLOAD.";

export const S3_ACCESS_WHY_NO_PROVIDER_KEYS =
  "Beim Objektspeicher selbst lässt sich kein Paar anlegen. QKERN spricht intern S3, aber der Anschluss kennt keine Operation für Zugangsdaten, und er legt alle Objekte aller Projekte in einen einzigen Bucket des Anbieters. Getrennt wird dort allein über das Präfix des Schlüssels. Ein Paar beim Anbieter wäre darum ein Zugang zum Speicher aller Kunden und nicht zu diesen Buckets.";

export const S3_ACCESS_SECRET_AT_REST =
  "Der Endpunkt rechnet die Signatur nach, und die Rechnung braucht das Geheimnis. QKERN behält es deshalb, verschlüsselt mit einem Schlüssel aus der Umgebung des Servers, der nie in der Datenbank liegt. Paare aus der Zeit vor dem Endpunkt haben kein solches Abbild und öffnen nichts; die Liste zeigt es je Paar.";

export const S3_ACCESS_NO_SERVER_KEY =
  "Dieser Server hat keinen Schlüssel für die Ablage des Geheimnisses. Das Paar ist ausgegeben, aber der Endpunkt nimmt es nicht an. Der Betreiber setzt QKERN_PROJECT_STORAGE_S3_KEY_ENCRYPTION_KEY und legt danach ein neues Paar an.";

export const S3_ACCESS_NOT_VERIFIABLE = "öffnet nichts, kein Geheimnis hinterlegt";

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
    S3_ACCESS_ENDPOINT,
    S3_ACCESS_ROLE,
    S3_ACCESS_OPERATIONS_BUILT,
    S3_ACCESS_OPERATIONS_MISSING,
    S3_ACCESS_WHY_NO_PROVIDER_KEYS,
    S3_ACCESS_SECRET_AT_REST,
    S3_ACCESS_NO_SERVER_KEY,
    S3_ACCESS_NOT_VERIFIABLE,
    S3_ACCESS_ONE_TIME,
    S3_ACCESS_REVOKE_MEANING,
    S3_ACCESS_NO_BUCKETS,
  ];
}
