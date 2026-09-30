import type { Environment } from "@/lib/types";

export type ProjectStorageScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type ProjectStorageRole = "admin" | "authenticated" | "anon" | "service_role";

export type ProjectStoragePrincipal = {
  organizationId: string;
  actorRef: string;
  role: ProjectStorageRole;
  subject: string;
};

export type ProjectStorageReadPolicy =
  | "private"
  | "authenticated"
  | "owner"
  | "public"
  | "service";

export type ProjectStorageWritePolicy = "private" | "authenticated" | "owner" | "service";

export type ProjectStorageBucket = ProjectStorageScope & {
  id: string;
  name: string;
  readPolicy: ProjectStorageReadPolicy;
  writePolicy: ProjectStorageWritePolicy;
  allowedMimeTypes: string[];
  maxObjectBytes: number;
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  retentionDays: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectStorageObjectStatus = "quarantined" | "clean" | "infected";

export type ProjectStorageObject = ProjectStorageScope & {
  id: string;
  bucketId: string;
  key: string;
  ownerSubject: string | null;
  providerKey: string;
  sizeBytes: number;
  contentType: string;
  checksumSha256: string;
  etag: string | null;
  status: ProjectStorageObjectStatus;
  createdAt: Date;
  deleteAfter: Date | null;
  deletedAt: Date | null;
};

export type ProjectStorageUploadStatus = "pending" | "completed" | "cancelled" | "expired";

export type ProjectStorageUpload = ProjectStorageScope & {
  id: string;
  bucketId: string;
  objectKey: string;
  providerKey: string;
  /** Einfach oder fortsetzbar in Teilen; die Teile sammelt der Provider. */
  kind: "single" | "multipart";
  providerUploadId: string | null;
  /**
   * Die Groesse kommt mit den Teilen, nicht mit der Zusage (S3-Multipart).
   *
   * Ein fortsetzbarer Upload ueber REST sagt Groesse und Pruefsumme der ganzen
   * Datei vorher zu. Ein S3-Client kann das nicht: `CreateMultipartUpload`
   * nennt nur Bucket, Schluessel und Inhaltstyp. Bei dieser Sorte beginnt
   * `sizeBytes` bei null und waechst mit jedem angenommenen Teil, und
   * `checksumSha256` bleibt leer, bis der Abschluss die ganze Datei
   * durchgerechnet hat.
   */
  partsDeclared: boolean;
  ownerSubject: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  completionTokenHash: string;
  status: ProjectStorageUploadStatus;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  objectId: string | null;
};

/** Ein Teil, das der S3-Endpunkt angenommen und zum Provider gebracht hat. */
export type ProjectStorageUploadPart = ProjectStorageScope & {
  uploadId: string;
  partNumber: number;
  sizeBytes: number;
  checksumSha256: string;
  /** Die Kennung des Providers; sie steht erst da, wenn die Bytes liegen. */
  etag: string | null;
  createdAt: Date;
};

export type PublicProjectStorageBucket = Omit<ProjectStorageBucket,
  "organizationId" | "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };

export type PublicProjectStorageObject = Omit<ProjectStorageObject,
  "organizationId" | "providerKey" | "checksumSha256" | "createdAt" | "deleteAfter" | "deletedAt"> & {
    createdAt: string;
    deleteAfter: string | null;
  };

export function publicStorageBucket(bucket: ProjectStorageBucket): PublicProjectStorageBucket {
  const { organizationId: _organizationId, ...publicBucket } = bucket;
  return {
    ...publicBucket,
    allowedMimeTypes: [...bucket.allowedMimeTypes],
    createdAt: bucket.createdAt.toISOString(),
    updatedAt: bucket.updatedAt.toISOString(),
  };
}

export function publicStorageObject(object: ProjectStorageObject): PublicProjectStorageObject {
  const {
    organizationId: _organizationId,
    providerKey: _providerKey,
    checksumSha256: _checksumSha256,
    deletedAt: _deletedAt,
    ...publicObject
  } = object;
  return {
    ...publicObject,
    createdAt: object.createdAt.toISOString(),
    deleteAfter: object.deleteAfter?.toISOString() ?? null,
  };
}

/**
 * Ein Eintrag der Speicher-Uebersicht der Console (2.51).
 *
 * Bewusst **kein** Ereignis: QKERN fuehrt kein Zugriffsprotokoll je Objekt.
 * `project_storage_objects` traegt den aktuellen Stand eines Objekts und das
 * letzte Urteil des Scanners, nicht seine Geschichte. Der Eintrag nennt
 * deshalb den Stand und die drei Zeitpunkte, die die Tabelle wirklich hat:
 * Anlage, geplante Loeschung, vollzogene Loeschung.
 *
 * Der Provider-Schluessel und die Pruefsumme fehlen hier genauso wie in
 * `PublicProjectStorageObject`; der Bucket steht mit Namen dabei, weil eine
 * Uebersicht ueber alle Buckets sonst nur Uuids zeigt.
 */
export type ProjectStorageLogEntry = {
  id: string;
  bucketId: string;
  bucketName: string;
  key: string;
  ownerSubject: string | null;
  sizeBytes: number;
  contentType: string;
  status: ProjectStorageObjectStatus;
  createdAt: string;
  deleteAfter: string | null;
  deletedAt: string | null;
};

export function projectStorageLogEntry(
  object: ProjectStorageObject,
  bucketName: string,
): ProjectStorageLogEntry {
  return {
    id: object.id,
    bucketId: object.bucketId,
    bucketName,
    key: object.key,
    ownerSubject: object.ownerSubject,
    sizeBytes: object.sizeBytes,
    contentType: object.contentType,
    status: object.status,
    createdAt: object.createdAt.toISOString(),
    deleteAfter: object.deleteAfter?.toISOString() ?? null,
    deletedAt: object.deletedAt?.toISOString() ?? null,
  };
}
