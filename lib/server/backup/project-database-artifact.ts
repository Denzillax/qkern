import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { recognisedByName } from "@/lib/server/errors/identity";

/**
 * Der Umschlag um ein Backup einer Projektdatenbank (2.126).
 *
 * ## Wer ein Backup lesen kann
 *
 * Zwei Schluessel, zwei Ebenen:
 *
 * 1. **Datenschluessel**, 32 Byte aus `randomBytes`, **je Backup neu**. Er
 *    verschluesselt die Bytes des Dumps mit AES-256-GCM. Er wird nie
 *    gespeichert, nie geloggt und nie uebertragen; er existiert fuer die Dauer
 *    eines Lauf und liegt danach nur eingewickelt vor.
 * 2. **Mandanten-Schluessel** (der Key Encryption Key), gehalten vom Vault. Er
 *    wickelt den Datenschluessel ein. Was in der Control Plane liegt, ist genau
 *    dieses Paeckchen (`wrapped_data_key` in 0083).
 *
 * Damit ist die Antwort auf "wer kann ein Backup lesen" nachlesbar und
 * unbequem: **der Betreiber kann es.** Wer den Vault-Schluessel des Mandanten
 * bekommt, bekommt den Datenschluessel und damit den Dump. QKERN hat heute
 * keine kundengehaltenen Schluessel; ein Backup ist gegen den Verlust des
 * Objektspeichers geschuetzt, nicht gegen den Betreiber. Das ist eine Aussage
 * ueber das Produkt, und sie steht darum auch im Backup-Dokument und nicht nur
 * hier.
 *
 * ## Warum die Mandantengrenze im Artefakt selbst steht
 *
 * Beide Ebenen binden zusaetzliche Daten (AAD) ein: Organisation, Projekt,
 * Umgebung und die Id des Backups. AES-GCM prueft die AAD bei jedem
 * Entschluesseln mit. Das heisst:
 *
 * - Die Bytes eines Mandanten lassen sich nicht unter der Kennung eines anderen
 *   oeffnen, selbst wenn jemand beide Schluessel hat.
 * - Ein Artefakt, das unter einem fremden Objektschluessel abgelegt wird, geht
 *   nicht auf: die Id im Umschlag passt dann nicht zur Zeile, die es aufruft.
 * - Zwei Backups lassen sich nicht vertauschen, auch nicht innerhalb desselben
 *   Mandanten.
 *
 * Das ist der Riegel, der **ohne** Filter in einer Anfrage wirkt. Der andere
 * liegt in der Zeilensicherheit von 0083; dieser hier gilt auch dann, wenn die
 * Bytes schon ausserhalb der Datenbank sind.
 */
const MAGIC = Buffer.from("QKBAK1\n", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Ein Artefakt ueber einem TiB ist kein Backup mehr, sondern ein Betriebsfehler. */
export const MAX_ARTIFACT_BYTES = 1_099_511_627_776;
/** Ein Dump, den dieser Weg in einem Stueck durch den Speicher traegt. */
export const MAX_IN_MEMORY_DUMP_BYTES = 256 * 1024 * 1024;

export type ProjectDatabaseBackupArtifactIdentity = Readonly<{
  organizationId: string;
  projectId: string;
  environment: "development" | "staging" | "production";
  backupId: string;
}>;

export type ProjectDatabaseBackupArtifactErrorCode =
  | "ARTIFACT_IDENTITY_INVALID"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_MALFORMED"
  | "ARTIFACT_IDENTITY_MISMATCH"
  | "DATA_KEY_INVALID";

/** Ohne `cause`: eine Treibermeldung aus einem Entschluesselungsfehler sagt, was fehlschlug, und das darf sie nicht. */
export class ProjectDatabaseBackupArtifactError extends Error {
  readonly code: ProjectDatabaseBackupArtifactErrorCode;
  constructor(code: ProjectDatabaseBackupArtifactErrorCode) {
    super(messageFor(code));
    this.name = "ProjectDatabaseBackupArtifactError";
    this.code = code;
  }
}
recognisedByName(ProjectDatabaseBackupArtifactError, "ProjectDatabaseBackupArtifactError");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVIRONMENTS = new Set(["development", "staging", "production"]);

/**
 * Die zusaetzlichen Daten, die der Umschlag bindet. Ein fester Vorsatz mit
 * Versionsnummer, dann die vier Kennungen in fester Reihenfolge, durch `\n`
 * getrennt. Keine Laengenpraefixe: jede der vier ist in ihrer Form begrenzt und
 * enthaelt kein `\n`, also ist die Zerlegung eindeutig.
 */
export function backupArtifactAssociatedData(identity: ProjectDatabaseBackupArtifactIdentity): Buffer {
  assertIdentity(identity);
  return Buffer.from([
    "qkern.project-database-backup/v1",
    identity.organizationId.toLowerCase(),
    identity.projectId.toLowerCase(),
    identity.environment,
    identity.backupId.toLowerCase(),
  ].join("\n"), "utf8");
}

export function newBackupDataKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Verschluesselt die Bytes des Dumps. Aufbau des Artefakts, von vorn:
 * `QKBAK1\n` (7 Byte) | IV (12) | Tag (16) | Geheimtext.
 *
 * Das Tag steht **vor** dem Geheimtext und nicht dahinter, damit ein Leser die
 * Pruefsumme kennt, bevor er den Geheimtext durchlaeuft. Bei einem Artefakt,
 * das spaeter stueckweise gelesen wird, ist das der Unterschied zwischen einer
 * Pruefung und einer Pruefung nach dem Verbrauch.
 */
export function sealBackupArtifact(input: {
  dump: Buffer;
  dataKey: Buffer;
  identity: ProjectDatabaseBackupArtifactIdentity;
}): Buffer {
  assertKey(input.dataKey);
  const aad = backupArtifactAssociatedData(input.identity);
  if (!Buffer.isBuffer(input.dump) || input.dump.length < 1) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  if (input.dump.length > MAX_IN_MEMORY_DUMP_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_TOO_LARGE");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", input.dataKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(input.dump), cipher.final()]);
  const artifact = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
  if (artifact.length > MAX_ARTIFACT_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_TOO_LARGE");
  }
  return artifact;
}

export function openBackupArtifact(input: {
  artifact: Buffer;
  dataKey: Buffer;
  identity: ProjectDatabaseBackupArtifactIdentity;
}): Buffer {
  assertKey(input.dataKey);
  const aad = backupArtifactAssociatedData(input.identity);
  const header = MAGIC.length + IV_BYTES + TAG_BYTES;
  if (!Buffer.isBuffer(input.artifact) || input.artifact.length <= header ||
      !input.artifact.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  const iv = input.artifact.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = input.artifact.subarray(MAGIC.length + IV_BYTES, header);
  const decipher = createDecipheriv("aes-256-gcm", input.dataKey, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(input.artifact.subarray(header)), decipher.final()]);
  } catch {
    // Ein fehlgeschlagenes Tag kann zwei Dinge heissen: falscher Schluessel oder
    // falsche Kennung. Beide Faelle geben denselben Code, weil ein Unterschied
    // hier verraet, ob ein fremdes Artefakt zu einem bekannten Mandanten passt.
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_IDENTITY_MISMATCH");
  }
}

/**
 * Wickelt den Datenschluessel in den Mandanten-Schluessel.
 *
 * Auch das Paeckchen bindet die Kennungen. Ein Paeckchen aus der Zeile eines
 * Mandanten laesst sich darum nicht in die Zeile eines anderen schreiben und
 * dort auspacken, selbst wenn beide denselben Mandanten-Schluessel haetten.
 */
export function wrapBackupDataKey(input: {
  dataKey: Buffer;
  keyEncryptionKey: Buffer;
  identity: ProjectDatabaseBackupArtifactIdentity;
  keyId: string;
}): string {
  assertKey(input.dataKey);
  assertKey(input.keyEncryptionKey);
  const aad = wrapAssociatedData(input.identity, input.keyId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", input.keyEncryptionKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const sealed = Buffer.concat([cipher.update(input.dataKey), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64");
}

export function unwrapBackupDataKey(input: {
  wrapped: string;
  keyEncryptionKey: Buffer;
  identity: ProjectDatabaseBackupArtifactIdentity;
  keyId: string;
}): Buffer {
  assertKey(input.keyEncryptionKey);
  const aad = wrapAssociatedData(input.identity, input.keyId);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.wrapped, "base64");
  } catch {
    throw new ProjectDatabaseBackupArtifactError("DATA_KEY_INVALID");
  }
  if (bytes.length !== IV_BYTES + TAG_BYTES + KEY_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("DATA_KEY_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", input.keyEncryptionKey, bytes.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    const dataKey = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
    assertKey(dataKey);
    return dataKey;
  } catch {
    throw new ProjectDatabaseBackupArtifactError("DATA_KEY_INVALID");
  }
}

export function artifactSha256(artifact: Buffer): string {
  return createHash("sha256").update(artifact).digest("hex");
}

/** Pruefsummen werden in gleicher Zeit verglichen; sie stehen neben Schluesselmaterial. */
export function sameDigest(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function wrapAssociatedData(identity: ProjectDatabaseBackupArtifactIdentity, keyId: string): Buffer {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId)) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_IDENTITY_INVALID");
  }
  return Buffer.concat([
    Buffer.from("qkern.project-database-backup-key/v1\n", "utf8"),
    backupArtifactAssociatedData(identity),
    Buffer.from(`\n${keyId}`, "utf8"),
  ]);
}

function assertIdentity(identity: ProjectDatabaseBackupArtifactIdentity): void {
  if (!identity || typeof identity !== "object" ||
      !UUID.test(identity.organizationId ?? "") ||
      !UUID.test(identity.projectId ?? "") ||
      !UUID.test(identity.backupId ?? "") ||
      !ENVIRONMENTS.has(identity.environment)) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_IDENTITY_INVALID");
  }
}

function assertKey(key: unknown): asserts key is Buffer {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("DATA_KEY_INVALID");
  }
}

function messageFor(code: ProjectDatabaseBackupArtifactErrorCode): string {
  switch (code) {
    case "ARTIFACT_IDENTITY_INVALID": return "The project database backup identity is invalid.";
    case "ARTIFACT_TOO_LARGE": return "The project database backup artifact exceeds the size limit.";
    case "ARTIFACT_MALFORMED": return "The project database backup artifact is malformed.";
    case "ARTIFACT_IDENTITY_MISMATCH": return "The project database backup artifact does not belong to this scope.";
    case "DATA_KEY_INVALID": return "The project database backup data key is invalid.";
  }
}
