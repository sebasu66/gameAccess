import { saveExecutionProfile, ensureExecutionProfile } from "./ExecutionProfiles";
import { getSteamStoreLanguage } from "../i18n";
import { loadDiscoveryCatalog } from "./DiscoveryCatalog";
import { queryCatalogCache, readCatalogCachedDetail, storeCatalogCachedDetail } from "../catalogCache";
import { getSteamStoreMetadata, hasTauriRuntime } from "../native";
import { FlowDiagnostics } from "../FlowDiagnostics";
import { narrate } from "../narrationLog";
import { checkPluginSources, getPluginSources, preparePluginSource, type PluginSource } from "./PluginSources";
export type { PluginSource, PluginManifest } from "./PluginSources";
import { applyBundledCatalogArtwork, applyBundledDetails } from "../bundledArtwork";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { normalizeSteamStoreMetadata, mergeLocalSteamDetails } from "../steamMetadata";
import type { CatalogGame, GameDetails } from "../types";
import defaultCatalog from "./digital_catalog.json";
import { digitalDownloadService } from "./DigitalDownloadService";
import { digitalProcessManager } from "./DigitalProcessManager";
import { getApiBaseUrl } from "../settings";

export interface DigitalCatalogSyncResult {
  updated: boolean;
  revision: string;
  catalog_count: number;
}

export interface DigitalGameRecord {
  name: string;
  id: number;
  downloadSource: string;
  sourceDelivery?: "browser" | "download";
  installProcess: string;
  playProcess: string;
  uninstallProcess: string;
  auto_installed?: boolean;
}

export interface DigitalCatalogOptions {
  catalogLoader?: () => Promise<CatalogGame[]>;
  playHandler?: (game: CatalogGame, record?: DigitalGameRecord) => Promise<void>;
  downloadHandler?: (game: CatalogGame, record?: DigitalGameRecord) => Promise<void>;
  uninstallHandler?: (game: CatalogGame, record?: DigitalGameRecord) => Promise<void>;
  isInstalledHandler?: (game: CatalogGame, record?: DigitalGameRecord) => Promise<boolean>;
  openFolderHandler?: (game: CatalogGame, record?: DigitalGameRecord) => Promise<void>;
}

/**
 * Handles the Digital catalog tab and operations independently from
 * GameAccess provider account pooling, credit ledgers, and license leases.
 */
export class DigitalCatalog {
  private rawRecords = new Map<number, DigitalGameRecord>();

  constructor(private readonly options: DigitalCatalogOptions = {}) {}

  getRecord(gameId: number): DigitalGameRecord | undefined {
    return this.rawRecords.get(gameId);
  }

  ensureRecord(game: CatalogGame): DigitalGameRecord {
    const appId = game.app_id ?? game.id;
    let record = this.rawRecords.get(game.id) ?? this.rawRecords.get(appId);
    if (!record) {
      record = {
        name: game.name || `Juego ${appId}`,
        id: appId,
        downloadSource: (game as any).downloadSource ?? "",
        installProcess: (game as any).installProcess ?? (game as any).install_process ?? "",
        playProcess: (game as any).playProcess ?? (game as any).play_process ?? "",
        uninstallProcess: (game as any).uninstallProcess ?? (game as any).uninstall_process ?? "",
        auto_installed: (game as any).auto_installed === true,
      };
      this.rawRecords.set(game.id, record);
      this.rawRecords.set(appId, record);
    }
    return record;
  }

  clearCache(): void {
    this.rawRecords.clear();
  }

  /**
   * Synchronizes the catalog cache and returns revision and count without loading all games into memory.
   */
  async loadCatalog(options: { requireRemote?: boolean } = {}): Promise<DigitalCatalogSyncResult> {
    const diagnostics = new FlowDiagnostics("catalog-load", "CATALOG");
    diagnostics.debug(`Loading catalog; requireRemote=${Boolean(options.requireRemote)}`);
    try {
      const summary = await this.readCatalog(options, diagnostics);
      diagnostics.debug(`Catalog ready; count=${summary.catalog_count}; revision=${summary.revision}`);
      diagnostics.succeed();
      return summary;
    } catch (error) { diagnostics.fail(error); throw error; }
    finally { diagnostics.discard(); }
  }

  async readCatalog(
    { requireRemote = false }: { requireRemote?: boolean } = {},
    diagnostics?: FlowDiagnostics,
  ): Promise<DigitalCatalogSyncResult> {
    if (this.options.catalogLoader) {
      const loaded = await this.options.catalogLoader();
      const list = (Array.isArray(loaded) ? loaded : []) as CatalogGame[];
      for (const item of list) {
        this.ensureRecord(item);
      }
      return { updated: true, revision: "loader", catalog_count: list.length };
    }

    const discovery = await loadDiscoveryCatalog(requireRemote, getSteamStoreLanguage());
    if (!discovery) {
      return { updated: false, revision: "empty", catalog_count: 0 };
    }
    return {
      updated: discovery.updated,
      revision: discovery.revision,
      catalog_count: discovery.catalog_count,
    };
  }

  /** Games by catalog id (likes and recent games are stored that way). */
  async getGamesByCatalogIds(ids: number[]): Promise<CatalogGame[]> {
    if (!ids.length) return [];
    if (this.options.catalogLoader) {
      const loaded = await this.options.catalogLoader();
      const set = new Set(ids);
      return (loaded as CatalogGame[]).filter(g => set.has(g.id));
    }
    const result = await queryCatalogCache({ game_ids: ids, limit: Math.min(1000, ids.length) });
    return applyBundledCatalogArtwork(this.normalizeGames(result.items));
  }

  async getGamesByAppIds(appIds: number[]): Promise<CatalogGame[]> {
    if (!appIds.length) return [];
    if (this.options.catalogLoader) {
      const loaded = await this.options.catalogLoader();
      const set = new Set(appIds);
      return (loaded as CatalogGame[]).filter(g => set.has(g.app_id ?? g.id));
    }
    const result = await queryCatalogCache({ app_ids: appIds, limit: appIds.length });
    return applyBundledCatalogArtwork(this.normalizeGames(result.items));
  }

  /**
   * Retrieves game details in the standard GameDetails format,
   * enriched with Steam Store metadata if available.
   */
  async loadDetails(gameId: number, knownGame?: CatalogGame): Promise<GameDetails> {
    const diagnostics = new FlowDiagnostics(`detail-load app_id=${gameId}`, "DETAILS");
    diagnostics.debug(`language=${getSteamStoreLanguage()} detail lookup entered`);
    try {
      const detail = await this.readDetails(gameId, knownGame, diagnostics);
      diagnostics.debug(`Detail returned; state=${detail.metadata_state}`);
      diagnostics.succeed();
      return detail;
    } catch (error) { diagnostics.fail(error); throw error; }
    finally { diagnostics.discard(); }
  }

  private async readDetails(gameId: number, knownGame: CatalogGame | undefined, diagnostics: FlowDiagnostics): Promise<GameDetails> {
    let game = knownGame;
    if (!game) {
      if (this.options.catalogLoader) {
        const loaded = await this.options.catalogLoader();
        game = (loaded as CatalogGame[]).find((item) => item.id === gameId || item.app_id === gameId);
      } else {
        const queried = await queryCatalogCache({ app_ids: [gameId], limit: 1 }).catch(() => ({ items: [] as CatalogGame[], total: 0 }));
        game = queried.items[0];
      }
    }
    if (!game) throw new Error("Juego no encontrado en el catálogo Digital");

    const lang = getSteamStoreLanguage();
    const cached = await readCatalogCachedDetail(game.catalog_cache_id ?? game.id, lang, "ar").catch(() => null);
    diagnostics.debug(`Local detail cache=${cached?.steam ? "hit" : "miss"}; schema=${cached?.detail_schema_version}`);
    if (cached?.steam && cached.detail_schema_version === 2) return applyBundledDetails({ ...game, ...cached, steam: cached.steam });

    // Prefer durable server metadata; public Steam is only a cache-miss fallback.
    if (game.app_id) {
      try {
        const apiUrl = await getApiBaseUrl();
        if (apiUrl) {
          const res = await fetch(`${apiUrl}/digital/games/${game.app_id}/details?language=${encodeURIComponent(lang)}&country=ar`, {
            signal: AbortSignal.timeout(8000)
          });
          diagnostics.debug(`Server detail HTTP=${res.status}`);
          if (res.ok) {
            const serverData = await res.json();
            if (serverData && serverData.steam) {
              const steam = normalizeSteamStoreMetadata(game, serverData.steam);
              const detail = await applyBundledDetails({ ...game, steam, metadata_state: serverData.metadata_state || "ready", detail_schema_version: 2 });
              await storeCatalogCachedDetail(game.catalog_cache_id ?? game.id, lang, "ar", detail).catch(() => undefined);
              return detail;
            }
          }
        }
      } catch (e) {
        diagnostics.debug(`Server detail failed; trying fallback: ${String(e)}`);
        void narrate("AppID " + game.app_id + " · using cached catalog detail after server failure: " + String(e), {area:"DETAILS",level:"WARN"});
        // Continue to fallback
      }
    }

    // Opening a detail can use public Steam metadata even when the central API is older/offline.
    if (game.app_id && hasTauriRuntime()) {
      try {
        diagnostics.debug("Trying native Steam detail fallback");
        const raw = await getSteamStoreMetadata(game.app_id, false, lang);
        if (raw) {
          const detail = await applyBundledDetails(mergeLocalSteamDetails({ ...game, steam: null, metadata_state: "ready", detail_schema_version: 2 }, raw));
          void storeCatalogCachedDetail(game.catalog_cache_id ?? game.id, lang, "ar", detail).catch(() => undefined);
          return detail;
        }
      } catch (error) {
        void narrate("AppID " + game.app_id + " · public Steam detail failed: " + String(error), {area:"DETAILS",level:"WARN"});
      }
    }
    if (cached?.steam) return applyBundledDetails({ ...game, ...cached, steam: cached.steam });
    diagnostics.debug("Returning catalog-only detail fallback");
    const fallbackDetails: GameDetails = {
      ...game,
      steam: {
        app_id: game.app_id ?? game.id,
        name: game.name,
        short_description: game.short_description ?? "Catálogo Digital.",
        background: game.hero_image ?? undefined,
        genres: game.genres,
        categories: game.categories,
        developers: game.developers,
        publishers: game.publishers,
        release_date: game.release_date ?? undefined,
      },
      metadata_state: "digital",
    };

    return applyBundledDetails(fallbackDetails);
  }

  /**
   * Checks whether the game is installed locally.
   */
  async isInstalled(game: CatalogGame): Promise<boolean> {
    if (this.options.isInstalledHandler) {
      return this.options.isInstalledHandler(game);
    }
    return (await this.getStatus(game)).installed;
  }

  /**
   * Launches or executes the game without GameAccess license reservation.
   */
  async play(game: CatalogGame): Promise<void> {
    if (this.options.playHandler) {
      return this.options.playHandler(game);
    }
    const record = this.ensureRecord(game);
    digitalDownloadService.registerRecords([record]);
    await digitalDownloadService.play(game);
  }

  /**
   * Initiates installation or download for the game.
   */
  async bulkCheckSources(games: CatalogGame[]): Promise<Record<number, number>> { return checkPluginSources(games); }
  async getSources(game: CatalogGame): Promise<PluginSource[]> { return getPluginSources(game); }

  async download(game: CatalogGame, source?: PluginSource | string): Promise<void> {
    if (this.options.downloadHandler) return this.options.downloadHandler(game);
    const selected = typeof source === "string"
      ? (await this.getSources(game)).find(item => item.url === source)
      : source ?? (await this.getSources(game))[0];
    if (!selected) throw new Error("No se encontró ninguna fuente de descarga activa para este juego.");
    const prepared = await preparePluginSource(selected);
    const appId = game.app_id ?? game.id;
    if (prepared.executionProfile) await saveExecutionProfile(appId, prepared.executionProfile);
    else await ensureExecutionProfile(appId);
    const record = this.ensureRecord(game);
    const effectiveRecord: DigitalGameRecord = {
      name: game.name, id: appId, downloadSource: prepared.url, sourceDelivery: prepared.delivery,
      installProcess: "", playProcess: record.playProcess ?? "", uninstallProcess: "", auto_installed: false,
    };
    digitalDownloadService.registerRecords([effectiveRecord]);
    return digitalDownloadService.start({ ...game, download_size: selected.size, download_size_bytes: null,
      download_size_source: selected.sourceName }, { record: effectiveRecord });
  }

  /**
   * Uninstalls the game files.
   */
  async uninstall(game: CatalogGame): Promise<{ folder?: string }> {
    if (this.options.uninstallHandler) {
      await this.options.uninstallHandler(game);
      return {};
    }
    return digitalDownloadService.uninstall(game);
  }

  /**
   * Opens the game installation folder.
   */
  async openInstallFolder(game: CatalogGame): Promise<void> {
    if (this.options.openFolderHandler) {
      return this.options.openFolderHandler(game);
    }
    await digitalProcessManager.openFolder(game);
  }

  /**
   * Resolves the current download and installation status for the game.
   */
  async getStatus(game: CatalogGame): Promise<ManagedDownloadStatus> {
    const id = game.app_id ?? game.id;
    const active = digitalDownloadService.getManagedStatus(game.id) || digitalDownloadService.getManagedStatus(id);
    if (active && !["installed", "not-installed"].includes(active.state)) return active;
    const status = await digitalProcessManager.status(game);
    return { app_id: id, state: status.installed ? "installed" : "not-installed", progress: status.installed ? 100 : null,
      bytes_downloaded: null, bytes_total: null, installed: Boolean(status.installed),
      needs_repair: Boolean(status.needs_repair), repair_warning: status.needs_repair ? (status.error ?? null) : null };
  }

  private normalizeGames(list: Partial<CatalogGame & DigitalGameRecord>[]): CatalogGame[] {
    return list.map((item, index) => {
      const id = item.id ?? item.app_id ?? (index + 1);
      const appId = item.app_id ?? (typeof id === "number" && id > 0 ? id : null);
      return {
        ...item,
        downloadSource: "", download_size: null, download_size_bytes: null, download_size_source: null,
        id,
        slug: item.slug || `digital-${id}`,
        name: item.name || `Juego ${id}`,
        app_id: appId,
        credit_cost_per_hour: 0,
        copies_total: item.copies_total ?? 1,
        copies_available: item.copies_available ?? 1,
        availability_state: item.availability_state ?? "ready",
        // Artwork URLs come from the catalog, which resolves the real hashed
        // Steam paths once for every client. Deriving a path here produced URLs
        // that answer 404 for most of the catalog, so it is deliberately absent:
        // an unresolved game renders a placeholder instead of failing requests.
        header_image: item.header_image || null,
        capsule_image: item.capsule_image || null,
        hero_image: item.hero_image || null,
        steam_url: item.steam_url || (appId ? `https://store.steampowered.com/app/${appId}/` : null),
        genres: item.genres ?? [],
        categories: item.categories ?? [],
        tags: item.tags ?? [],
        developers: item.developers ?? [],
        publishers: item.publishers ?? [],
        short_description: item.short_description ?? "",
        release_date: item.release_date ?? null,
      };
    });
  }
}

export const digitalCatalogService = new DigitalCatalog();
