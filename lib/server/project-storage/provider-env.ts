import { ConfigurationError } from "@/lib/server/db/errors";
import {
  MemoryProjectStorageProvider,
  S3ProjectStorageProvider,
  StaticS3ProjectStorageCredentialsProvider,
  type ProjectStorageProvider,
} from "@/lib/server/project-storage/provider";

/**
 * Der Storage-Anbieter aus der Umgebung. Seit 2.176 braucht ihn auch der
 * Provisioner: Er raeumt die Dateien eines geloeschten Projekts ab. Darum
 * steht die Funktion in einem eigenen Modul; die Storage-Laufzeit baut beim
 * Laden die Control Plane der Web-App, und die gehoert nicht in den
 * Provisioner. Es bleibt eine Lesart derselben Einstellungen.
 */
export function providerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
): ProjectStorageProvider {
  if (production) {
    throw new ConfigurationError(
      "Production Project Storage requires injected object-provider and rotating credential adapters.",
    );
  }
  const endpoint = env.QKERN_PROJECT_STORAGE_S3_ENDPOINT?.trim();
  const region = env.QKERN_PROJECT_STORAGE_S3_REGION?.trim();
  const bucket = env.QKERN_PROJECT_STORAGE_S3_BUCKET?.trim();
  const accessKeyId = env.QKERN_PROJECT_STORAGE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.QKERN_PROJECT_STORAGE_S3_SECRET_ACCESS_KEY?.trim();
  const configured = [endpoint, region, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (configured === 0) return new MemoryProjectStorageProvider();
  if (configured !== 5) {
    throw new ConfigurationError("All QKERN_PROJECT_STORAGE_S3_* development settings are required together.");
  }
  return new S3ProjectStorageProvider({
    endpoint: endpoint!, region: region!, bucket: bucket!, production: false,
    timeoutMs: integerSetting(env.QKERN_PROJECT_STORAGE_PROVIDER_TIMEOUT_MS, 10_000, 500, 30_000),
  }, new StaticS3ProjectStorageCredentialsProvider({
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    ...(env.QKERN_PROJECT_STORAGE_S3_SESSION_TOKEN?.trim()
      ? { sessionToken: env.QKERN_PROJECT_STORAGE_S3_SESSION_TOKEN.trim() }
      : {}),
  }));
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError("Invalid Project Storage numeric setting.");
  }
  return parsed;
}
