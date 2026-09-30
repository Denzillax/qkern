/**
 * Der Ladeweg der Provider-Auswahl — als reine Funktion, damit er ohne
 * Browser-Testumgebung pruefbar ist (dasselbe Muster wie die Rechnungen in
 * 1.82). Die React-Ansicht haengt ihn nur ein.
 */

export type ConsoleAuthProvider = { id: string; issuer: string };

export type ConsoleAuthProviderResult =
  | { state: "ready"; providers: ConsoleAuthProvider[] }
  | { state: "unavailable" }
  | { state: "error" };

export async function loadConsoleAuthProviders(
  projectId: string,
  environment: string,
  fetcher: typeof fetch = fetch,
): Promise<ConsoleAuthProviderResult> {
  try {
    const response = await fetcher(
      `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/providers`,
      { cache: "no-store" },
    );
    if (response.status === 503) return { state: "unavailable" };
    if (!response.ok) return { state: "error" };
    const body = (await response.json()) as { data?: Array<{ id?: unknown; issuer?: unknown }> };
    if (!Array.isArray(body.data)) return { state: "error" };
    return {
      state: "ready",
      providers: body.data.map((provider) => ({
        id: String(provider.id ?? ""), issuer: String(provider.issuer ?? ""),
      })),
    };
  } catch {
    return { state: "error" };
  }
}

export type ConsoleAuthSamlProvider = { id: string; entityId: string; requiresVerifiedEmail: boolean };

export type ConsoleAuthSamlResult =
  | { state: "ready"; providers: ConsoleAuthSamlProvider[] }
  | { state: "unavailable" }
  | { state: "error" };

/**
 * Der Ladeweg der SAML-Anbieter (2.99), als eigene reine Funktion neben dem
 * OIDC-Ladeweg.
 *
 * Eigene Tuer, eigener Ladeweg, eigener Zustand: Faellt die eine Liste aus,
 * sagt die Seite das fuer diese Liste und nicht fuer die andere. Ein
 * gemeinsamer Zustand haette aus einem Ausfall zwei gemacht.
 */
export async function loadConsoleAuthSamlProviders(
  projectId: string,
  environment: string,
  fetcher: typeof fetch = fetch,
): Promise<ConsoleAuthSamlResult> {
  try {
    const response = await fetcher(
      `/api/v1/projects/${projectId}/environments/${environment}/auth/admin/saml`,
      { cache: "no-store" },
    );
    if (response.status === 503) return { state: "unavailable" };
    if (!response.ok) return { state: "error" };
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown; entityId?: unknown; requiresVerifiedEmail?: unknown }>;
    };
    if (!Array.isArray(body.data)) return { state: "error" };
    return {
      state: "ready",
      providers: body.data.map((provider) => ({
        id: String(provider.id ?? ""), entityId: String(provider.entityId ?? ""),
        requiresVerifiedEmail: provider.requiresVerifiedEmail === true,
      })),
    };
  } catch {
    return { state: "error" };
  }
}
