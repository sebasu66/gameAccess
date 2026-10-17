import { useI18n } from "./i18n";
import type { AutomationFields } from "./catalog/ExecutionProfiles";

const copy = {
  es: { decompress: "¿Descomprimir archivo en cada ejecución?", decompressFile: "Archivo del fix (se busca en la carpeta del juego)", none: "Elegí un archivo…",
    decompressHint: "Se descomprime con 7-Zip sobre la carpeta del juego antes de jugar, por si el antivirus borró archivos del crack.",
    patterns: "Archivos a probar ejecutar", patternsHint: "Uno por línea, en orden. Ejemplos: GAMENAME.EXE, *LAUNCHER*.EXE",
    admin: "¿Ejecutar como administrador?", setup: "Instalador (setup*.exe)", auto: "Automático: instalar solo si no hay ejecutable del juego", always: "Siempre instalar en silencio", never: "Nunca ejecutar el instalador" },
  en: { decompress: "Decompress file on every run?", decompressFile: "Fix archive (looked up in the game folder)", none: "Pick a file…",
    decompressHint: "Extracted with 7-Zip over the game folder before playing, in case antivirus deleted crack files.",
    patterns: "Files to try to run", patternsHint: "One per line, in order. Examples: GAMENAME.EXE, *LAUNCHER*.EXE",
    admin: "Run as administrator?", setup: "Installer (setup*.exe)", auto: "Automatic: install only when there is no game executable", always: "Always install silently", never: "Never run the installer" },
};

export default function AutomationForm({ value, onChange, archives, disabled = false }: { value: AutomationFields; onChange: (next: AutomationFields) => void; archives: string[]; disabled?: boolean }) {
  const { locale } = useI18n(); const c = copy[locale] ?? copy.es;
  const set = (patch: Partial<AutomationFields>) => onChange({ ...value, ...patch });
  const setupValue = value.runSetup === null ? "auto" : value.runSetup ? "always" : "never";
  return <div className="ga-automation-form">
    <label className="ga-style-toggle"><input type="checkbox" checked={value.decompressEachRun} disabled={disabled} onChange={event => set({ decompressEachRun: event.target.checked })} />{c.decompress}</label>
    <label className="ga-path-control"><span>{c.decompressFile}</span>
      <select value={value.decompressFile} disabled={disabled || !value.decompressEachRun} onChange={event => set({ decompressFile: event.target.value })}>
        <option value="">{c.none}</option>
        {value.decompressFile && !archives.includes(value.decompressFile) ? <option value={value.decompressFile}>{value.decompressFile}</option> : null}
        {archives.map(archive => <option key={archive} value={archive}>{archive}</option>)}
      </select></label>
    <p>{c.decompressHint}</p>
    <label className="ga-path-control"><span>{c.patterns}</span>
      <textarea rows={4} value={value.executablePatterns.join("\n")} disabled={disabled} placeholder={"GAMENAME.EXE\n*LAUNCHER*.EXE"} onChange={event => set({ executablePatterns: event.target.value.split(/\r?\n/) })} /></label>
    <p>{c.patternsHint}</p>
    <label className="ga-style-toggle"><input type="checkbox" checked={value.runAsAdmin} disabled={disabled} onChange={event => set({ runAsAdmin: event.target.checked })} />{c.admin}</label>
    <label className="ga-path-control"><span>{c.setup}</span>
      <select value={setupValue} disabled={disabled} onChange={event => set({ runSetup: event.target.value === "auto" ? null : event.target.value === "always" })}>
        <option value="auto">{c.auto}</option><option value="always">{c.always}</option><option value="never">{c.never}</option>
      </select></label>
  </div>;
}
