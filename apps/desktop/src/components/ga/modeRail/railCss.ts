/**
 * Checks the custom CSS a user types for the mode rail before it is applied (Settings > Appearance). A browser drops
 * what it cannot read without saying so, so this finds those parts and says where they are: unclosed or extra braces,
 * a selector that cannot be read, a declaration without "property: value", or a value the browser does not accept
 * (CSS.supports, when the browser has it). Allowed at-rules: @media, @supports, @keyframes, @font-face.
 * Stage: prototype.
 */
export interface CssProblem { line: number; text: string; reason: string }

/** Comments become spaces (newlines kept) so offsets and line numbers still match the user's text. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?(\*\/|$)/g, comment => comment.replace(/[^\n]/g, " "));
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/** Index of the brace that closes the one at `open`, ignoring braces inside quotes; -1 when it never closes. */
function closing(text: string, open: number): number {
  let depth = 0, quote = "";
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === "\\") i += 1; else if (ch === quote) quote = ""; continue; }
    if (ch === "\"" || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Splits declarations on ";" outside quotes and parentheses (a data: URL has a ";" inside url(...)). */
function declarations(body: string, start: number): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let depth = 0, quote = "", from = 0;
  for (let i = 0; i <= body.length; i += 1) {
    const ch = body[i];
    if (quote) { if (ch === "\\") i += 1; else if (ch === quote) quote = ""; continue; }
    if (ch === "\"" || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === ";" && depth === 0) || i === body.length) {
      const piece = body.slice(from, i);
      if (piece.trim()) out.push({ text: piece.trim(), at: start + from + (piece.length - piece.trimStart().length) });
      from = i + 1;
    }
  }
  return out;
}

/** Shadow-DOM selectors (:host, ::part, ::slotted) are valid here but not in a page's querySelector; read their inside. */
function plainSelector(selector: string): string {
  return selector
    .replace(/:host-context\(([^)]*)\)/g, "$1 ")
    .replace(/:host\(([^)]*)\)/g, "$1")
    .replace(/:host\b/g, "*")
    .replace(/::(part|slotted)\(([^)]*)\)/g, "")
    .trim() || "*";
}

function selectorOk(selector: string): boolean {
  try { document.createDocumentFragment().querySelector(plainSelector(selector)); return true; } catch { return false; }
}

function supports(property: string, value: string): boolean {
  if (property.startsWith("--")) return true;
  const check = typeof CSS !== "undefined" && typeof CSS.supports === "function" ? CSS.supports.bind(CSS) : null;
  return check ? check(property, value) : true;
}

function checkDeclarations(text: string, body: string, start: number, problems: CssProblem[], checkValues: boolean) {
  for (const { text: piece, at } of declarations(body, start)) {
    const match = /^(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:\s*([\s\S]*)$/.exec(piece);
    if (!match) { problems.push({ line: lineAt(text, at), text: piece, reason: "declaration" }); continue; }
    const value = match[2].replace(/!important\s*$/i, "").trim();
    if (!value) { problems.push({ line: lineAt(text, at), text: piece, reason: "empty" }); continue; }
    if (checkValues && !supports(match[1].toLowerCase(), value)) problems.push({ line: lineAt(text, at), text: piece, reason: "value" });
  }
}

function checkRules(text: string, from: number, to: number, problems: CssProblem[], keyframes = false) {
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(text[i])) i += 1;
    if (i >= to) break;
    let j = i;
    while (j < to && text[j] !== "{" && text[j] !== "}" && text[j] !== ";") j += 1;
    const prelude = text.slice(i, j).trim();
    if (j >= to) { problems.push({ line: lineAt(text, i), text: prelude, reason: "open" }); return; }
    if (text[j] === "}") { problems.push({ line: lineAt(text, j), text: "}", reason: "extra" }); i = j + 1; continue; }
    if (text[j] === ";") { problems.push({ line: lineAt(text, i), text: prelude + ";", reason: "outside" }); i = j + 1; continue; }
    const end = closing(text, j);
    if (end < 0 || end > to) { problems.push({ line: lineAt(text, j), text: prelude + " {", reason: "unclosed" }); return; }
    const body = text.slice(j + 1, end);
    const at = prelude.toLowerCase();
    if (keyframes) {
      if (!/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(at)) problems.push({ line: lineAt(text, i), text: prelude, reason: "selector" });
      checkDeclarations(text, body, j + 1, problems, true);
    } else if (at.startsWith("@media") || at.startsWith("@supports")) checkRules(text, j + 1, end, problems);
    else if (at.startsWith("@keyframes") || at.startsWith("@-webkit-keyframes")) checkRules(text, j + 1, end, problems, true);
    else if (at.startsWith("@font-face")) checkDeclarations(text, body, j + 1, problems, false);
    else if (at.startsWith("@")) problems.push({ line: lineAt(text, i), text: prelude, reason: "at-rule" });
    else if (!prelude || !selectorOk(prelude)) problems.push({ line: lineAt(text, i), text: prelude || "{", reason: "selector" });
    else if (/[{}]/.test(body)) problems.push({ line: lineAt(text, j), text: prelude, reason: "nested" });
    else checkDeclarations(text, body, j + 1, problems, true);
    i = end + 1;
  }
}

/** Every problem found in the user's CSS, in order; an empty list means it can be applied. */
export function validateRailCss(source: string): CssProblem[] {
  const text = blankComments(source ?? "");
  const problems: CssProblem[] = [];
  checkRules(text, 0, text.length, problems);
  return problems;
}
