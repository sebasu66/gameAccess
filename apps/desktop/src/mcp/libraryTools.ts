/**
 * Space and library: for "I have no room on the disk", "what takes the most" and "what is downloading". Everything comes
 * from the same library scan the Library Manager shows (libraryScan.ts) and from the Download Manager's own list.
 */
import { isDownloadHistory } from "../catalog/DigitalDownloadService";
import type { LibraryGame } from "../catalog/DigitalProcessManager";
import { activeDownloadService } from "../downloads/activeService";
import { freezeJob } from "../freezeJobs";
import { queryCatalogCache } from "../catalogCache";
import { libraryScanState, scanLibrary } from "../libraryScan";
import { getGameCard, isHiddenGame, setGameCard, type GameCard } from "../gameCard";
import { deckGenres, genreLabel, primaryGenre } from "../libraryGenres";
import type { CatalogGame } from "../types";
import { bool, gb, num, str, ToolError, type McpTool } from "./tools";

const DAY = 24 * 60 * 60 * 1000;

/** Days since the game was last played, or null if never (or not known). */
const idleDays = (game: LibraryGame): number | null => {
  const when = game.last_played ? Date.parse(game.last_played) : NaN;
  return Number.isFinite(when) ? Math.max(0, Math.floor((Date.now() - when) / DAY)) : null;
};

/** Where a game comes from, as the library shows it: one of Game Access's own, a linked folder, or Steam's. */
const origin = (game: LibraryGame) => game.link_kind === "steam" ? "steam" : game.linked ? "linked_folder" : "game_access";

/** What the freeze queue is doing with a game: "freeze", "deep", "thaw" (or "move"), plus " (queued)" while it waits. */
export function workingOn(appId: number): string | null {
  const job = freezeJob(appId);
  if (!job || job.outcome) return null;
  return `${job.mode}${job.queued ? " (queued)" : ""}`;
}

export function librarySummaryRow(game: LibraryGame) {
  return {
    app_id: game.app_id,
    name: game.name,
    state: game.state,
    installed: game.installed,
    origin: origin(game),
    // Which library it is in: Game Access's own, or a linked account's (accounts_list), synced whole.
    library: game.library ? `${game.library.store}:${game.library.account || game.library.account_id}` : "game_access",
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
    /** A freeze, deep freeze or thaw going on (or waiting its turn) for this game. */
    working: game.app_id != null ? workingOn(game.app_id) : null,
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
    description: "The games in the player's library with their size, state (ready, frozen, needs repair, steam_owned: owned in a linked account but not installed...), origin (game_access, linked_folder, steam), library (game_access, or steam:<account> for a linked account's library, see accounts_list), plays and when they were last played.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["installed", "frozen", "needs_repair", "steam_owned", "all"], description: "Default: installed. steam_owned: games a linked account owns that are not installed (download_game installs them through Steam)." },
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
        if (filter === "steam_owned") return game.link_kind === "steam" && game.state === "steam_owned";
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
          status: snapshot.statusText ?? null, error: snapshot.error ?? null, error_code: snapshot.errorCode ?? null,
          // dialog: waiting for the player to confirm Steam's install window; download: Steam (or a source) downloading.
          step: snapshot.step ? { id: snapshot.step.id, detail: snapshot.step.detail ?? null, facts: snapshot.step.facts ?? null } : null,
          steps_done: (snapshot.steps ?? []).map(step => ({ id: step.id, state: step.state, result: step.result ?? null })),
          through_steam: Boolean(snapshot.steps?.some(step => ["dialog", "signin", "handoff", "adopt"].includes(step.id)) || (snapshot.step && ["dialog", "signin", "handoff", "adopt"].includes(snapshot.step.id))),
        }));
      return { count: downloads.length, downloads };
    },
  },
];

/** A game's card as the tools show it: what the player set, and what the library does with it. */
async function cardView(appId: number) {
  const found = await queryCatalogCache({ app_ids: [appId], limit: 1 }).catch(() => null);
  const game: CatalogGame | undefined = found?.items[0];
  const card = getGameCard({ app_id: appId, id: appId });
  const automatic = game ? primaryGenre(game) : null;
  const genre = card.genre ?? automatic;
  return {
    app_id: appId,
    store_name: game?.name ?? null,
    card,
    shown_name: card.name ?? game?.name ?? null,
    automatic_genre: automatic,
    deck: genre ? { id: genre, label: genreLabel(genre) } : null,
    hidden_in_play: isHiddenGame({ app_id: appId, id: appId }),
  };
}

/** Card fields from the tool's arguments: an empty text clears it, "auto" gives the genre back to the automatic one. */
function cardChanges(args: Record<string, unknown>, current: GameCard): GameCard {
  const next: GameCard = { ...current };
  const text = (key: "name" | "cover") => { const value = str(args, key); if (value !== undefined) next[key] = value.trim() || undefined; };
  text("name"); text("cover");
  const genre = str(args, "genre");
  if (genre !== undefined) {
    const id = genre.trim();
    if (!id || id === "auto") next.genre = undefined;
    else if (!deckGenres().includes(id)) throw new ToolError(`Unknown genre "${id}". Use game_card_get's genres list (an id, or "auto").`);
    else next.genre = id;
  }
  const hidden = bool(args, "hidden");
  if (hidden !== undefined) next.hidden = hidden || undefined;
  return next;
}

export const gameCardTools: McpTool[] = [
  {
    name: "game_card_get",
    title: "A game's card",
    description: "How the library presents one game (Library › Game card): the player's display name, cover (a web address or a picture on this PC), main genre (the deck it is in under Play › By genre; automatic comes from Steam's weighted tags) and whether it is hidden in Play. Also lists the genre ids game_card_set accepts.",
    inputSchema: { type: "object", properties: { app_id: { type: "number", description: "The game's Steam app id." } }, required: ["app_id"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async args => {
      const appId = num(args, "app_id", { min: 1 });
      if (appId == null) throw new ToolError('"app_id" is required.');
      return { ...await cardView(appId), genres: deckGenres().map(id => ({ id, label: genreLabel(id) })) };
    },
  },
  {
    name: "game_card_set",
    title: "Change a game's card",
    description: "Changes how the library presents one game, as its card in the library manager does: display name, cover, main genre (its deck under Play › By genre) and hidden in Play. Only the fields given change; an empty name or cover goes back to Steam's, genre \"auto\" goes back to the automatic one.",
    inputSchema: {
      type: "object",
      properties: {
        app_id: { type: "number", description: "The game's Steam app id." },
        name: { type: "string", description: "Name shown in the library; empty for the store's." },
        cover: { type: "string", description: "Cover: a web address (https://…) or a picture's path on this PC; empty for Steam's." },
        genre: { type: "string", description: "Genre id from game_card_get's list, or \"auto\"." },
        hidden: { type: "boolean", description: "true hides it in Library › Play (the library manager still lists it)." },
      },
      required: ["app_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async args => {
      const appId = num(args, "app_id", { min: 1 });
      if (appId == null) throw new ToolError('"app_id" is required.');
      const key = { app_id: appId, id: appId };
      setGameCard(key, cardChanges(args, getGameCard(key)));
      return cardView(appId);
    },
  },
];
