import { recognisedByName } from "@/lib/server/errors/identity";
import {
  VaultTokenFileProvider,
  type VaultTokenProvider,
} from "@/lib/server/migrations/connection-catalog-vault";
import {
  isJson,
  isRecord,
  readBounded,
  validatedMount,
  validVaultNamespace,
  vaultSecretPath,
} from "@/lib/server/compute/webhook-secret-vault";

/**
 * Ob eine Secret-Referenz einer Function im Vault aufgeloest wird (2.38).
 *
 * Die Antwort ist genau eines von drei Woertern. Wert, Version, Zeitstempel und
 * Metadaten verlassen diesen Port nie; der Vertrag unter "Functions" in
 * COMPUTE_CONTRACTS.md sagt, dass Secrets nur als Referenzen erscheinen.
 */
export type FunctionSecretStatus = "present" | "missing" | "forbidden";

export interface FunctionSecretInspector {
  hasSecret(secretRef: string): Promise<FunctionSecretStatus>;
}

/**
 * Der Vault hat nicht geantwortet oder nicht in der erwarteten Form.
 *
 * Bewusst ohne `cause` und ohne Pfad in der Meldung: Eine Vault-Meldung kann
 * die Struktur des Schluesselspeichers verraten.
 */
export class FunctionSecretInspectionError extends Error {
  readonly code = "FUNCTION_SECRET_INSPECTION_FAILED" as const;
  constructor() {
    super("Function secret inspection failed");
    this.name = "FunctionSecretInspectionError";
  }
}
recognisedByName(FunctionSecretInspectionError, "FunctionSecretInspectionError");

export type VaultFunctionSecretInspectorOptions = Readonly<{
  /** Exakte KV-v2-Mount-URL, zum Beispiel `https://vault.example.net/v1/secret`. */
  vaultKvUrl: URL;
  tokenProvider: VaultTokenProvider;
  namespace?: string;
  timeoutMs?: number;
  production?: boolean;
  fetchFn?: typeof fetch;
}>;

const MAX_METADATA_BYTES = 65_536;

/**
 * Prueft Existenz ueber den Metadaten-Endpunkt von KV Version 2.
 *
 * Gelesen wird `<mount>/metadata/<pfad>`, nie `<mount>/data/<pfad>`: Der
 * Datenendpunkt liefert den Wert, und den braucht die Frage "gibt es ihn"
 * nicht. Die Metadaten werden nur hier ausgewertet, um eine geloeschte oder
 * zerstoerte aktuelle Version als "missing" zu erkennen, denn der
 * Signatur-Resolver bekaeme dafuer ebenfalls 404. Nichts davon wird
 * zurueckgegeben.
 *
 * Die Pfadregel ist dieselbe wie beim Signatur-Resolver (`vaultSecretPath`).
 * Eine Referenz ausserhalb davon ist "forbidden", ohne dass eine Anfrage
 * rausgeht.
 */
export class VaultFunctionSecretInspector implements FunctionSecretInspector {
  private readonly vaultKvUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly namespace?: string;

  constructor(private readonly options: VaultFunctionSecretInspectorOptions) {
    try {
      this.vaultKvUrl = validatedMount(options.vaultKvUrl, options.production ?? false);
    } catch {
      throw new FunctionSecretInspectionError();
    }
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new FunctionSecretInspectionError();
    }
    this.timeoutMs = timeoutMs;
    this.fetchFn = options.fetchFn ?? fetch;
    const namespace = options.namespace?.trim();
    if (namespace && !validVaultNamespace(namespace)) throw new FunctionSecretInspectionError();
    this.namespace = namespace || undefined;
    if (typeof options.tokenProvider?.getToken !== "function") {
      throw new FunctionSecretInspectionError();
    }
  }

  async hasSecret(secretRef: string): Promise<FunctionSecretStatus> {
    const path = vaultSecretPath(secretRef);
    if (path === null) return "forbidden";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const token = await this.options.tokenProvider.getToken({ signal: controller.signal });
      if (typeof token !== "string" || token.length < 8) throw new FunctionSecretInspectionError();

      const headers: Record<string, string> = {
        accept: "application/json",
        "x-vault-token": token,
      };
      if (this.namespace) headers["x-vault-namespace"] = this.namespace;

      const url = new URL(this.vaultKvUrl.toString());
      url.pathname = `${this.vaultKvUrl.pathname}/metadata/${path}`;
      const response = await this.fetchFn(url, {
        method: "GET",
        headers,
        cache: "no-store",
        // Eine Umleitung koennte den Token an ein fremdes Ziel tragen.
        redirect: "error",
        signal: controller.signal,
      });

      if (response.status === 404 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        return response.status === 404 ? "missing" : "forbidden";
      }
      if (!response.ok || !isJson(response.headers.get("content-type"))) {
        await response.body?.cancel().catch(() => undefined);
        throw new FunctionSecretInspectionError();
      }
      return currentVersionIsLive(await readBounded(response, MAX_METADATA_BYTES))
        ? "present"
        : "missing";
    } catch (error) {
      if (error instanceof FunctionSecretInspectionError) throw error;
      // Pfad, Token und Vault-Meldung bleiben draussen.
      throw new FunctionSecretInspectionError();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Wertet die Metadaten aus, ohne sie weiterzugeben. Eine aktuelle Version mit
 * Loeschzeitpunkt oder `destroyed` liefert am Datenendpunkt 404, gilt hier
 * also als fehlend.
 */
function currentVersionIsLive(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FunctionSecretInspectionError();
  }
  if (!isRecord(parsed) || !isRecord(parsed.data)) throw new FunctionSecretInspectionError();
  const { current_version: current, versions } = parsed.data;
  if (!Number.isSafeInteger(current) || !isRecord(versions)) throw new FunctionSecretInspectionError();
  if ((current as number) < 1) return false;
  const version = versions[String(current)];
  if (!isRecord(version)) return false;
  if (version.destroyed === true) return false;
  return typeof version.deletion_time !== "string" || version.deletion_time === "";
}

/**
 * Baut den Inspektor aus der Umgebung, oder gibt `null` zurueck, wenn kein
 * Vault konfiguriert ist. `QKERN_FUNCTIONS_VAULT_KV_URL` hat Vorrang; ohne sie
 * gilt der Mount der Webhook-Signaturschluessel. Ein halb konfigurierter Vault
 * ist ein Fehler, kein Fallback.
 */
export function createVaultFunctionSecretInspectorFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): VaultFunctionSecretInspector | null {
  const raw = env.QKERN_FUNCTIONS_VAULT_KV_URL?.trim() || env.QKERN_WEBHOOK_VAULT_KV_URL?.trim();
  const tokenFile = env.QKERN_VAULT_TOKEN_FILE?.trim();
  if (!raw && !tokenFile) return null;
  if (!raw || !tokenFile) throw new FunctionSecretInspectionError();
  const production = env.NODE_ENV === "production";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FunctionSecretInspectionError();
  }
  const timeout = env.QKERN_WEBHOOK_VAULT_TIMEOUT_MS;
  return new VaultFunctionSecretInspector({
    vaultKvUrl: url,
    tokenProvider: new VaultTokenFileProvider(tokenFile, { production }),
    namespace: env.QKERN_VAULT_NAMESPACE,
    timeoutMs: timeout === undefined ? 5_000 : Number(timeout),
    production,
  });
}

type GlobalFunctionSecrets = typeof globalThis & {
  __qkernFunctionSecretInspector?: { value: FunctionSecretInspector | null };
};

export function getFunctionSecretInspector(): FunctionSecretInspector | null {
  const runtime = globalThis as GlobalFunctionSecrets;
  runtime.__qkernFunctionSecretInspector ??= { value: createVaultFunctionSecretInspectorFromEnv() };
  return runtime.__qkernFunctionSecretInspector.value;
}
