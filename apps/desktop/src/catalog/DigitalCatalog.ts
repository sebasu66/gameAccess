import { getSteamStoreLanguage } from "../i18n";
import { loadDiscoveryCatalog } from "./DiscoveryCatalog";
import { readCatalogCachedDetail } from "../catalogCache";
import { checkPluginSources, getPluginSources, preparePluginSource, type PluginSource } from "./PluginSources";
export type { PluginSource, PluginManifest } from "./PluginSources";
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
  private cachedGames: CatalogGame[] | null = null;
  private rawRecords = new Map<number, DigitalGameRecord>();

  constructor(private readonly options: DigitalCatalogOptions = {}) {}

  getRecord(gameId: number): DigitalGameRecord | undefined {
    return this.rawRecords.get(gameId);
  }

  /**
   * Loads installer metadata immediately, then refreshes the shared discovery snapshot.
   */
  async loadCatalog({ requireRemote = false }: { requireRemote?: boolean } = {}): Promise<CatalogGame[]> {
    let rawList: (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];

    if (this.options.catalogLoader) {
      const loaded = await this.options.catalogLoader();
      rawList = (Array.isArray(loaded) ? loaded : []) as (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];
    } else {
      const discovery = await loadDiscoveryCatalog(requireRemote);
      let raw: unknown = discovery;
      if (!requireRemote && (!Array.isArray(raw) || !raw.length)) raw = defaultCatalog;

      rawList = (Array.isArray(raw) ? raw : []) as (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];
    }

    // Catalog membership is independent of download availability.
    const validRecords = rawList.filter(item => Number.isSafeInteger(item.id ?? item.app_id) && (item.id ?? item.app_id ?? 0) > 0);
    this.rawRecords.clear();
    const digitalRecords: DigitalGameRecord[] = [];
    for (const item of validRecords) {
      const id = item.id ?? item.app_id;
      if (typeof id === "number") {
        const rec: DigitalGameRecord = {
          name: item.name || `Juego ${id}`,
          id,
          downloadSource: "",
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

    const cached = await readCatalogCachedDetail(game.catalog_cache_id ?? game.id, getSteamStoreLanguage(), "ar").catch(() => null);
    if (cached?.steam) return applyBundledDetails({ ...cached, ...game, steam: cached.steam });

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
  async bulkCheckSources(games: CatalogGame[]): Promise<Record<number, number>> { return checkPluginSources(games); }
  async getSources(game: CatalogGame): Promise<PluginSource[]> { return getPluginSources(game); }

  async download(game: CatalogGame, source?: PluginSource | string): Promise<void> {
    if (this.options.downloadHandler) return this.options.downloadHandler(game);
    const selected = typeof source === "string"
      ? (await this.getSources(game)).find(item => item.url === source)
      : source ?? (await this.getSources(game))[0];
    if (!selected) throw new Error("No se encontró ninguna fuente de descarga activa para este juego.");
    const prepared = await preparePluginSource(selected);
    const record = this.getRecord(game.id);
    const effectiveRecord: DigitalGameRecord = {
      name: game.name, id: game.app_id ?? game.id, downloadSource: prepared.url, sourceDelivery: prepared.delivery,
      installProcess: "", playProcess: record?.playProcess ?? "", uninstallProcess: "", auto_installed: false,
    };
    return digitalDownloadService.start({ ...game, download_size: selected.size, download_size_bytes: null,
      download_size_source: selected.sourceName }, { record: effectiveRecord });
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
        downloadSource: "", download_size: null, download_size_bytes: null, download_size_source: null,
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
