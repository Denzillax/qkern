import { describe, expect, it } from "vitest";
import { isPubliclyRoutable } from "@/lib/server/net/address-policy";
import {
  EgressBlockedError,
  guardHostname,
  type AddressResolver,
} from "@/lib/server/net/guarded-fetch";

/**
 * Die Adresspolicy entscheidet, ob QKERN eine Ausgangsverbindung herstellt.
 *
 * Eine Allowlist aus Namen genügt dafür nicht: Ein Name gehört dem, der ihn
 * betreibt, und darf jederzeit auf eine interne Adresse zeigen. Genau darüber
 * laufen die bekannten Angriffe auf Cloud-Metadaten.
 */

const blocked = [
  ["Loopback", "127.0.0.1"],
  ["Loopback, andere Adresse im Block", "127.99.12.4"],
  ["Metadatendienst", "169.254.169.254"],
  ["Link-local", "169.254.0.1"],
  ["Privat, Klasse A", "10.0.0.5"],
  ["Privat, Klasse B", "172.16.0.1"],
  ["Privat, Klasse B, oberes Ende", "172.31.255.254"],
  ["Privat, Klasse C", "192.168.1.1"],
  ["Carrier-Grade NAT", "100.64.0.1"],
  ["Dieses Netz", "0.0.0.0"],
  ["Multicast", "224.0.0.1"],
  ["Broadcast", "255.255.255.255"],
  ["Benchmark", "198.18.0.1"],
  ["Dokumentation", "192.0.2.1"],
  ["6to4-Relay", "192.88.99.1"],
  ["IPv6 Loopback", "::1"],
  ["IPv6 unspezifiziert", "::"],
  ["IPv6 Unique Local", "fd00::1"],
  ["IPv6 Link-local", "fe80::1"],
  ["IPv6 Multicast", "ff02::1"],
  ["IPv6 Dokumentation", "2001:db8::1"],
  ["IPv6 6to4", "2002:c0a8:0101::1"],
  ["IPv4-mapped Loopback", "::ffff:127.0.0.1"],
  ["IPv4-mapped Metadaten", "::ffff:169.254.169.254"],
  ["IPv4-mapped privat", "::ffff:10.0.0.5"],
  ["Unsinn", "nicht-einmal-eine-adresse"],
  ["Leer", ""],
] as const;

const allowed = [
  ["Oeffentlich, Cloudflare", "1.1.1.1"],
  ["Oeffentlich, Google", "8.8.8.8"],
  ["Oeffentlich, knapp ueber dem privaten Block", "172.32.0.1"],
  ["Oeffentlich, knapp unter dem privaten Block", "172.15.255.255"],
  ["Oeffentlich, knapp ueber CGNAT", "100.128.0.1"],
  ["IPv6 global unicast", "2606:4700:4700::1111"],
] as const;

describe("isPubliclyRoutable", () => {
  it.each(blocked)("weist %s ab", (_label, address) => {
    expect(isPubliclyRoutable(address)).toBe(false);
  });

  it.each(allowed)("laesst %s durch", (_label, address) => {
    expect(isPubliclyRoutable(address)).toBe(true);
  });

  it("laesst eine IPv4-mapped oeffentliche Adresse durch", () => {
    expect(isPubliclyRoutable("::ffff:8.8.8.8")).toBe(true);
  });
});

function resolver(...addresses: string[]): AddressResolver {
  return {
    async resolve() {
      return addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 as const : 4 as const,
      }));
    },
  };
}

describe("guardHostname", () => {
  it("gibt die gepruefte Adresse zurueck", async () => {
    expect(await guardHostname("api.example.com", resolver("93.184.216.34")))
      .toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("weist ab, sobald **eine** Adresse nicht oeffentlich ist", async () => {
    // Ein Name, der gleichzeitig oeffentlich und intern aufloest, ist kein
    // Grenzfall, sondern das Muster eines Angriffs.
    await expect(guardHostname("api.example.com", resolver("93.184.216.34", "10.0.0.5")))
      .rejects.toMatchObject({ reason: "EGRESS_ADDRESS_NOT_PUBLIC" });
  });

  it("weist einen Namen ohne Adresse ab", async () => {
    await expect(guardHostname("api.example.com", resolver()))
      .rejects.toMatchObject({ reason: "EGRESS_HOST_UNRESOLVABLE" });
  });

  it("weist einen unmoeglichen Namen ab, ohne aufzuloesen", async () => {
    let asked = false;
    const spy: AddressResolver = { async resolve() { asked = true; return []; } };
    await expect(guardHostname("", spy)).rejects.toBeInstanceOf(EgressBlockedError);
    expect(asked).toBe(false);
  });

  it("nennt in der Ausnahme weder Name noch Adresse", async () => {
    const error = await guardHostname("internal.example.com", resolver("10.0.0.5"))
      .then(() => null, (value: unknown) => value as Error);
    const serialized = JSON.stringify({ message: error?.message, cause: error?.cause });
    expect(serialized).not.toContain("10.0.0.5");
    expect(serialized).not.toContain("internal.example.com");
  });
});
