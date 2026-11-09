/**
 * Space and library: for "I have no room on the disk", "what takes the most" and "what is downloading". Everything comes
 * from the same library scan the Library Manager shows (libraryScan.ts) and from the Download Manager's own list.
 */
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import type { LibraryGame } from "../catalog/DigitalProcessManager";
import { activeDownloadService } from "../downloads/activeService";
import { queryCatalogCache } from "../catalogCache";
import { libraryScanState, scanLibrary } from "../libraryScan";
import { bool, gb, num, str, ToolError, type McpTool } from "./tools";

const DAY = 24 * 60 * 60 * 1000;

/** Days since the game was last played, or null if never (or not known). */
const idleDays = (game: LibraryGame): number | null => {
  const when = game.last_played ? Date.parse(game.last_played) : NaN;
  return Number.isFinite(when) ? Math.max(0, Math.floor((Date.now() - when) / DAY)) : null;
};

/** Where a game comes from, as the library shows it: one of Game Access's own, a linked folder, or Steam's. */
const origin = (game: LibraryGame) => game.link_kind === "steam" ? "steam" : game.linked ? "linked_folder" : "game_access";

export function librarySummaryRow(game: LibraryGame) {
  return {
    app_id: game.app_id,
    name: game.name,
    state: game.state,
    installed: game.installed,
    origin: origin(game),
    size_gb: gb(game.size_bytes),
    frozen: game.frozen ?? null,
    saved_by_freezing_gb: game.frozen && game.original_bytes && game.frozen_bytes != null ? gb(game.original_bytes - game.frozen_bytes) : null,
    reclaimable_gb: game.reclaimable_bytes ? gb(game.reclaimable_bytes) : null,
    plays: game.plays ?? 0,
    last_played: game.last_played ?? null,
    days_since_played: idleDays(game),
    added_at: game.added_at ?? null,
    needs_repair: game.needs_repair,
    problem: game.error || game.warning || null,
  };
}

/** The library as it is now: a fresh scan when asked, or the first time. */
async function library(fresh = false) {
  if (fresh || !libraryScanState().summary) await scanLibrary();
  const state = libraryScanState();
  if (state.error && !state.summary) throw new ToolError(`The library could not be read: ${state.error}`);
  return state;
}

/** The catalog's name for each game (a folder's name has underscores: "Forza_Horizon_6"); the folder's when unknown. */
async function withCatalogNames<T extends { app_id: number | null; name: string }>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map(row => row.app_id).filter((id): id is number => id != null))];
  if (!ids.length) return rows;
  try {
    const found = await queryCatalogCache({ app_ids: ids, limit: ids.length });
    const names = new Map(found.items.map(game => [game.app_id, game.name]));
    return rows.map(row => ({ ...row, name: (row.app_id != null && names.get(row.app_id)) || row.name.replace(/_/g, " ") }));
  } catch {
    return rows;
  }
}

/** Longest unplayed first (never played counts as longest), the bigger first among equals. */
const byIdle = (a: ReturnType<typeof librarySummaryRow>, b: ReturnType<typeof librarySummaryRow>) =>
  ((b.days_since_played ?? 1e6) - (a.days_since_played ?? 1e6)) || ((b.size_gb ?? 0) - (a.size_gb ?? 0));

const SORTS = ["size", "last_played", "idle", "plays", "name", "added"] as const;

export const libraryTools: McpTool[] = [
  {
    name: "storage_overview",
    title: "Disk space",
    description: "How much room the games disk has and where it goes: free and total space, what the library uses, what freezing already saved, what can be reclaimed (leftover files, unfinished downloads), and the biggest and the longest-unplayed installed games. Use it when the player is short of space, then suggest freezing (keeps the game, Windows compression, still playable), deep freezing (one archive, thawed before playing) or uninstalling.",
    inputSchema: { type: "object", properties: { refresh: { type: "boolean", description: "Scan the games folder again first." } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async args => {
      const state = await library(bool(args, "refresh") ?? false);
      const summary = state.summary;
      const installed = state.games.filter(game => game.installed);
      const rows = await withCatalogNames(installed.map(librarySummaryRow));
      return {
        disk: { free_gb: gb(summary?.disk_free_bytes), total_gb: gb(summary?.disk_total_bytes) },
        library: {
          games: installed.length,
          used_gb: gb(summary?.used_bytes),
          frozen_saved_gb: gb(summary?.frozen_saved_bytes ?? 0),
          reclaimable_gb: gb(summary?.reclaimable_bytes ?? 0),
          unfinished_downloads_gb: gb(summary?.transfers_bytes ?? 0),
          linked_folders_gb: gb(summary?.linked_bytes ?? 0),
        },
        biggest: [...rows].sort((a, b) => (b.size_gb ?? 0) - (a.size_gb ?? 0)).slice(0, 10),
        longest_unplayed: [...rows].filter(row => !row.frozen).sort(byIdle).slice(0, 10),
      };
    },
  },
  {
    name: "library_list",
    title: "The player's library",
    description: "The games in the player's library with their size, state (ready, frozen, needs repair...), origin (game_access, linked_folder, steam), plays and when they were last played.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["installed", "frozen", "needs_repair", "all"], description: "Default: installed." },
        query: { type: "string", description: "Words in the game's name." },
        sort: { type: "string", enum: [...SORTS], description: "Default: name. idle: longest unplayed first." },
        limit: { type: "number", description: "Default 100." },
        refresh: { type: "boolean", description: "Scan the games folder again first." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async args => {
      const state = await library(bool(args, "refresh") ?? false);
      const filter = str(args, "filter") ?? "installed";
      const sort = (str(args, "sort") ?? "name") as (typeof SORTS)[number];
      if (!SORTS.includes(sort)) throw new ToolError(`"sort" must be one of: ${SORTS.join(", ")}`);
      const words = (str(args, "query") ?? "").toLowerCase();
      const games = state.games.filter(game => {
        if (words && !game.name.replace(/_/g, " ").toLowerCase().includes(words)) return false;
        if (filter === "installed") return game.installed;
        if (filter === "frozen") return Boolean(game.frozen);
        if (filter === "needs_repair") return game.needs_repair;
        return true;
      }).map(librarySummaryRow);
      const named = await withCatalogNames(games);
      const order: Record<(typeof SORTS)[number], (a: ReturnType<typeof librarySummaryRow>, b: ReturnType<typeof librarySummaryRow>) => number> = {
        size: (a, b) => (b.size_gb ?? 0) - (a.size_gb ?? 0),
        last_played: (a, b) => (a.days_since_played ?? 1e6) - (b.days_since_played ?? 1e6),
        idle: byIdle,
        plays: (a, b) => b.plays - a.plays,
        name: (a, b) => a.name.localeCompare(b.name),
        added: (a, b) => (b.added_at ?? "").localeCompare(a.added_at ?? ""),
      };
      named.sort(order[sort]);
      const limit = num(args, "limit", { min: 1, max: 1000 }) ?? 100;
      return { total: named.length, games: named.slice(0, limit) };
    },
  },
  {
    name: "downloads_list",
    title: "Downloads",
    description: "The Download Manager's list: what is queued, downloading, paused, unpacking or failed, with progress, and the recent finished ones.",
    inputSchema: { type: "object", properties: { include_finished: { type: "boolean", description: "Also the finished and cancelled ones." } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async args => {
      const all = bool(args, "include_finished") ?? false;
      const downloads = activeDownloadService().getDownloads()
        .filter(entry => all || !isDownloadHistory(entry.snapshot.phase))
        .map(({ game, snapshot }) => ({
          app_id: game.app_id, name: game.name, phase: snapshot.phase, progress: Math.round(snapshot.progress ?? 0),
          download_percent: snapshot.downloadPercent ?? null, install_percent: snapshot.installPercent ?? null,
          status: snapshot.statusText ?? null, error: snapshot.error ?? null,
        }));
      return { count: downloads.length, downloads };
    },
  },
];
