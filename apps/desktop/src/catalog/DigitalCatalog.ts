import { applyBundledCatalogArtwork, applyBundledDetails } from "../bundledArtwork";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { normalizeSteamStoreMetadata } from "../steamMetadata";
import type { CatalogGame, GameDetails } from "../types";
import defaultCatalog from "./digital_catalog.json";
import { digitalDownloadService } from "./DigitalDownloadService";
import { digitalProcessManager } from "./DigitalProcessManager";
import { getApiBaseUrl } from "../settings";

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
  async loadCatalog(): Promise<CatalogGame[]> {
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
            }
          }
        } catch {
          // Fall back to local or bundled JSON on network error or test environment.
        }

        if (!Array.isArray(raw) || !raw.length) {
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

      if (!Array.isArray(raw) || !raw.length) {
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
    const finalGames = await applyBundledCatalogArtwork(normalized);
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
          const res = await fetch(`${apiUrl}/games/${game.app_id}/details`);
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
          }
        }
      } catch {
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
  async download(game: CatalogGame): Promise<void> {
    console.log("[DigitalCatalog:download] Starting download for:", { id: game.id, app_id: game.app_id, name: game.name });
    if (this.options.downloadHandler) {
      console.log("[DigitalCatalog:download] Using custom downloadHandler");
      return this.options.downloadHandler(game);
    }
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    console.log("[DigitalCatalog:download] Found local digital record:", record);
    let downloadSource = (record?.downloadSource ?? (game as any).downloadSource ?? (game as any).download_source ?? "").trim();
    console.log("[DigitalCatalog:download] Initial downloadSource:", downloadSource);

    let autoInstalled = record?.auto_installed ?? (game as any).auto_installed ?? false;
    if (!downloadSource || downloadSource === "auto") {
      try {
        const apiUrl = await getApiBaseUrl();
        console.log(`[DigitalCatalog:download] No local downloadSource. Querying API at ${apiUrl}/digital/source/${game.id}...`);
        if (apiUrl) {
          const res = await fetch(`${apiUrl}/digital/source/${game.id}?name=${encodeURIComponent(game.name)}`);
          if (res.ok) {
            const data = await res.json();
            console.log("[DigitalCatalog:download] API source response:", data);
            if (data?.uri) {
              downloadSource = data.uri;
              autoInstalled = data.auto_installed === true;
            }
          } else {
            console.warn(`[DigitalCatalog:download] API returned status ${res.status}`);
          }
        }
      } catch (srcErr) {
        console.warn("[DigitalCatalog:download] Error querying digital source from API:", srcErr);
      }
    }

    if (!downloadSource) {
      const errMsg = `El juego '${game.name}' no tiene fuentes de descarga configuradas.`;
      console.error("[DigitalCatalog:download] Failed: " + errMsg);
      throw new Error(errMsg);
    }

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
