/**
 * Der XML-Teil von SAML, als eigenes reines Modul (2.99).
 *
 * Hier steht ein Leser fuer genau die Teilmenge von XML, die eine SAML-Antwort
 * braucht, und die exklusive Kanonisierung
 * (`http://www.w3.org/2001/10/xml-exc-c14n#`) darueber. Keine Uhr, keine
 * Ablage, kein Netz: Was hereinkommt, ist Text, was herausgeht, ist ein Baum
 * oder ein kanonisierter Byte-String.
 *
 * ## Warum ein eigener Leser und keine fremde Bibliothek
 *
 * Dieselbe Entscheidung wie bei WebAuthn, GraphQL und SigV4. Der Grund ist
 * hier aber ein anderer und ein schaerferer: Die bekannten Luecken in
 * SAML-Umsetzungen sitzen fast alle **zwischen** Parser und Pruefung. Wer
 * einen allgemeinen XML-Parser nimmt, bekommt Kommentare, CDATA-Abschnitte,
 * Entity-Deklarationen und mehrfach vergebene `ID`-Werte geschenkt, und
 * genau daraus baut ein Angreifer eine zweite Assertion, die die Pruefung
 * nicht sieht und die Anwendung liest. Ein Leser, der solche Formen gar nicht
 * annimmt, hat diese Luecke nicht.
 *
 * ## Welche Formen dieser Leser annimmt
 *
 * - Eine optionale XML-Deklaration am Anfang (`<?xml … ?>`), sonst keine
 *   Verarbeitungsanweisung.
 * - Elemente, Attribute, Namensraumdeklarationen, Textinhalt.
 * - Die fuenf vordefinierten Entities (`&lt; &gt; &amp; &quot; &apos;`) und
 *   numerische Zeichenverweise (`&#60;`, `&#x3C;`).
 * - Den implizit deklarierten Praefix `xml`.
 *
 * ## Welche Formen dieser Leser ablehnt, und warum
 *
 * - **Kommentare** (`<!-- -->`). Ein Kommentar innerhalb eines Attributwertes
 *   oder zwischen zwei Zeichen eines Namens ist der klassische Weg, zwei
 *   Leser dasselbe Dokument verschieden zu lesen.
 * - **`<!DOCTYPE …>` und jede Entity-Deklaration.** Damit fallen XXE,
 *   Billion Laughs und benannte Entities in einem Satz weg.
 * - **CDATA-Abschnitte** (`<![CDATA[…]]>`). Derselbe Text kann in zwei Formen
 *   stehen; zwei Formen heissen zwei Lesungen.
 * - **Verarbeitungsanweisungen** ausser der XML-Deklaration.
 * - **Benannte Entities** ausser den fuenf vordefinierten.
 * - **Mehrfach vergebene `ID`-Werte** im Dokument (das prueft der Aufrufer
 *   ueber `collectIds`, weil erst er weiss, was ein `ID` ist).
 * - **Undeklarierte Praefixe** in Element- oder Attributnamen.
 * - **Ein Dokument ueber 1 MiB** oder tiefer als 100 Ebenen.
 *
 * Eine Antwort, deren Form dieser Leser nicht annimmt, wird abgelehnt. Sie
 * wird nicht "so gut wie moeglich" gelesen: Eine Assertion, deren Form die
 * Pruefung nicht abdeckt, darf nicht durchgelassen werden.
 *
 * ## Was die Kanonisierung abdeckt
 *
 * Exklusive Kanonisierung ohne Kommentare, mit `InclusiveNamespaces
 * PrefixList`. Nicht abgedeckt und darum abgelehnt: die Kanonisierung 1.0 und
 * 1.1 (`xml-c14n`), Varianten mit Kommentaren, XPath-Transformationen und
 * jede Referenz, die nicht auf ein Element desselben Dokuments zeigt.
 */

import { recognisedByName } from "@/lib/server/errors/identity";

export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Grenzen, die ein Dokument einhalten muss, bevor es ueberhaupt gelesen wird. */
export const SAML_XML_BOUNDS = { bytes: 1024 * 1024, depth: 100 } as const;

export type XmlAttribute = {
  /** Der Name, wie er im Dokument steht (mit Praefix). */
  qualifiedName: string;
  prefix: string;
  localName: string;
  namespaceUri: string;
  value: string;
};

export type XmlElement = {
  kind: "element";
  qualifiedName: string;
  prefix: string;
  localName: string;
  namespaceUri: string;
  attributes: XmlAttribute[];
  /** Die in-scope-Namensraeume dieses Elements, Praefix auf URI. */
  namespaces: ReadonlyMap<string, string>;
  children: XmlNode[];
  parent: XmlElement | null;
};

export type XmlText = { kind: "text"; text: string };
export type XmlNode = XmlElement | XmlText;

export class XmlFormatError extends Error {
  constructor(readonly detail: string) {
    super(`XML_FORMAT_REFUSED:${detail}`);
    this.name = "XmlFormatError";
  }
}
recognisedByName(XmlFormatError, "XmlFormatError");

/**
 * Liest ein Dokument in der oben beschriebenen Teilmenge.
 *
 * Der Leser ist absichtlich streng und kurz. Jede Stelle, an der er
 * abbricht, steht fuer eine Form, die dieses Produkt nicht pruefen kann.
 */
export function parseXml(source: string): XmlElement {
  if (Buffer.byteLength(source, "utf8") > SAML_XML_BOUNDS.bytes) throw new XmlFormatError("document_too_large");
  let index = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  // Die XML-Deklaration ist die einzige zugelassene Verarbeitungsanweisung,
  // und sie darf nur am Anfang stehen.
  const leading = /^﻿?\s*<\?xml\s[^?>]*\?>/.exec(source);
  if (leading) index = leading[0].length;

  const fail = (detail: string): never => { throw new XmlFormatError(detail); };

  while (index < source.length) {
    const next = source.indexOf("<", index);
    if (next < 0) {
      if (source.slice(index).trim().length > 0) fail("text_outside_root");
      break;
    }
    if (next > index) {
      const text = source.slice(index, next);
      if (stack.length === 0) {
        if (text.trim().length > 0) fail("text_outside_root");
      } else {
        stack[stack.length - 1].children.push({ kind: "text", text: decodeXmlText(text) });
      }
      index = next;
    }
    if (source.startsWith("<!--", index)) fail("comment");
    if (source.startsWith("<![CDATA[", index)) fail("cdata");
    if (source.startsWith("<!", index)) fail("doctype_or_declaration");
    if (source.startsWith("<?", index)) fail("processing_instruction");

    if (source.startsWith("</", index)) {
      const end = source.indexOf(">", index);
      if (end < 0) fail("unterminated_end_tag");
      const name = source.slice(index + 2, end).trim();
      const open = stack.pop();
      if (!open || open.qualifiedName !== name) fail("mismatched_end_tag");
      index = end + 1;
      continue;
    }

    // Ein Start-Tag. Das schliessende ">" wird gesucht, ohne in
    // Anfuehrungszeichen zu stolpern.
    let cursor = index + 1;
    let quote = "";
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) { if (character === quote) quote = ""; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === ">") break;
      if (character === "<") fail("angle_bracket_in_tag");
    }
    if (cursor >= source.length) fail("unterminated_start_tag");
    let body = source.slice(index + 1, cursor);
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);
    const element = buildElement(body, stack[stack.length - 1] ?? null, fail);
    if (stack.length === 0) {
      if (root) fail("second_root_element");
      root = element;
    } else {
      stack[stack.length - 1].children.push(element);
    }
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > SAML_XML_BOUNDS.depth) fail("document_too_deep");
    }
    index = cursor + 1;
  }

  if (stack.length > 0) fail("unclosed_element");
  if (!root) fail("no_root_element");
  return root as XmlElement;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function buildElement(
  body: string,
  parent: XmlElement | null,
  fail: (detail: string) => never,
): XmlElement {
  const tokens = /^([^\s/>]+)([\s\S]*)$/.exec(body.trim());
  if (!tokens) fail("empty_start_tag");
  const qualifiedName = tokens![1];
  const rest = tokens![2];

  const raw: Array<{ name: string; value: string }> = [];
  const attributePattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(rest)) !== null) {
    if (rest.slice(consumed, match.index).trim().length > 0) fail("malformed_attribute");
    raw.push({ name: match[1], value: decodeXmlText(match[3] ?? match[4] ?? "") });
    consumed = match.index + match[0].length;
  }
  if (rest.slice(consumed).trim().length > 0) fail("malformed_attribute");

  const namespaces = new Map<string, string>(parent?.namespaces ?? [["xml", XML_NAMESPACE]]);
  const seen = new Set<string>();
  for (const attribute of raw) {
    if (seen.has(attribute.name)) fail("duplicate_attribute");
    seen.add(attribute.name);
    if (attribute.name === "xmlns") { namespaces.set("", attribute.value); continue; }
    if (attribute.name.startsWith("xmlns:")) {
      const prefix = attribute.name.slice(6);
      if (!NAME.test(prefix) || prefix === "xmlns") fail("malformed_namespace_prefix");
      if (!attribute.value) fail("empty_namespace_uri");
      namespaces.set(prefix, attribute.value);
    }
  }

  const resolve = (name: string, isAttribute: boolean): { prefix: string; localName: string; namespaceUri: string } => {
    const colon = name.indexOf(":");
    if (colon < 0) {
      if (!NAME.test(name)) fail("malformed_name");
      return { prefix: "", localName: name, namespaceUri: isAttribute ? "" : namespaces.get("") ?? "" };
    }
    const prefix = name.slice(0, colon);
    const localName = name.slice(colon + 1);
    if (!NAME.test(prefix) || !NAME.test(localName)) fail("malformed_name");
    const namespaceUri = namespaces.get(prefix);
    if (!namespaceUri) fail("undeclared_namespace_prefix");
    return { prefix, localName, namespaceUri: namespaceUri! };
  };

  const resolved = resolve(qualifiedName, false);
  const attributes: XmlAttribute[] = [];
  for (const attribute of raw) {
    if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) continue;
    const parts = resolve(attribute.name, true);
    attributes.push({ qualifiedName: attribute.name, ...parts, value: attribute.value });
  }
  // Zwei Attribute mit verschiedenen Praefixen, aber gleichem Namensraum und
  // gleichem lokalen Namen sind laut Namespaces-Spezifikation ein Fehler. Sie
  // waeren hier ausserdem eine Stelle, an der die Sortierung der
  // Kanonisierung nicht entscheiden koennte.
  const keys = attributes.map((attribute) => `${attribute.namespaceUri}\u0000${attribute.localName}`);
  if (new Set(keys).size !== keys.length) fail("duplicate_expanded_attribute");

  return {
    kind: "element", qualifiedName, ...resolved, attributes, namespaces,
    children: [], parent,
  };
}

/**
 * Loest genau die fuenf vordefinierten Entities und numerische
 * Zeichenverweise auf. Jeder andere Verweis ist ein Formfehler und kein
 * durchgelassener Text: Ein benanntes Entity, das dieses Modul nicht kennt,
 * koennte in einem anderen Leser etwas bedeuten.
 */
export function decodeXmlText(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z]+);|&/g, (whole, reference?: string) => {
    if (!reference) throw new XmlFormatError("bare_ampersand");
    if (reference === "lt") return "<";
    if (reference === "gt") return ">";
    if (reference === "amp") return "&";
    if (reference === "quot") return '"';
    if (reference === "apos") return "'";
    if (reference.startsWith("#")) {
      const code = reference.startsWith("#x")
        ? Number.parseInt(reference.slice(2), 16)
        : Number.parseInt(reference.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) throw new XmlFormatError("bad_character_reference");
      return String.fromCodePoint(code);
    }
    throw new XmlFormatError("named_entity");
  });
}

/** Alle Elemente des Baumes, Dokumentreihenfolge, Wurzel zuerst. */
export function walkElements(element: XmlElement): XmlElement[] {
  const all: XmlElement[] = [element];
  for (const child of element.children) {
    if (child.kind === "element") all.push(...walkElements(child));
  }
  return all;
}

/** Die Kinderelemente mit genau diesem Namensraum und lokalen Namen. */
export function childElements(element: XmlElement, namespaceUri: string, localName: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement =>
    child.kind === "element" && child.namespaceUri === namespaceUri && child.localName === localName);
}

/** Genau ein Kindelement, oder `null`. Zwei sind `null`: Zwei heisst uneindeutig. */
export function onlyChild(element: XmlElement, namespaceUri: string, localName: string): XmlElement | null {
  const found = childElements(element, namespaceUri, localName);
  return found.length === 1 ? found[0] : null;
}

export function attributeValue(element: XmlElement, localName: string): string | null {
  const found = element.attributes.filter((attribute) => attribute.prefix === "" && attribute.localName === localName);
  return found.length === 1 ? found[0].value : null;
}

/** Der reine Textinhalt eines Elements, ohne Kindelemente zu betreten. */
export function directText(element: XmlElement): string {
  return element.children.filter((child): child is XmlText => child.kind === "text")
    .map((child) => child.text).join("");
}

/**
 * Sammelt jedes unqualifizierte `ID`-Attribut des Dokuments.
 *
 * Ein doppelt vergebener Wert ist hier ein Fehler und nicht die erste
 * Fundstelle. Genau daran haengt die Abwehr von XML Signature Wrapping: Wer
 * eine zweite Assertion mit derselben `ID` daneben legt, bekommt keine
 * Entscheidung darueber, welche von beiden die Referenz meint.
 */
export function collectIds(root: XmlElement): Map<string, XmlElement> {
  const byId = new Map<string, XmlElement>();
  for (const element of walkElements(root)) {
    const id = attributeValue(element, "ID");
    if (id === null) continue;
    if (byId.has(id)) throw new XmlFormatError("duplicate_id");
    byId.set(id, element);
  }
  return byId;
}

/**
 * Exklusive Kanonisierung eines Teilbaums.
 *
 * `omit` ist der eine Knoten, den die Transformation
 * `enveloped-signature` herausnimmt: das Signature-Element selbst mit allem
 * darunter. Umgebender Text bleibt stehen, weil die Transformation nur
 * Knoten aus der Knotenmenge nimmt und keinen Text zusammenzieht.
 */
export function canonicalizeExclusive(
  element: XmlElement,
  options: { omit?: XmlElement | null; inclusivePrefixes?: readonly string[] } = {},
): string {
  const parts: string[] = [];
  render(element, new Map<string, string>(), parts, options.omit ?? null,
    new Set(options.inclusivePrefixes ?? []));
  return parts.join("");
}

function render(
  node: XmlNode,
  rendered: ReadonlyMap<string, string>,
  parts: string[],
  omit: XmlElement | null,
  inclusive: ReadonlySet<string>,
): void {
  if (node.kind === "text") { parts.push(escapeText(node.text)); return; }
  if (node === omit) return;

  // Sichtbar benutzt: der eigene Praefix und die Praefixe der Attribute.
  // Ein unqualifiziertes Attribut benutzt den Standard-Namensraum **nicht**;
  // das ist der Unterschied, den die exklusive Kanonisierung ausmacht.
  const utilized = new Set<string>([node.prefix]);
  for (const attribute of node.attributes) {
    if (attribute.prefix) utilized.add(attribute.prefix);
  }
  for (const prefix of inclusive) {
    const resolved = prefix === "#default" ? "" : prefix;
    if (node.namespaces.has(resolved) || resolved === "") utilized.add(resolved);
  }
  // Der Praefix `xml` ist implizit deklariert und wird nie ausgegeben.
  utilized.delete("xml");

  const declarations: string[] = [];
  const nextRendered = new Map(rendered);
  for (const prefix of [...utilized].sort()) {
    const uri = node.namespaces.get(prefix) ?? "";
    const previous = rendered.get(prefix) ?? "";
    if (uri === previous) continue;
    if (!uri && !previous) continue;
    declarations.push(prefix
      ? ` xmlns:${prefix}="${escapeAttribute(uri)}"`
      : ` xmlns="${escapeAttribute(uri)}"`);
    nextRendered.set(prefix, uri);
  }

  const attributes = [...node.attributes].sort((left, right) =>
    left.namespaceUri === right.namespaceUri
      ? (left.localName < right.localName ? -1 : left.localName > right.localName ? 1 : 0)
      : (left.namespaceUri < right.namespaceUri ? -1 : 1));

  parts.push(`<${node.qualifiedName}`, ...declarations);
  for (const attribute of attributes) {
    parts.push(` ${attribute.qualifiedName}="${escapeAttribute(attribute.value)}"`);
  }
  parts.push(">");
  for (const child of node.children) render(child, nextRendered, parts, omit, inclusive);
  parts.push(`</${node.qualifiedName}>`);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
}

/** Escaping fuer selbst geschriebenes XML (die AuthnRequest). */
export function xmlAttributeText(value: string): string {
  return escapeAttribute(value);
}
