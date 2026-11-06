// Tiny, XSS-safe markdown subset for Blob's replies (SCOPE §4.3, §6.6). Parsing yields a small
// AST; rendering builds DOM with createElement/createTextNode only, never HTML strings.
// Supported: paragraphs, one-level `-`/`*`/`1.` lists, **strong**, *em*/_em_, `code`,
// [label](url) and bare https:// URLs. Everything else (HTML, headings, images, tables, quotes,
// code fences, reference links and definitions, <autolinks>) stays literal text.
// The caller re-parses the whole reply on every streamed delta, so any prefix must parse, and
// parsing is linear: closers come from precomputed "next index" tables, never regex backtracking.
import { safeHref } from "./links";

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em"; c: Inline[] }
  | { t: "link"; href: string; external: boolean; c: Inline[] };
export type Block =
  { t: "p"; c: Inline[] } | { t: "ul" | "ol"; items: Inline[][] };

// ---------- blocks ----------

type Line = { text: string; literal: boolean };
type ListMarker = { t: "ul" | "ol"; rest: string };

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function listMarker(line: string): ListMarker | null {
  const s = line.trimStart();
  if ((s[0] === "-" || s[0] === "*") && s[1] === " ") {
    const rest = s.slice(2).trim();
    return rest === "" ? null : { t: "ul", rest };
  }
  let i = 0;
  while (i < s.length && i < 10 && isDigit(s[i]!)) i++;
  if (i > 0 && i < 10 && s[i] === "." && s[i + 1] === " ") {
    const rest = s.slice(i + 2).trim();
    return rest === "" ? null : { t: "ol", rest };
  }
  return null;
}

// Line-start markers that may precede a definition label: indentation, list bullets and
// numbers, blockquote markers. Same set as the server scrubber (P2-12).
const LINE_HEAD = " \t>*+-.)0123456789";

/**
 * `[label]: …` reference definitions are never honoured; the line stays literal text, also
 * behind `>`/list prefixes. Returns null, or whether the target sits on the next line.
 */
function definition(line: string): { targetNext: boolean } | null {
  let i = 0;
  while (i < line.length && LINE_HEAD.includes(line[i]!)) i++;
  if (line[i] !== "[") return null;
  const close = line.indexOf("]", i + 1);
  if (close <= i + 1 || line[close + 1] !== ":") return null;
  return { targetNext: line.slice(close + 2).trim() === "" };
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: Line[] | null = null;
  let list: { t: "ul" | "ol"; items: Line[][] } | null = null;
  let inFence = false;
  // The previous line was `[label]:` with nothing after it: this line is its target.
  let targetNext = false;

  const pushLiteral = (text: string): void => {
    if (list) flush();
    (para ??= []).push({ text, literal: true });
  };
  const flush = (): void => {
    if (para) blocks.push({ t: "p", c: parseLines(para) });
    if (list) blocks.push({ t: list.t, items: list.items.map(parseLines) });
    para = null;
    list = null;
  };

  for (const rawLine of src.split(/\r\n?|\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      targetNext = false;
      flush();
      continue;
    }
    const fenceMarker = line.startsWith("```");
    if (inFence || fenceMarker) {
      if (fenceMarker) inFence = !inFence;
      targetNext = false;
      pushLiteral(line);
      continue;
    }
    const def = definition(line);
    if (def || targetNext) {
      targetNext = def?.targetNext ?? false;
      pushLiteral(line);
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      if (para || (list && list.t !== marker.t)) flush();
      list ??= { t: marker.t, items: [] };
      list.items.push([{ text: marker.rest, literal: false }]);
    } else if (list) {
      list.items[list.items.length - 1]!.push({ text: line, literal: false });
    } else {
      (para ??= []).push({ text: line, literal: false });
    }
  }
  flush();
  return blocks;
}

/** Joins lines with a space; runs of normal lines get inline parsing, literal lines don't. */
function parseLines(lines: Line[]): Inline[] {
  const segments: Line[] = [];
  for (const line of lines) {
    const last = segments[segments.length - 1];
    if (!line.literal && last && !last.literal) last.text += ` ${line.text}`;
    else segments.push({ ...line });
  }
  const out: Inline[] = [];
  segments.forEach((seg, i) => {
    if (i > 0) out.push({ t: "text", v: " " });
    if (seg.literal) out.push({ t: "text", v: seg.text });
    else out.push(...parseInline(seg.text));
  });
  return mergeText(out);
}

function mergeText(xs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (x.t === "text" && last?.t === "text") last.v += x.v;
    else if (x.t !== "text" || x.v !== "") out.push(x);
  }
  return out;
}

// ---------- inlines ----------

const NONE = -1;

/** next[i] = smallest j >= i where pred(j) holds, or NONE. One right-to-left pass. */
function nextTable(n: number, pred: (j: number) => boolean): Int32Array {
  const next = new Int32Array(n + 1);
  next[n] = NONE;
  for (let j = n - 1; j >= 0; j--) next[j] = pred(j) ? j : next[j + 1]!;
  return next;
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t";
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

const URL_CHAR = /[A-Za-z0-9\-._~:/?#@!$&'()+,;=%]/;
const TRAILING_PUNCT = ".,;:!?'\"_";

type Flags = {
  strong: boolean;
  emStar: boolean;
  emUnder: boolean;
  link: boolean;
};

function parseInline(s: string): Inline[] {
  const n = s.length;
  const at = (j: number): string | undefined =>
    j >= 0 && j < n ? s[j] : undefined;
  const nextTick = nextTable(n, (j) => s[j] === "`");
  const nextDouble = nextTable(n, (j) => s[j] === "*" && s[j + 1] === "*");
  const nextSingle = nextTable(
    n,
    (j) => s[j] === "*" && at(j - 1) !== "*" && at(j + 1) !== "*",
  );
  const nextUnder = nextTable(
    n,
    (j) =>
      s[j] === "_" &&
      at(j - 1) !== "_" &&
      at(j + 1) !== "_" &&
      !isWordChar(at(j + 1)),
  );
  const nextOpen = nextTable(n, (j) => s[j] === "[");
  const nextClose = nextTable(n, (j) => s[j] === "]");
  const nextParen = nextTable(n, (j) => s[j] === ")");
  const nextOpenParen = nextTable(n, (j) => s[j] === "(");
  // A closer must be found strictly before `limit`, or NONE.
  const find = (table: Int32Array, from: number, limit: number): number => {
    if (from >= n) return NONE;
    const j = table[from]!;
    return j !== NONE && j < limit ? j : NONE;
  };

  /** `[label](url)` starting at i (s[i] === "["): label/url bounds, or null. */
  const linkShape = (
    i: number,
    end: number,
  ): { close: number; paren: number } | null => {
    const close = find(nextClose, i + 1, end);
    if (close === NONE || close === i + 1) return null;
    const inner = find(nextOpen, i + 1, close);
    if (inner !== NONE) return null;
    if (at(close + 1) !== "(") return null;
    let paren = find(nextParen, close + 2, end);
    // One level of balanced parens in the target, so `(javascript:alert(1))` is consumed whole.
    if (paren !== NONE && find(nextOpenParen, close + 2, paren) !== NONE) {
      paren = find(nextParen, paren + 1, end);
    }
    if (paren === NONE) return null;
    return { close, paren };
  };

  const parse = (start: number, end: number, flags: Flags): Inline[] => {
    const out: Inline[] = [];
    let buf = "";
    const emit = (x: Inline): void => {
      if (buf !== "") out.push({ t: "text", v: buf });
      buf = "";
      out.push(x);
    };
    let i = start;
    while (i < end) {
      const ch = s[i]!;
      const prev = at(i - 1);
      const escaped = prev === "\\";

      if (ch === "`" && !escaped) {
        const close = find(nextTick, i + 1, end);
        if (close !== NONE && close > i + 1) {
          emit({ t: "code", v: s.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      } else if (ch === "*" && s[i + 1] === "*" && !escaped && !flags.strong) {
        const after = at(i + 2);
        const close = find(nextDouble, i + 2, end - 1);
        if (
          after !== undefined &&
          !isSpace(after) &&
          close !== NONE &&
          close > i + 2 &&
          !isSpace(at(close - 1))
        ) {
          emit({
            t: "strong",
            c: parse(i + 2, close, { ...flags, strong: true }),
          });
          i = close + 2;
          continue;
        }
        buf += "**";
        i += 2;
        continue;
      } else if (
        ch === "*" &&
        prev !== "*" &&
        s[i + 1] !== "*" &&
        !escaped &&
        !flags.emStar
      ) {
        const after = at(i + 1);
        const close = find(nextSingle, i + 1, end);
        if (
          after !== undefined &&
          !isSpace(after) &&
          close !== NONE &&
          close > i + 1 &&
          !isSpace(at(close - 1))
        ) {
          emit({ t: "em", c: parse(i + 1, close, { ...flags, emStar: true }) });
          i = close + 1;
          continue;
        }
      } else if (
        ch === "_" &&
        prev !== "_" &&
        !escaped &&
        !isWordChar(prev) &&
        !flags.emUnder
      ) {
        const after = at(i + 1);
        const close = find(nextUnder, i + 1, end);
        if (
          after !== undefined &&
          after !== "_" &&
          !isSpace(after) &&
          close !== NONE &&
          close > i + 1 &&
          !isSpace(at(close - 1))
        ) {
          emit({
            t: "em",
            c: parse(i + 1, close, { ...flags, emUnder: true }),
          });
          i = close + 1;
          continue;
        }
      } else if (ch === "!" && s[i + 1] === "[" && !escaped) {
        // Images are never rendered: the whole `![alt](x)` stays literal text.
        const shape = linkShape(i + 1, end);
        const stop = shape ? shape.paren + 1 : i + 2;
        buf += s.slice(i, stop);
        i = stop;
        continue;
      } else if (ch === "[" && !escaped && !flags.link) {
        const shape = linkShape(i, end);
        if (shape) {
          const label = parse(i + 1, shape.close, { ...flags, link: true });
          const target = safeHref(s.slice(shape.close + 2, shape.paren));
          if (target) {
            emit({
              t: "link",
              href: target.href,
              external: target.external,
              c: label,
            });
          } else {
            // Disallowed target: keep only the label; the URL is never shown.
            for (const x of label) {
              if (x.t === "text") buf += x.v;
              else emit(x);
            }
          }
          i = shape.paren + 1;
          continue;
        }
      } else if (
        (ch === "h" || ch === "H") &&
        !flags.link &&
        prev !== "<" &&
        !isWordChar(prev) &&
        // Not the target of an unfinished `[label](` while streaming.
        !(prev === "(" && at(i - 2) === "]") &&
        s.slice(i, i + 8).toLowerCase() === "https://"
      ) {
        let j = i + 8;
        while (j < end && URL_CHAR.test(s[j]!)) j++;
        // Trim trailing punctuation and an unbalanced closing paren.
        let opens = 0;
        let closes = 0;
        for (let k = i; k < j; k++) {
          if (s[k] === "(") opens++;
          else if (s[k] === ")") closes++;
        }
        for (;;) {
          const last = s[j - 1]!;
          if (TRAILING_PUNCT.includes(last)) j--;
          else if (last === ")" && closes > opens) {
            closes--;
            j--;
          } else break;
        }
        const raw = s.slice(i, j);
        const target = j > i + 8 ? safeHref(raw) : null;
        if (target) {
          emit({
            t: "link",
            href: target.href,
            external: target.external,
            c: [{ t: "text", v: raw }],
          });
        } else {
          buf += raw;
        }
        i = Math.max(j, i + 1);
        continue;
      }
      buf += ch;
      i++;
    }
    if (buf !== "") out.push({ t: "text", v: buf });
    return mergeText(out);
  };

  return parse(0, n, {
    strong: false,
    emStar: false,
    emUnder: false,
    link: false,
  });
}

// ---------- render ----------

function renderInlines(
  doc: Document,
  parent: Element | DocumentFragment,
  xs: Inline[],
): void {
  // Tag names are literals, never AST data, and every href is re-checked here: a hand-built or
  // tampered AST can't produce another element or an unchecked link. Unknown nodes are dropped.
  for (const x of xs) {
    switch (x.t) {
      case "text":
        parent.append(doc.createTextNode(String(x.v)));
        break;
      case "code": {
        const el = doc.createElement("code");
        el.append(doc.createTextNode(String(x.v)));
        parent.append(el);
        break;
      }
      case "strong":
      case "em": {
        const el = doc.createElement(x.t === "strong" ? "strong" : "em");
        renderInlines(doc, el, x.c);
        parent.append(el);
        break;
      }
      case "link": {
        const target = safeHref(String(x.href));
        if (!target) {
          renderInlines(doc, parent, x.c); // label only
          break;
        }
        const a = doc.createElement("a");
        a.setAttribute("href", target.href);
        if (target.external) {
          a.setAttribute("rel", "noopener noreferrer");
          a.setAttribute("target", "_blank");
        }
        renderInlines(doc, a, x.c);
        parent.append(a);
        break;
      }
    }
  }
}

export function renderMarkdown(
  blocks: Block[],
  doc: Document = document,
): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const b of blocks) {
    if (b.t === "p") {
      const p = doc.createElement("p");
      renderInlines(doc, p, b.c);
      frag.append(p);
    } else if (b.t === "ul" || b.t === "ol") {
      const list = doc.createElement(b.t === "ul" ? "ul" : "ol");
      for (const item of b.items) {
        const li = doc.createElement("li");
        renderInlines(doc, li, item);
        list.append(li);
      }
      frag.append(list);
    }
  }
  return frag;
}
