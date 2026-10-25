// Guardia de i18n: falla si un .tsx tiene texto visible o title/aria-label/placeholder/alt literal.
// Uso: node scripts/check-i18n.mjs   (o npm run check:i18n)
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const ATTRS = "title|aria-label|aria-description|placeholder|alt|label|aria-valuetext";
const LETTERS = /[A-Za-zÀ-ÿ]{2,}/;

// Textos permitidos (marcas, nombres propios, símbolos). Se comparan sin espacios sobrantes.
export const ALLOWED_TEXT = new Set([
  "Steam", "GameAccess", "gameAccess", "Game", "Access", "GAME ACCESS", "Co-Optimus ↗", "DIGITAL", "Steam AppID", "12 GB", "Game Access", "PLUS", "GA", "ESC", "Esc", "FPS", "GB", "MB", "KB", "OK", "EN", "ES", "PC",
]);

export function scanSource(source) {
  const issues = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("import ")) return;
    if (/i18n-ignore/.test(line)) return;
    const attr = new RegExp(`\\b(${ATTRS})=\\"([^\\"]*)\\"`, "g");
    for (const m of line.matchAll(attr)) {
      const value = m[2].trim();
      if (LETTERS.test(value) && !ALLOWED_TEXT.has(value) && !/^[a-z0-9_:./-]+$/.test(value)) issues.push([index + 1, `${m[1]}="${value}"`]);
    }
    // texto JSX entre > y <, en una sola línea
    for (const m of line.matchAll(/>([^<>{}=]*[A-Za-zÀ-ÿ][^<>{}]*)</g)) {
      const value = m[1].trim();
      if (LETTERS.test(value) && !ALLOWED_TEXT.has(value) && !/=>|&&|\|\||\?|;|Promise|Array|CustomEvent|Math\.|document\./.test(value)) issues.push([index + 1, value]);
    }
    // línea que es solo texto JSX (continuación multilínea)
    if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ¿¡][^<>{}=;()]*[.:!?…]?$/.test(trimmed) && /\s/.test(trimmed) && !/^(return|const|let|if|else|case|export|function|type|import|default)\b/.test(trimmed)) {
      const prev = lines[index - 1]?.trim() ?? "";
      if (/>$/.test(prev) || /^[A-Za-zÀ-ÿ¿¡]/.test(prev) && !/[;,{(]$/.test(prev)) issues.push([index + 1, trimmed]);
    }
  });
  return issues;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

if (process.argv[1] && process.argv[1].endsWith("check-i18n.mjs")) {
  let total = 0;
  for (const file of walk(root)) {
    const issues = scanSource(readFileSync(file, "utf8"));
    for (const [line, text] of issues) {
      console.log(`${file.replace(root, "src")}:${line}  ${text}`);
      total += 1;
    }
  }
  if (total) {
    console.error(`\ni18n: ${total} texto(s) fijo(s) sin traducir. Usá t("clave") (src/locales).`);
    process.exit(1);
  }
  console.log("i18n: sin textos fijos en los .tsx");
}
