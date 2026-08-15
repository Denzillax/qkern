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
  ownerSubject: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  completionTokenHash: string;
  status: ProjectStorageUploadStatus;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  objectId: string | null;
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
