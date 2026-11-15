/**
 * A small XML reader for Final Draft files: elements, attributes and text, with entities decoded.
 * Comments, processing instructions and a DOCTYPE are skipped; CDATA is text. Not validating: a
 * stray closing tag closes nothing, and an unclosed element ends with the file.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTR = /\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/** The document's root element. Throws if there is none. */
export function parseXml(source: string): XmlElement {
  const s = source.replace(/^﻿/, "");
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const text = (t: string) => {
    if (t) stack.at(-1)!.children.push(t);
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      text(decodeEntities(s.slice(i)));
      break;
    }
    if (lt > i) text(decodeEntities(s.slice(i, lt)));
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      i = end < 0 ? s.length : end + 3;
    } else if (s.startsWith("<![CDATA[", lt)) {
      const end = s.indexOf("]]>", lt + 9);
      text(s.slice(lt + 9, end < 0 ? s.length : end));
      i = end < 0 ? s.length : end + 3;
    } else if (s.startsWith("<?", lt)) {
      const end = s.indexOf("?>", lt + 2);
      i = end < 0 ? s.length : end + 2;
    } else if (s.startsWith("<!", lt)) {
      // A DOCTYPE, possibly with an internal subset in brackets.
      let depth = 0;
      let j = lt + 2;
      for (; j < s.length; j++) {
        const c = s[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else if (s[lt + 1] === "/") {
      const end = s.indexOf(">", lt);
      const name = s.slice(lt + 2, end < 0 ? s.length : end).trim();
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end < 0 ? s.length : end + 1;
    } else {
      NAME.lastIndex = lt + 1;
      const m = NAME.exec(s);
      if (!m) {
        text("<");
        i = lt + 1;
        continue;
      }
      const el: XmlElement = { name: m[0], attrs: {}, children: [] };
      let j = NAME.lastIndex;
      for (;;) {
        ATTR.lastIndex = j;
        const a = ATTR.exec(s);
        if (!a) break;
        el.attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
        j = ATTR.lastIndex;
      }
      const end = s.indexOf(">", j);
      const close = end < 0 ? s.length : end;
      stack.at(-1)!.children.push(el);
      if (s[close - 1] !== "/") stack.push(el);
      i = close + 1;
    }
  }
  const top = root.children.find((c): c is XmlElement => typeof c !== "string");
  if (!top) throw new Error("The file has no XML content.");
  return top;
}

/** Child elements, optionally only those with a name. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== "string" && (name === undefined || c.name === name));
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

/** All the text inside an element, in order. */
export function textContent(el: XmlElement): string {
  return el.children.map((c) => (typeof c === "string" ? c : textContent(c))).join("");
}
