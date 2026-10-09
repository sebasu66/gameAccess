import { invoke } from "@tauri-apps/api/core";
import { applyBundledCatalogArtwork, applyBundledDetails } from "../bundledArtwork";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { normalizeSteamStoreMetadata } from "../steamMetadata";
import { applySteamCatalogMetadata, cachedSteamCatalogMetadata } from "../useSteamMetadataWorker";
import type { CatalogGame, GameDetails } from "../types";
import defaultCatalog from "./digital_catalog.json";
import { digitalDownloadService } from "./DigitalDownloadService";
import { digitalProcessManager } from "./DigitalProcessManager";
import { getApiBaseUrl } from "../settings";
import { activationHeaders, invalidateActivation } from "../activation";



export interface PluginSource {
  title: string;
  url: string;
  type: string;
  size: string;
  score: number;
  pluginName?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  endpoint: string;
  type: string;
}

export interface DigitalGameRecord {
  name: string;
  id: number;
  downloadSource: string;
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
  private cachedGames: CatalogGame[] | null = null;
  private rawRecords = new Map<number, DigitalGameRecord>();

  constructor(private readonly options: DigitalCatalogOptions = {}) {}

  getRecord(gameId: number): DigitalGameRecord | undefined {
    return this.rawRecords.get(gameId);
  }

  /**
   * Loads games from the JSON catalog file.
   */
  async loadCatalog({ requireRemote = false }: { requireRemote?: boolean } = {}): Promise<CatalogGame[]> {
    let rawList: (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];

    if (this.options.catalogLoader) {
      const loaded = await this.options.catalogLoader();
      rawList = (Array.isArray(loaded) ? loaded : []) as (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];
    } else {
      let raw: unknown = null;
      if (typeof window !== "undefined" && typeof fetch !== "undefined") {
        try {
          const apiUrl = await getApiBaseUrl();
          if (apiUrl) {
            const response = await fetch(`${apiUrl}/digital/catalog`, { cache: "no-store" });
            if (response.ok) {
              raw = await response.json();
            } else if (requireRemote) {
              throw new Error(`No pudimos actualizar el catálogo (${response.status}).`);
            }
          }
        } catch (error) {
          if (requireRemote) throw error;
          // Fall back to local or bundled JSON on network error or test environment.
        }

        // Background refreshes must never replace a live catalog with a bundled
        // fallback, or mistake those fallback entries for newly added games.
        if (requireRemote && !Array.isArray(raw)) throw new Error("El catálogo remoto no está disponible.");
        if (!requireRemote && (!Array.isArray(raw) || !raw.length)) {
          try {
            const response = await fetch("/digital_catalog.json", { cache: "no-store" });
            if (response.ok) {
              raw = await response.json();
            }
          } catch {
            // Fall back to bundled JSON on network error or test environment.
          }
        }
      }

      if (requireRemote && !Array.isArray(raw)) throw new Error("El catálogo remoto no está disponible.");
      if (!requireRemote && (!Array.isArray(raw) || !raw.length)) {
        raw = defaultCatalog;
      }

      rawList = (Array.isArray(raw) ? raw : []) as (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];
    }

    // In Digital mode, games that have no download sources available must not be shown
    // in the digital catalog (they count as invalid records).
    const validRecords = rawList.filter((item) => {
      const source = (item.downloadSource ?? (item as any).download_source ?? "").trim();
      return Boolean(source);
    });

    this.rawRecords.clear();
    const digitalRecords: DigitalGameRecord[] = [];
    for (const item of validRecords) {
      const id = item.id ?? item.app_id;
      if (typeof id === "number") {
        const rec: DigitalGameRecord = {
          name: item.name || `Juego ${id}`,
          id,
          downloadSource: (item.downloadSource ?? (item as any).download_source ?? "").trim(),
          installProcess: item.installProcess ?? (item as any).install_process ?? "",
          playProcess: item.playProcess ?? (item as any).play_process ?? "",
          uninstallProcess: item.uninstallProcess ?? (item as any).uninstall_process ?? "",
          auto_installed: item.auto_installed === true,
        };
        this.rawRecords.set(id, rec);
        digitalRecords.push(rec);
      }
    }
    digitalDownloadService.registerRecords(digitalRecords);

    const normalized = this.normalizeGames(validRecords);
    const metadata = await cachedSteamCatalogMetadata(normalized.flatMap(game => game.app_id ? [game.app_id] : []));
    const finalGames = await applyBundledCatalogArtwork(applySteamCatalogMetadata(normalized, metadata));
    this.cachedGames = finalGames;
    return finalGames;
  }

  /**
   * Retrieves game details in the standard GameDetails format,
   * enriched with Steam Store metadata if available.
   */
  async loadDetails(gameId: number): Promise<GameDetails> {
    const games = this.cachedGames ?? (await this.loadCatalog());
    const game = games.find((item) => item.id === gameId || item.app_id === gameId);
    if (!game) throw new Error("Juego no encontrado en el catálogo Digital");

    if (game.app_id) {
      try {
        const apiUrl = await getApiBaseUrl();
        if (apiUrl) {
          const res = await fetch(`${apiUrl}/digital/games/${game.app_id}/details`, {
            headers: activationHeaders()
          });
          if (res.ok) {
            const serverData = await res.json();
            if (serverData && serverData.steam) {
              const steam = normalizeSteamStoreMetadata(game, serverData.steam);
              return applyBundledDetails({
                ...game,
                steam,
                metadata_state: serverData.metadata_state || "ready",
              });
            }
          } else if (res.status === 401) {
            invalidateActivation();
            throw new Error("Tu tiempo de acceso terminó. Ingresa una nueva llave para continuar.");
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("tiempo de acceso")) throw e;
        // Continue to fallback
      }
    }

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
    await digitalDownloadService.play(game);
  }

  /**
   * Initiates installation or download for the game.
   */
  async bulkCheckSources(games: CatalogGame[]): Promise<Record<number, number>> {
    const results: Record<number, number> = {};
    
    

    try {
      const plugins = await invoke<PluginManifest[]>("get_registered_plugins");
      
      const payload = games.map(g => ({ id: g.app_id ?? g.id, name: g.name }));
      
      const promises = plugins.map(async (plugin) => {
        if (plugin.type === "source_provider") {
          try {
            const res = await fetch(`${plugin.endpoint}/api/bulk_check`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ games: payload }),
              signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
              const pluginResults = await res.json() as Record<number, number>;
              for (const [appId, count] of Object.entries(pluginResults)) {
                results[Number(appId)] = (results[Number(appId)] || 0) + count;
              }
            }
          } catch (err) {
            console.warn(`[DigitalCatalog:bulkCheckSources] Plugin ${plugin.name} error:`, err);
          }
        }
      });
      await Promise.all(promises);
    } catch (e) {
      console.warn("[DigitalCatalog:bulkCheckSources] Failed to check plugins", e);
    }
    
    return results;
  }

  async getSources(game: CatalogGame) {
    let allSources: any[] = [];

    

    try {
      const plugins = await invoke<PluginManifest[]>("get_registered_plugins");
      
      const sourcePromises = plugins.map(async (plugin) => {
        if (plugin.type === "source_provider") {
          try {
            const res = await fetch(`${plugin.endpoint}/api/sources?app_id=${game.id}&name=${encodeURIComponent(game.name)}`, { signal: AbortSignal.timeout(4000) });
            if (res.ok) {
              const data = await res.json() as PluginSource[];
              return data.map(s => ({ ...s, pluginName: plugin.name }));
            }
          } catch (err) {
            console.warn(`[DigitalCatalog:getSources] Plugin ${plugin.name} error:`, err);
          }
        }
        return [];
      });

      const results = await Promise.all(sourcePromises);
      for (const res of results) {
        allSources = allSources.concat(res);
      }
      
      // Sort by score
      allSources.sort((a, b) => b.score - a.score);

    } catch (e) {
      console.warn("[DigitalCatalog:getSources] Failed to check plugins", e);
    }
    return allSources;
  }

  async download(game: CatalogGame, sourceUrl?: string): Promise<void> {
    console.log("[DigitalCatalog:download] Starting download for:", { id: game.id, app_id: game.app_id, name: game.name, sourceUrl });
    if (this.options.downloadHandler) {
      console.log("[DigitalCatalog:download] Using custom downloadHandler");
      return this.options.downloadHandler(game);
    }
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    
    let finalSourceUrl = sourceUrl;
    let autoInstalled = record?.auto_installed ?? (game as any).auto_installed ?? false;

    // Check fixed override
    const fixedOverride = (record?.downloadSource ?? (game as any).downloadSource ?? (game as any).download_source ?? "").trim();
    if (!finalSourceUrl && fixedOverride && fixedOverride !== "auto" && !fixedOverride.includes("127.0.0.1")) {
      finalSourceUrl = fixedOverride;
    }

    if (!finalSourceUrl) {
      const sources = await this.getSources(game);
      if (sources.length > 0) {
        finalSourceUrl = sources[0].url;
        autoInstalled = false;
      }
    }

    if (!finalSourceUrl) {
      throw new Error("No se encontró ninguna fuente de descarga activa para este juego.");
    }

    let downloadSource = finalSourceUrl;

    const effectiveRecord: DigitalGameRecord = {
      ...(record || {
        name: game.name,
        id: game.id,
        installProcess: "",
        playProcess: "",
        uninstallProcess: "",
      }),
      downloadSource,
      auto_installed: autoInstalled,
    };
    console.log("[DigitalCatalog:download] Calling digitalDownloadService.start with record:", effectiveRecord);
    return digitalDownloadService.start(game, { record: effectiveRecord });
  }

  /**
   * Uninstalls the game files.
   */
  async uninstall(game: CatalogGame): Promise<void> {
    if (this.options.uninstallHandler) {
      return this.options.uninstallHandler(game);
    }
    await digitalDownloadService.uninstall(game);
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
      bytes_downloaded: null, bytes_total: null, installed: Boolean(status.installed) };
  }

  private normalizeGames(list: Partial<CatalogGame & DigitalGameRecord>[]): CatalogGame[] {
    return list.map((item, index) => {
      const id = item.id ?? item.app_id ?? (index + 1);
      const appId = item.app_id ?? (typeof id === "number" && id > 0 ? id : null);
      return {
        ...item,
        id,
        slug: item.slug || `digital-${id}`,
        name: item.name || `Juego ${id}`,
        app_id: appId,
        credit_cost_per_hour: 0,
        copies_total: item.copies_total ?? 1,
        copies_available: item.copies_available ?? 1,
        availability_state: item.availability_state ?? "ready",
        header_image: item.header_image || (appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null),
        capsule_image: item.capsule_image || (appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg` : null),
        hero_image: item.hero_image || (appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg` : null),
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
