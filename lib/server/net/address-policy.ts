import { isIP } from "node:net";

/**
 * Ist diese Adresse öffentlich erreichbar?
 *
 * Die Frage entscheidet, ob QKERN eine Ausgangsverbindung herstellt. Sie mit
 * einer Allowlist aus Namen zu beantworten genügt nicht: Ein Name gehört dem
 * Betreiber des Namens, und er kann jederzeit auf `169.254.169.254`,
 * `10.0.0.5` oder `127.0.0.1` zeigen. Genau darüber laufen die bekannten
 * Angriffe auf Cloud-Metadaten und interne Dienste.
 *
 * Deshalb wird hier nicht der Name geprüft, sondern die Adresse, zu der er
 * aufgelöst hat.
 *
 * **Die Liste ist bewusst eine Erlaubnisliste des Gegenteils:** Alles, was
 * nicht eindeutig als öffentlich erkannt wird, gilt als nicht erreichbar. Eine
 * unbekannte Adressform ist ein Grund abzulehnen, kein Grund durchzulassen.
 */
export function isPubliclyRoutable(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

function isPublicIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;

  if (a === 0) return false;                          // 0.0.0.0/8, "dieses Netz"
  if (a === 10) return false;                         // privat
  if (a === 127) return false;                        // Loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return false;           // Link-local, dort liegen die Metadaten
  if (a === 172 && b >= 16 && b <= 31) return false;  // privat
  if (a === 192 && b === 0) return false;             // 192.0.0.0/24 und Doku 192.0.2.0/24
  if (a === 192 && b === 88) return false;            // 6to4-Relay-Anycast
  if (a === 192 && b === 168) return false;           // privat
  if (a === 198 && (b === 18 || b === 19)) return false; // Benchmark 198.18.0.0/15
  if (a === 198 && b === 51) return false;            // Doku 198.51.100.0/24
  if (a === 203 && b === 0) return false;             // Doku 203.0.113.0/24
  if (a >= 224) return false;                         // Multicast, reserviert, Broadcast

  return true;
}

function isPublicIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];

  // IPv4-mapped und IPv4-kompatibel: Die eingebettete Adresse entscheidet.
  // Ohne diesen Schritt umginge `::ffff:127.0.0.1` die ganze IPv4-Prüfung.
  const embedded = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (embedded) return isPublicIPv4(embedded[1]);

  if (normalized === "::" || normalized === "::1") return false;   // unspezifiziert, Loopback

  const groups = expandIPv6(normalized);
  if (!groups) return false;
  const first = groups[0];

  if ((first & 0xfe00) === 0xfc00) return false;   // fc00::/7 Unique Local
  if ((first & 0xffc0) === 0xfe80) return false;   // fe80::/10 Link-local
  if ((first & 0xff00) === 0xff00) return false;   // ff00::/8 Multicast
  if (first === 0x2001 && (groups[1] & 0xfff0) === 0x0db0) return false; // 2001:db8::/32 Doku
  if (first === 0x2001 && groups[1] === 0x0000) return false;            // 2001::/32 Teredo
  if (first === 0x2002) return false;                                    // 2002::/16 6to4

  // Alles unterhalb von 2000::/3 ist nicht global unicast.
  if ((first & 0xe000) !== 0x2000) return false;

  return true;
}

/** Zerlegt eine IPv6-Adresse in ihre acht Gruppen, oder `null` bei Unsinn. */
function expandIPv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;

  const groups = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;

  const parsed = groups.map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return Number.NaN;
    return Number.parseInt(group, 16);
  });
  return parsed.some(Number.isNaN) ? null : parsed;
}
