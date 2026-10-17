import type { LibraryGame, LibraryPlan, LibrarySummary, LibraryTransfer, LibraryUsage } from "../catalog/DigitalProcessManager";

/** Sample library for design work in the browser (`?libraryDemo=1`, dev builds only): the real app reads it from the launcher. */
const GB = 1024 ** 3;
const row = (app_id: number, name: string, size: number, extra: Partial<LibraryGame> = {}): LibraryGame => ({
  app_id, name, state: "ready", folder: `C:\\games\\${app_id}-${name}-ready`, installed: true, needs_repair: false, error: "", warning: "",
  size_bytes: size * GB, plays: 0, last_played: "", issues: [], standard: true, reclaimable_bytes: 0, transfer_bytes: 0, transfer_active: false, ...extra,
});
const legacy = (extra: Partial<LibraryGame> = {}) => ({ state: "legacy", standard: false, warning: "Carpeta con formato anterior: no tiene estado en el nombre.", issues: [
  { code: "no_status", message: "Carpeta con formato anterior: no tiene estado en el nombre." }, { code: "no_log", message: "No tiene registro de historial." }], ...extra });

export const demoGames: LibraryGame[] = [
  row(1577120, "The Quarry", 91.6, legacy()),
  row(1664220, "TRAIL OUT", 26.2, legacy({ installed: false, issues: [{ code: "setup", message: "Falta ejecutar el instalador (setup_trail_out.exe)." }, { code: "no_status", message: "Carpeta con formato anterior." }], warning: "Falta ejecutar el instalador (setup_trail_out.exe)." })),
  row(2421750, "Gunman Contracts - Stand Alone", 27.8, legacy({ reclaimable_bytes: 8.7 * GB, issues: [{ code: "no_status", message: "Carpeta con formato anterior." }, { code: "obsolete_backup", message: "Guarda una copia comprimida que duplica el juego entero.", bytes: 8.7 * GB }] })),
  row(3844750, "FlatOut 4: Total Insanity VR", 54.8, legacy({ reclaimable_bytes: 19.5 * GB, plays: 3, issues: [{ code: "no_status", message: "Carpeta con formato anterior." }, { code: "obsolete_backup", message: "Guarda una copia comprimida que duplica el juego entero.", bytes: 19.5 * GB }] })),
  row(620, "Portal 2", 14.6, { plays: 12, last_played: "2026-10-15 21:10:00" }),
  row(413150, "Stardew Valley", 0.7, { plays: 31, last_played: "2026-10-16 18:02:00" }),
  row(881100, "Noita", 1.6, { plays: 6 }),
  row(363860, "MythForce", 7.1, legacy({ installed: false, transfer_bytes: 7.4 * GB, issues: [{ code: "extract", message: "Hay archivos comprimidos sin descomprimir." }], warning: "Hay archivos comprimidos sin descomprimir." })),
  row(3905450, "WheelMates", 7.2, { plays: 2 }),
  row(42910, "Magicka", 2.9, { state: "ERROR", standard: false, installed: false, needs_repair: true, error: "error intentando descomprimir Magicka.rar: contraseña incorrecta", issues: [{ code: "error", message: "error intentando descomprimir Magicka.rar: contraseña incorrecta" }] }),
  row(1245620, "ELDEN RING", 0, { state: "partial", installed: false, partial: true, transfer_bytes: 69.6 * GB }),
  row(1035510, "Ultimate Zombie Defense", 0, { state: "partial", installed: false, partial: true, transfer_bytes: 17.7 * GB }),
  row(1942280, "Brotato", 0.4, { state: "downloading", installed: false, transfer_bytes: 0.2 * GB, transfer_active: true }),
];

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
export const demoUsage: LibraryUsage = {
  by_day: Object.fromEntries([0, 1, 2, 3, 5, 6, 8, 9, 12].map((offset, index) => [day(offset), [3, 1, 4, 2, 5, 1, 2, 6, 3][index]])),
  by_month: { "2026-06": 21, "2026-07": 34, "2026-08": 18, "2026-09": 40, "2026-10": 27 },
};
export const demoTransfers: LibraryTransfer[] = [];
export const demoSummary: LibrarySummary = {
  count: 11, by_state: {}, needs_repair: 1, nonstandard: 5, partial_downloads: 3, used_bytes: 247 * GB, transfers_bytes: 96 * GB, reclaimable_bytes: 28 * GB,
  disk_free_bytes: 23 * GB, disk_total_bytes: 4000 * GB,
};

export function demoPlans(ids: number[]): LibraryPlan[] {
  return ids.map(id => {
    const game = demoGames.find(g => g.app_id === id)!;
    const actions = [{ code: "create_log", label: "Crear el registro del juego (su historial empieza ahora)" }, { code: "find_executable", label: "Detectar el ejecutable del juego" }] as LibraryPlan["actions"];
    for (const issue of game.issues) if (issue.code === "obsolete_backup") actions.push({ code: "delete_source", label: `Borrar ${game.name}_backup.rar (copia comprimida que duplica el juego)`, bytes: issue.bytes });
    actions.push({ code: "rename", label: `Renombrar la carpeta a ${id}-${game.name}-ready` });
    return { app_id: id, name: game.name, actions, freed_bytes: game.reclaimable_bytes, delete_sources: true };
  });
}
