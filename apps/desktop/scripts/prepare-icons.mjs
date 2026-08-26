import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const iconsDir = path.join(desktopRoot, "src-tauri", "icons");
const source = path.join(iconsDir, "icon.ico.base64.txt");
const target = path.join(iconsDir, "icon.ico");

await mkdir(iconsDir, { recursive: true });
const encoded = (await readFile(source, "utf8")).trim();
await writeFile(target, Buffer.from(encoded, "base64"));
console.log(`Prepared ${target}`);
