import { libraryMembership } from "./libraryMembership";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import { narrate } from "./narrationLog";
import type { CatalogGame } from "./types";
export async function removeLibraryGame(game: CatalogGame) {
  if (libraryMembership.isBusy()) throw new Error("Espera a que termine la operación de biblioteca.");
  libraryMembership.setBusy(true);
  try {
    await digitalDownloadService.uninstall(game);
    libraryMembership.remove(game);
    void narrate("Removed library game " + (game.app_id ?? game.id), {area:"LIBRARY"});
  } finally { libraryMembership.setBusy(false); }
}
export async function clearGameLibrary() {
  if (libraryMembership.isBusy() || digitalDownloadService.hasActiveDownloads()) throw new Error("Detén las descargas antes de vaciar la biblioteca.");
  libraryMembership.setBusy(true);
  const failed: string[] = [];
  try {
    for (const game of [...libraryMembership.getGames()]) {
      try { await digitalDownloadService.uninstall(game); libraryMembership.remove(game); }
      catch (error) { failed.push(game.name + ": " + String(error)); }
    }
    void narrate("Library cleanup finished; remaining=" + libraryMembership.getGames().length, {area:"LIBRARY"});
    if (failed.length) throw new Error(failed.join("\n"));
  } finally { libraryMembership.setBusy(false); }
}
