import { describe, expect, it } from "vitest";
import {
  ROLE_RIGHT_TEXTS,
  ROLE_VERDICT_TEXTS,
  TLS_STATE_TEXTS,
  databaseSettingsTexts,
  roleRights,
  roleVerdict,
  tlsState,
  type SettingsRole,
} from "@/lib/console/database-settings-texts";

/**
 * Die Ableitungen der Seite Datenbank-Einstellungen (2.53): Rechte in Worte,
 * ein Urteil je Rolle, ein Wort fuer den TLS-Zustand. Reine Funktionen, darum
 * ohne Datenbank pruefbar — und genau darum stehen sie in einem eigenen
 * Modul.
 */
function role(overrides: Partial<SettingsRole> = {}): SettingsRole {
  return {
    name: "qkern_project_api_app",
    superuser: false,
    createDatabase: false,
    createRole: false,
    inherit: true,
    login: true,
    replication: false,
    bypassRowSecurity: false,
    connectionLimit: null,
    validUntil: null,
    ...overrides,
  };
}

describe("database settings derivation", () => {
  it("calls a role without login a group role and lists no right it does not have", () => {
    const rights = roleRights(role({ name: "qkern_ledger_owner", login: false }));
    // Die erste Angabe ist immer, ob die Rolle sich verbinden darf.
    expect(rights[0]).toBe("group");
    expect(rights).toEqual(["group"]);
    // Kein Sonderrecht heisst kein Urteil ueber Sonderrechte.
    expect(roleVerdict(role({ login: false }))).toBe("restricted");
    expect(ROLE_RIGHT_TEXTS.group.label).toBe("Gruppenrolle");
    expect(ROLE_RIGHT_TEXTS.login.label).toBe("darf sich anmelden");
  });

  it("names a connection limit as a right and keeps zero apart from unlimited", () => {
    expect(roleRights(role({ connectionLimit: 5 }))).toEqual(["login", "connectionLimit"]);
    // Null Verbindungen ist eine Grenze und nicht die Abwesenheit einer.
    expect(roleRights(role({ connectionLimit: 0 }))).toContain("connectionLimit");
    // Unbegrenzt ist `null`; der Katalog schreibt dafuer -1, und das wandelt
    // der Dienst um, damit die Ansicht nicht rechnen muss.
    expect(roleRights(role({ connectionLimit: null }))).toEqual(["login"]);
    expect(roleVerdict(role({ connectionLimit: 5 }))).toBe("restricted");
  });

  it("puts every real special right into words and judges it", () => {
    expect(roleRights(role({
      createDatabase: true, createRole: true, replication: true,
      bypassRowSecurity: true, inherit: false, validUntil: "2027-01-01T00:00:00Z",
    }))).toEqual([
      "login", "createDatabase", "createRole", "replication",
      "bypassRowSecurity", "noInherit", "validUntil",
    ]);
    expect(roleVerdict(role({ superuser: true }))).toBe("superuser");
    expect(roleVerdict(role({ bypassRowSecurity: true }))).toBe("privileged");
    expect(roleVerdict(role({ replication: true }))).toBe("privileged");
    expect(ROLE_VERDICT_TEXTS.superuser.tone).toBe("risk high");
    expect(ROLE_VERDICT_TEXTS.restricted.tone).toBe("secure");
  });

  it("tells a server without TLS apart from a plaintext connection to a server that offers it", () => {
    expect(tlsState({ encrypted: true, version: "TLSv1.3", serverEnabled: true })).toBe("encrypted");
    // TLS aus, Server koennte es: eine Fehlkonfiguration der Verbindung.
    expect(tlsState({ encrypted: false, version: null, serverEnabled: true })).toBe("plaintextServerReady");
    // TLS aus, Server kann es nicht: eine Fehlkonfiguration des Servers.
    expect(tlsState({ encrypted: false, version: null, serverEnabled: false })).toBe("plaintextServerOff");
    // Beide unverschluesselten Zustaende sind ein hohes Risiko; welches der
    // beiden es ist, entscheidet, was ein Betreiber dagegen tut.
    expect(TLS_STATE_TEXTS.plaintextServerReady.tone).toBe("risk high");
    expect(TLS_STATE_TEXTS.plaintextServerOff.tone).toBe("risk high");
    expect(TLS_STATE_TEXTS.encrypted.tone).toBe("secure");
  });

  it("carries no address, no secret and no connection string in any of its texts", () => {
    const joined = databaseSettingsTexts().join("\n");
    expect(joined.length).toBeGreaterThan(400);
    for (const word of ["postgres://", "postgresql://", "password=", "sslmode=", "5432", "localhost", "127.0.0.1"]) {
      expect(joined, word).not.toContain(word);
    }
    // Jeder Text ist deutsch und nicht leer.
    for (const text of databaseSettingsTexts()) expect(text).toMatch(/\S/);
  });
});
