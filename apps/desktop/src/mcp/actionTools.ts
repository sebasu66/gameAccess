/**
 * Manage and play: what the player asks their AI to do ("uninstall X", "freeze what I don't play", "download Y",
 * "open Z"). Each goes through the same code as its button, and what deletes or takes room asks the player in the app
 * first (confirm.ts). Long work (a download, a freeze) starts and answers at once; the AI follows it with
 * downloads_list and library_list.
 */
import { digitalCatalogService } from "../catalog/DigitalCatalog";
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import type { LibraryGame } from "../catalog/DigitalProcessManager";
import { activeDownloadService } from "../downloads/activeService";
import { startFreezeJob, type FreezeOutcome } from "../freezeJobs";
import { translate } from "../i18n";
import { libraryScanState, scanLibrary } from "../libraryScan";
import { hideNotice, showNotice } from "../notice/notice";
import { noticeGame } from "../notice/noticeGame";
import type { CatalogGame } from "../types";
import { appActions } from "./appActions";
import { askPlayer, logAction } from "./confirm";
import { catalogGame } from "./discoverTools";
import { workingOn } from "./libraryTools";
import { gb, num, str, ToolError, type McpTool } from "./tools";

const appIdOf = (args: Record<string, unknown>): number => {
  const appId = num(args, "app_id");
  if (appId == null) throw new ToolError('"app_id" is needed (from library_list or catalog_search)');
  return appId;
};

/** The game in the library, scanned now if the library was never read. */
async function libraryEntry(appId: number): Promise<LibraryGame | undefined> {
  if (!libraryScanState().summary) await scanLibrary();
  return libraryScanState().games.find(game => game.app_id === appId);
}

async function installedGame(appId: number): Promise<{ entry: LibraryGame; game: CatalogGame }> {
  const working = workingOn(appId);
  if (working) throw new ToolError(`Game Access is still working on this game (${working}). Wait until library_list no longer shows it as working.`);
  const entry = await libraryEntry(appId);
  if (!entry?.installed) throw new ToolError(`app_id ${appId} is not installed. library_list shows what is.`);
  const game = await catalogGame(appId).catch(() => ({ id: appId, app_id: appId, name: entry.name.replace(/_/g, " ") } as CatalogGame));
  return { entry, game };
}

const downloadOf = (appId: number) => activeDownloadService().getDownloads().find(item => item.game.app_id === appId && !isDownloadHistory(item.snapshot.phase));

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Waits a little for a freeze job: a small game is done at once; a big one is still working when this answers. */
async function briefly(done: Promise<FreezeOutcome>, ms = 10_000): Promise<FreezeOutcome | null> {
  return Promise.race([done, pause(ms).then(() => null)]);
}

const reasonArg = { type: "string", description: "Why, in a few words, for the player (shown in the app when it asks them)." };
const idArg = { type: "number", description: "The game's Steam app_id." };

export const actionTools: McpTool[] = [
  {
    name: "download_game",
    title: "Download a game",
    description: "Download and install a game from the catalog, as the Download button does (a Steam game the player owns is installed by Steam). The player is asked to allow it in the app. It answers once the download starts; follow it with downloads_list. Check storage_overview first if space may be short.",
    inputSchema: { type: "object", properties: { app_id: idArg, reason: reasonArg }, required: ["app_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async args => {
      const appId = appIdOf(args);
      const game = await catalogGame(appId);
      if ((await libraryEntry(appId))?.installed) throw new ToolError(`${game.name} is already installed.`);
      if (downloadOf(appId)) throw new ToolError(`${game.name} is already in the downloads. downloads_list shows how it goes.`);
      await askPlayer(game, "mcpActDownload", str(args, "reason"), "primary");
      await appActions().download(game);
      await pause(1500);
      const started = downloadOf(appId);
      if (!started) {
        const failed = activeDownloadService().getDownloads().find(item => item.game.app_id === appId);
        throw new ToolError(failed?.snapshot.error || `${game.name} did not start downloading. The app shows why in its notice.`);
      }
      return { app_id: appId, name: game.name, started: true, phase: started.snapshot.phase, status: started.snapshot.statusText ?? null };
    },
  },
  {
    name: "download_control",
    title: "Pause, resume, retry or cancel a download",
    description: "Control one download in the Download Manager. Cancelling stops it and deletes what it downloaded; the player is asked first.",
    inputSchema: {
      type: "object",
      properties: { app_id: idArg, action: { type: "string", enum: ["pause", "resume", "retry", "cancel"] }, reason: reasonArg },
      required: ["app_id", "action"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async args => {
      const appId = appIdOf(args);
      const action = str(args, "action");
      const service = activeDownloadService();
      const item = service.getDownloads().find(entry => entry.game.app_id === appId);
      if (!item) throw new ToolError(`app_id ${appId} is not in the downloads.`);
      const { game } = item;
      if (action === "pause") await service.pause(game.id);
      else if (action === "resume") await service.resume(game.id);
      else if (action === "retry") await service.retry(game);
      else if (action === "cancel") { await askPlayer(game, "mcpActCancel", str(args, "reason")); await service.cancel(game.id); }
      else throw new ToolError('"action" must be pause, resume, retry or cancel');
      if (action !== "cancel") logAction(`${action} ${game.name}`);
      const now = service.getDownloads().find(entry => entry.game.app_id === appId);
      return { app_id: appId, name: game.name, done: action, phase: now?.snapshot.phase ?? "removed" };
    },
  },
  {
    name: "uninstall_game",
    title: "Uninstall a game",
    description: "Uninstall a game Game Access installed: its folder is deleted and the room comes back. The player is asked to allow it in the app. Games from a linked folder or installed by Steam are not deleted by Game Access: say so and suggest Steam or freezing instead. Frozen games can be uninstalled too.",
    inputSchema: { type: "object", properties: { app_id: idArg, reason: reasonArg }, required: ["app_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async args => {
      const appId = appIdOf(args);
      const { entry, game } = await installedGame(appId);
      if (entry.linked) {
        throw new ToolError(entry.link_kind === "steam"
          ? `${game.name} was installed by Steam: Game Access does not delete it. The player can uninstall it from Steam.`
          : `${game.name} is in a folder linked to the library: Game Access does not delete it. The player can remove it from the library in the Library Manager (its files stay).`);
      }
      await askPlayer(game, "mcpActUninstall", str(args, "reason"));
      showNotice({ game: noticeGame(game), tone: "info", title: translate("uninstallDeleting"), text: game.name, progress: null });
      try {
        const { folder } = await digitalCatalogService.uninstall(game);
        showNotice({ game: noticeGame(game), tone: "ok", title: translate("toastGameUninstalled", { name: game.name }), text: folder });
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure);
        showNotice({ game: noticeGame(game), tone: "error", title: translate("uninstallFailed"), text: message, actions: [{ label: translate("close"), run: () => hideNotice() }] });
        throw new ToolError(`Uninstalling ${game.name} failed: ${message}`);
      }
      await scanLibrary();
      return { app_id: appId, name: game.name, uninstalled: true, freed_gb: gb(entry.frozen && entry.frozen_bytes != null ? entry.frozen_bytes : entry.size_bytes) };
    },
  },
  {
    name: "freeze_game",
    title: "Freeze a game",
    description: "Make room without uninstalling. level \"freeze\": Windows compression, the game stays playable as it is (no question asked). level \"deep\": one archive, much smaller, thawed automatically before it is played (takes minutes; the player is asked). Works in the background: library_list shows it as working until it ends, then frozen.",
    inputSchema: {
      type: "object",
      properties: { app_id: idArg, level: { type: "string", enum: ["freeze", "deep"] }, reason: reasonArg },
      required: ["app_id", "level"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async args => {
      const appId = appIdOf(args);
      const level = str(args, "level");
      if (level !== "freeze" && level !== "deep") throw new ToolError('"level" must be freeze or deep');
      const { entry, game } = await installedGame(appId);
      if (entry.frozen === level) throw new ToolError(`${game.name} is already ${level === "deep" ? "deep " : ""}frozen.`);
      if (level === "deep") await askPlayer(game, "mcpActDeepFreeze", str(args, "reason"), "frost");
      else logAction(`congelar ${game.name}`);
      const job = startFreezeJob(game, level);
      const outcome = await briefly(job.done);
      if (outcome && !outcome.ok) throw new ToolError(`Freezing ${game.name} failed: ${outcome.detail}`);
      if (outcome) await scanLibrary();
      const now = libraryScanState().games.find(row => row.app_id === appId);
      return {
        app_id: appId, name: game.name, level, finished: Boolean(outcome),
        saved_gb: outcome && now?.original_bytes && now.frozen_bytes != null ? gb(now.original_bytes - now.frozen_bytes) : null,
        note: outcome ? null : "Still working in the background; library_list will show it frozen.",
      };
    },
  },
  {
    name: "thaw_game",
    title: "Thaw a game",
    description: "Undo a freeze: the game goes back to its full size. Not needed to play: a frozen game plays as it is and a deep-frozen one is thawed by Play.",
    inputSchema: { type: "object", properties: { app_id: idArg }, required: ["app_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async args => {
      const appId = appIdOf(args);
      const { entry, game } = await installedGame(appId);
      if (!entry.frozen) throw new ToolError(`${game.name} is not frozen.`);
      logAction(`descongelar ${game.name}`);
      const outcome = await briefly(startFreezeJob(game, "thaw").done);
      if (outcome && !outcome.ok) throw new ToolError(`Thawing ${game.name} failed: ${outcome.detail}`);
      if (outcome) await scanLibrary();
      return { app_id: appId, name: game.name, finished: Boolean(outcome), note: outcome ? null : "Still working in the background." };
    },
  },
  {
    name: "play_game",
    title: "Play a game",
    description: "Launch an installed game as the Play button does (a deep-frozen one is thawed first). Answers once it is launching.",
    inputSchema: { type: "object", properties: { app_id: idArg }, required: ["app_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async args => {
      const appId = appIdOf(args);
      const { game } = await installedGame(appId);
      logAction(`jugar ${game.name}`);
      let failure: unknown = null;
      const launching = appActions().play(game).catch(error => { failure = error; });
      await Promise.race([launching, pause(4000)]);
      if (failure) throw new ToolError(`${game.name} did not start: ${failure instanceof Error ? failure.message : String(failure)}`);
      return { app_id: appId, name: game.name, launching: true };
    },
  },
];
