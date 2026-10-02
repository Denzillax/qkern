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

/**
 * # Der stueckweise Umschlag (2.129)
 *
 * 2.73.0 hat diesen Weg mit einem Umschlag ueber das **ganze** Artefakt
 * ausgeliefert und die Grenze von 256 MiB selbst als offen notiert. Darueber
 * fiel ein Lauf mit `ARTIFACT_TOO_LARGE`, und eine echte Mandantendatenbank ist
 * groesser. Hier steht der stueckweise Weg, und zwar mit seinen
 * Entscheidungen.
 *
 * ## Strom und nicht Datei
 *
 * Die Ausgabe von `pg_dump` geht als **Strom** durch die Verschluesselung in
 * die Teile und **nicht** erst in eine Datei auf der Platte. Beide Wege waren
 * moeglich, und der Strom gewinnt aus einem Grund, der nicht Platzersparnis ist:
 * eine Datei auf der Platte ist ein **entschluesselter** Dump einer
 * Mandantendatenbank auf einem Wirt des Betreibers. Dieselbe Zusage steht in
 * `project-database-dump.ts` schon fuer die Wiederherstellung ("der Dump geht
 * ueber `stdin` und liegt nie entschluesselt auf einer Platte"); sie beim
 * Sichern zu brechen waere eine Zusage, die nur in eine Richtung gilt. Dazu
 * braeuchte ein Datei-Weg auf dem Provisioner-Wirt Platz in der Groesse der
 * groessten Mandantendatenbank, und das ist eine Betriebsanforderung, die QKERN
 * heute nirgends stellt.
 *
 * Der Preis ist genau der, den die Frage nennt: **ein Siegel je Teil statt
 * einem**. Wer sie prueft, muss die Reihenfolge erzwingen koennen, und das tut
 * dieser Aufbau unten.
 *
 * ## Aufbau
 *
 * ```
 * QKBAKC1\n (8 Byte) | Nutzbytes je Teil (uint32 BE, 4 Byte)
 * Teil 1 | Teil 2 | ... | Teil N
 * ```
 *
 * Jeder Teil ist `IV (12) | Tag (16) | Geheimtext`. Der Geheimtext eines Teils
 * ist genau so lang wie sein Klartext (GCM ist ein Stromchiffre), also hat jeder
 * Teil ausser dem letzten dieselbe Laenge. Ein Leser rechnet den Versatz eines
 * Teils damit aus, ohne das Artefakt vorher zu lesen -- das ist die Bedingung
 * dafuer, dass die Wiederherstellung mit Bytebereichen arbeiten kann.
 *
 * ## Was die AAD eines Teils bindet, und was nicht
 *
 * ```
 * qkern.project-database-backup-part/v1
 * <Organisation> <Projekt> <Umgebung> <Backup-Id>   (wie beim ganzen Artefakt)
 * <Nutzbytes je Teil>
 * <Nummer des Teils>
 * final | more
 * <Tag des vorigen Teils, hex; beim ersten 64 Nullen>
 * ```
 *
 * Damit haelt der Umschlag gegen die drei Angriffe, die ein Siegel je Teil
 * aufmacht:
 *
 * - **Vertauschen.** Die Nummer steht in der AAD, also geht Teil 3 an Stelle 2
 *   nicht auf.
 * - **Weglassen in der Mitte.** Jeder Teil bindet das **Tag seines Vorgaengers**.
 *   Faellt einer weg, passt die Kette ab dort nicht mehr. Ohne diese Kette
 *   wuerde eine Nummer allein nur sagen, dass ein Teil irgendwann einmal an
 *   dieser Stelle stand, nicht dass er in **diesem** Artefakt dort stand.
 * - **Weglassen am Ende und Einfuegen.** Der letzte Teil tragt `final`, alle
 *   anderen `more`. Ein abgeschnittener Strom endet damit auf einem `more`-Teil
 *   und faellt auf; ein angehaengter Teil hat keinen gueltigen Vorgaenger-Tag
 *   und keine passende Nummer.
 *
 * **Die Gesamtzahl steht nicht in der AAD**, und das ist eine Entscheidung und
 * kein Versehen: Beim Siegeln des **ersten** Teils ist sie unbekannt. Sie
 * kennen heisst, den ganzen Dump vorher zu haben, also ihn zu puffern oder auf
 * die Platte zu legen -- genau das, was dieser Weg nicht tut. Was die
 * Gesamtzahl leistet, leistet hier das `final`-Zeichen am letzten Teil, und es
 * leistet es ohne Vorwissen. Die Zahl selbst steht in der Katalogzeile (0084),
 * weil der Leser sie braucht, um Bytebereiche zu rechnen; weicht sie von dem ab,
 * was die Kette und das `final`-Zeichen sagen, gewinnt der Umschlag und nicht
 * die Zeile.
 *
 * Die **Nutzbytes je Teil** stehen im Kopf **und** in jeder AAD. Der Kopf ist
 * da, damit ein Artefakt sich selbst beschreibt; die AAD ist da, damit eine
 * Aenderung am Kopf jedes Siegel bricht.
 */
const MAGIC_CHUNKED = Buffer.from("QKBAKC1\n", "utf8");
export const CHUNKED_HEADER_BYTES = MAGIC_CHUNKED.length + 4;
export const CHUNKED_PART_OVERHEAD_BYTES = IV_BYTES + TAG_BYTES;

/**
 * Nutzbytes je Teil im Produkt: **64 MiB**.
 *
 * Nach unten begrenzt es S3: ein Teil ausser dem letzten muss mindestens 5 MiB
 * haben, sonst weist der Abschluss ihn ab. Nach oben begrenzt es der Speicher
 * des Wirts: ein Teil liegt beim Siegeln einmal als Klartext und einmal als
 * Geheimtext im Heap, also kostet 64 MiB etwa 130 MiB Spitze. Der Weg aus
 * 2.73.0 kostete an derselben Stelle 512 MiB bei 256 MiB Dump, also ist das hier
 * auch fuer einen kleinen Dump der sparsamere Weg.
 */
export const DEFAULT_PART_PLAINTEXT_BYTES = 64 * 1024 * 1024;
export const MIN_S3_PART_BYTES = 5 * 1024 * 1024;
/** Die Teilegrenze des S3-Protokolls. Sie ist nicht unsere Wahl, sie ist die des Protokolls. */
export const MAX_ARTIFACT_PARTS = 10_000;

/**
 * Die Obergrenze eines Dumps, und zwar **gerechnet** und nicht gesetzt:
 * Nutzbytes je Teil mal der Teilegrenze des S3-Protokolls, und das Ganze noch
 * unter `MAX_ARTIFACT_BYTES`, weil 0083 `size_bytes` dort abschneidet.
 *
 * Mit den Voreinstellungen: `64 MiB * 10 000 = 625 GiB`. Das ist die Zahl, die
 * im Produkt gilt, und sie steht nirgends als Konstante, damit sie nicht neben
 * den beiden Werten auseinanderlaeuft, aus denen sie folgt.
 */
export function maxChunkedDumpBytes(
  partPlaintextBytes = DEFAULT_PART_PLAINTEXT_BYTES,
  maxParts = MAX_ARTIFACT_PARTS,
): number {
  const plain = partPlaintextBytes * maxParts;
  const artifact = CHUNKED_HEADER_BYTES + maxParts * CHUNKED_PART_OVERHEAD_BYTES + plain;
  if (artifact <= MAX_ARTIFACT_BYTES) return plain;
  // Ein Artefakt darf die Spalte nicht sprengen. Was dann gilt, ist die
  // Teilezahl, die noch hineinpasst, und nicht eine runde Zahl daneben.
  const fitting = Math.floor(
    (MAX_ARTIFACT_BYTES - CHUNKED_HEADER_BYTES) / (partPlaintextBytes + CHUNKED_PART_OVERHEAD_BYTES),
  );
  return fitting * partPlaintextBytes;
}

/** Der Kopf des stueckweisen Artefakts. Er steht am Anfang des ersten Teils. */
export function chunkedArtifactHeader(partPlaintextBytes: number): Buffer {
  assertPartPlaintextBytes(partPlaintextBytes);
  const header = Buffer.alloc(CHUNKED_HEADER_BYTES);
  MAGIC_CHUNKED.copy(header, 0);
  header.writeUInt32BE(partPlaintextBytes, MAGIC_CHUNKED.length);
  return header;
}

export function readChunkedArtifactHeader(bytes: Buffer): number {
  if (!Buffer.isBuffer(bytes) || bytes.length < CHUNKED_HEADER_BYTES ||
      !bytes.subarray(0, MAGIC_CHUNKED.length).equals(MAGIC_CHUNKED)) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  return bytes.readUInt32BE(MAGIC_CHUNKED.length);
}

/** Das Tag, das ein erster Teil als Vorgaenger bindet: es gibt keinen. */
export const NO_PREVIOUS_TAG = "0".repeat(TAG_BYTES * 2);

export function backupPartAssociatedData(input: Readonly<{
  identity: ProjectDatabaseBackupArtifactIdentity;
  partPlaintextBytes: number;
  partNumber: number;
  final: boolean;
  previousTagHex: string;
}>): Buffer {
  assertPartPlaintextBytes(input.partPlaintextBytes);
  if (!Number.isSafeInteger(input.partNumber) || input.partNumber < 1 ||
      input.partNumber > MAX_ARTIFACT_PARTS ||
      !new RegExp(`^[a-f0-9]{${TAG_BYTES * 2}}$`).test(input.previousTagHex)) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_IDENTITY_INVALID");
  }
  return Buffer.concat([
    Buffer.from("qkern.project-database-backup-part/v1\n", "utf8"),
    backupArtifactAssociatedData(input.identity),
    Buffer.from([
      "",
      String(input.partPlaintextBytes),
      String(input.partNumber),
      input.final ? "final" : "more",
      input.previousTagHex,
    ].join("\n"), "utf8"),
  ]);
}

export type SealedBackupPart = Readonly<{ bytes: Buffer; tagHex: string }>;

/**
 * Siegelt einen Teil. Ein frisches IV je Teil, und das ist kein Luxus: ein IV
 * zweimal mit demselben Schluessel hebt bei GCM die Vertraulichkeit **und** die
 * Faelschungssicherheit auf. Ein Zaehler-IV waere sparsamer und waere eine
 * Stelle, an der ein Wiederholungslauf dieselbe Nummer vergeben kann.
 */
export function sealBackupPart(input: Readonly<{
  chunk: Buffer;
  dataKey: Buffer;
  identity: ProjectDatabaseBackupArtifactIdentity;
  partPlaintextBytes: number;
  partNumber: number;
  final: boolean;
  previousTagHex: string;
}>): SealedBackupPart {
  assertKey(input.dataKey);
  if (!Buffer.isBuffer(input.chunk) || input.chunk.length < 1 ||
      input.chunk.length > input.partPlaintextBytes ||
      (!input.final && input.chunk.length !== input.partPlaintextBytes)) {
    // Ein nicht letzter Teil, der kuerzer ist als die Teilegroesse, macht die
    // Versatzrechnung des Lesers falsch. Das faellt hier auf und nicht dort.
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  const aad = backupPartAssociatedData(input);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", input.dataKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(input.chunk), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Object.freeze({
    bytes: Buffer.concat([iv, tag, ciphertext]),
    tagHex: tag.toString("hex"),
  });
}

export type OpenedBackupPart = Readonly<{ chunk: Buffer; tagHex: string }>;

export function openBackupPart(input: Readonly<{
  part: Buffer;
  dataKey: Buffer;
  identity: ProjectDatabaseBackupArtifactIdentity;
  partPlaintextBytes: number;
  partNumber: number;
  final: boolean;
  previousTagHex: string;
}>): OpenedBackupPart {
  assertKey(input.dataKey);
  if (!Buffer.isBuffer(input.part) || input.part.length <= CHUNKED_PART_OVERHEAD_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  const aad = backupPartAssociatedData(input);
  const iv = input.part.subarray(0, IV_BYTES);
  const tag = input.part.subarray(IV_BYTES, CHUNKED_PART_OVERHEAD_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", input.dataKey, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    const chunk = Buffer.concat([
      decipher.update(input.part.subarray(CHUNKED_PART_OVERHEAD_BYTES)),
      decipher.final(),
    ]);
    return Object.freeze({ chunk, tagHex: tag.toString("hex") });
  } catch {
    // Derselbe Code fuer falschen Schluessel, fremde Kennung, falsche Nummer,
    // gebrochene Kette und fehlendes `final`. Ein Unterschied hier wuerde einem
    // Angreifer sagen, **welche** seiner Annahmen stimmte.
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_IDENTITY_MISMATCH");
  }
}

/**
 * Wie viele Teile ein Artefakt dieser Groesse hat. Aus der Groesse gerechnet und
 * nicht aus der Zeile geglaubt: wenn beide Zahlen nicht uebereinstimmen, ist das
 * ein Befund und kein Rundungsfehler.
 */
export function chunkedPartCount(artifactBytes: number, partPlaintextBytes: number): number {
  assertPartPlaintextBytes(partPlaintextBytes);
  const payload = artifactBytes - CHUNKED_HEADER_BYTES;
  if (!Number.isSafeInteger(payload) || payload < 1 + CHUNKED_PART_OVERHEAD_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  const full = partPlaintextBytes + CHUNKED_PART_OVERHEAD_BYTES;
  const whole = Math.floor(payload / full);
  const rest = payload - whole * full;
  if (rest === 0) return whole;
  if (rest <= CHUNKED_PART_OVERHEAD_BYTES) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  return whole + 1;
}

/** Versatz und Laenge eines Teils im Objekt. Der erste traegt den Kopf vor sich. */
export function chunkedPartRange(input: Readonly<{
  partNumber: number;
  partCount: number;
  artifactBytes: number;
  partPlaintextBytes: number;
}>): Readonly<{ offset: number; length: number }> {
  assertPartPlaintextBytes(input.partPlaintextBytes);
  if (!Number.isSafeInteger(input.partNumber) || input.partNumber < 1 ||
      input.partNumber > input.partCount || input.partCount > MAX_ARTIFACT_PARTS) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  const full = input.partPlaintextBytes + CHUNKED_PART_OVERHEAD_BYTES;
  const offset = CHUNKED_HEADER_BYTES + (input.partNumber - 1) * full;
  const length = input.partNumber < input.partCount ? full : input.artifactBytes - offset;
  if (length <= CHUNKED_PART_OVERHEAD_BYTES || offset + length > input.artifactBytes) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_MALFORMED");
  }
  return Object.freeze({ offset, length });
}

function assertPartPlaintextBytes(value: number): void {
  // Nach unten 1 KiB und nicht 5 MiB: die S3-Mindestgroesse eines Teils ist eine
  // Zusage des Objektspeichers und steht darum im Dienst, der sie braucht
  // (siehe `project-database.ts`). Hier geht es um die Form des Umschlags, und
  // die traegt auch kleine Teile -- der Fall `(2.129)` rechnet die Obergrenze
  // genau damit nach, ohne gigabyteweise Daten zu schreiben.
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 256 * 1024 * 1024) {
    throw new ProjectDatabaseBackupArtifactError("ARTIFACT_IDENTITY_INVALID");
  }
}

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
 *
 * **Seit 2.129 entsteht so kein Backup mehr**, und diese Funktion hat im Produkt
 * keinen Aufrufer. Sie bleibt trotzdem, und der Grund steht hier, damit sie
 * nicht beim naechsten Aufraeumen faellt: `openBackupArtifact` muss die
 * Artefakte aus 2.73.0 weiter lesen koennen, und ein Fall, der das belegen soll,
 * braucht einen Weg, so ein Artefakt zu erzeugen. Das ist der Unterschied zu
 * einem Formatierer ohne Aufrufer: hier ist die **Gegenseite** im Produkt und
 * der Erzeuger nur noch im Fall.
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
