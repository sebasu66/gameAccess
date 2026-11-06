// Guardia del texto de los diálogos (docs/GUI_DESIGN.md §4.25): falla si un .css
//  1. pone a un párrafo o título (p, h1–h6) lo que manda la regla general de components/ga/content.css
//     (margen, fuente, tamaño, interlineado, alineación), o
//  2. escribe un color hexadecimal suelto fuera de los archivos del tema (los colores son tokens de :root).
// Lo viejo queda en scripts/dialog-css-baseline.json como deuda contada por archivo: puede bajar, nunca subir.
// Uso: node scripts/check-dialog-css.mjs  (o npm run check:css);  --update reescribe la línea de base.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "src");
const baselinePath = join(here, "dialog-css-baseline.json");

/** The theme files: the only places where a raw colour may be written. */
export const THEME_FILES = new Set(["gameaccess-theme.css", "ga-design.css", "components/ga/content.css", "tabs.css"]);
/** The content layer itself: the one place that sets the basics of a paragraph. */
const CONTENT_FILE = "components/ga/content.css";
const TEXT_ELEMENT = /^(p|h[1-6])(?![\w-])/;
const BASICS = /^(margin(-[a-z]+)?|font|font-size|font-family|line-height|text-align)$/;

/** Problems in one stylesheet: [line, message]. */
export function scanCss(source, file) {
  const issues = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "));
  const lineOf = index => text.slice(0, index).split("\n").length;
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (selector.startsWith("@") || file === CONTENT_FILE) continue;
    // The element a selector lands on is its last compound (:where/:is unwrapped, :not/:has dropped).
    const targets = selector.split(",").map(part => part.replace(/:(not|has)\([^()]*\)/g, "").replace(/:(where|is)\(([^()]*)\)/g, " $2").trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? "");
    if (targets.some(target => TEXT_ELEMENT.test(target))) {
      for (const declaration of rule[2].split(";")) {
        const property = declaration.split(":")[0]?.trim().toLowerCase();
        if (property && BASICS.test(property)) issues.push([lineOf(rule.index + rule[1].search(/\S/)), `${selector} { ${property} } — la regla general de content.css ya lo define`]);
      }
    }
  }
  if (!THEME_FILES.has(file)) {
    for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const before = text.slice(Math.max(0, match.index - 200), match.index);
      if (/[{;]\s*[\w-]+\s*:[^;{}]*$/.test(before)) issues.push([lineOf(match.index), `color ${match[0]} — usá un token de :root`]);
    }
  }
  return issues;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

/** Every stylesheet's problems, by file relative to src/. */
export function scanAll() {
  const result = {};
  for (const full of walk(root)) {
    const file = relative(root, full).split("\\").join("/");
    const issues = scanCss(readFileSync(full, "utf8"), file);
    if (issues.length) result[file] = issues;
  }
  return result;
}

/** Files whose problems grew past the baseline (new files have a baseline of 0). */
export function regressions(found = scanAll(), baseline = JSON.parse(readFileSync(baselinePath, "utf8"))) {
  return Object.entries(found).filter(([file, issues]) => issues.length > (baseline[file] ?? 0)).map(([file, issues]) => ({ file, issues, allowed: baseline[file] ?? 0 }));
}

if (process.argv[1] && process.argv[1].endsWith("check-dialog-css.mjs")) {
  const found = scanAll();
  if (process.argv.includes("--update")) {
    const counts = Object.fromEntries(Object.entries(found).map(([file, issues]) => [file, issues.length]).sort());
    writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`dialog-css: línea de base con ${Object.keys(counts).length} archivo(s)`);
  } else {
    const bad = regressions(found);
    for (const { file, issues, allowed } of bad) {
      console.log(`src/${file}: ${issues.length} (antes ${allowed})`);
      for (const [line, message] of issues) console.log(`  ${line}: ${message}`);
    }
    if (bad.length) {
      console.error("\ndialog-css: estilos nuevos que rompen la plantilla del texto de los diálogos (docs/GUI_DESIGN.md §4.25).");
      process.exit(1);
    }
    console.log("dialog-css: sin estilos nuevos de párrafo ni colores sueltos");
  }
}
