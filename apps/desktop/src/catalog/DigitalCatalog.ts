import { invoke } from "@tauri-apps/api/core";
import { applyBundledCatalogArtwork, applyBundledDetails } from "../bundledArtwork";
import type { ManagedDownloadStatus } from "../downloadTypes";
import { uninstallGame } from "../gameStorage";
import {
  getSteamStoreMetadata,
  openSteamInstall,
  openSteamRun,
  steamDownloadStatus,
  steamInstalledAppIds,
} from "../native";
import { normalizeSteamStoreMetadata } from "../steamMetadata";
import type { CatalogGame, GameDetails } from "../types";
import defaultCatalog from "./digital_catalog.json";
import { digitalDownloadService } from "./DigitalDownloadService";

export interface DigitalGameRecord {
  name: string;
  id: number;
  downloadSource: string;
  installProcess: string;
  playProcess: string;
  uninstallProcess: string;
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
    if (this.options.catalogLoader) {
      const loaded = await this.options.catalogLoader();
      this.cachedGames = loaded.filter((item) => {
        const record = item as Partial<DigitalGameRecord>;
        if (record.downloadSource !== undefined) {
          return Boolean(record.downloadSource && record.downloadSource.trim());
        }
        return true;
      });
      return this.cachedGames;
    }

    let raw: unknown = null;
    if (typeof window !== "undefined" && typeof fetch !== "undefined") {
      try {
        const response = await fetch("/digital_catalog.json", { cache: "no-store" });
        if (response.ok) {
          raw = await response.json();
        }
      } catch {
        // Fall back to bundled JSON on network error or test environment.
      }
    }

    if (!Array.isArray(raw) || !raw.length) {
      raw = defaultCatalog;
    }

    const rawList = (Array.isArray(raw) ? raw : []) as (Partial<CatalogGame> & Partial<DigitalGameRecord>)[];

    // In Digital mode, games that have no download sources available must not be shown
    // in the digital catalog (they count as invalid records).
    const validRecords = rawList.filter((item) => {
      const source = (item.downloadSource ?? "").trim();
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
          downloadSource: (item.downloadSource ?? "").trim(),
          installProcess: item.installProcess ?? "",
          playProcess: item.playProcess ?? "",
          uninstallProcess: item.uninstallProcess ?? "",
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
        const raw = await getSteamStoreMetadata(game.app_id);
        if (raw) {
          const steam = normalizeSteamStoreMetadata(game, raw);
          return applyBundledDetails({
            ...game,
            steam,
            metadata_state: "steam-store",
          });
        }
      } catch {
        // Continue with local metadata if Steam Store metadata is unavailable
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
    if (!game.app_id) return false;
    try {
      const installedIds = await steamInstalledAppIds();
      return installedIds.includes(game.app_id);
    } catch {
      return false;
    }
  }

  /**
   * Launches or executes the game without GameAccess license reservation.
   */
  async play(game: CatalogGame): Promise<void> {
    if (this.options.playHandler) {
      return this.options.playHandler(game);
    }
    if (!game.app_id) {
      throw new Error(`El juego '${game.name}' no tiene configurado un AppID de Steam para ejecutarse.`);
    }
    await openSteamRun(game.app_id);
  }

  /**
   * Initiates installation or download for the game.
   */
  async download(game: CatalogGame): Promise<void> {
    if (this.options.downloadHandler) {
      return this.options.downloadHandler(game);
    }
    const record = this.getRecord(game.id) || this.getRecord(game.app_id ?? 0);
    const downloadSource = (record?.downloadSource ?? (game as any).downloadSource ?? "").trim();
    if (!downloadSource) {
      throw new Error(`El juego '${game.name}' no tiene fuentes de descarga configuradas.`);
    }
    return digitalDownloadService.start(game, { record });
  }

  /**
   * Uninstalls the game files.
   */
  async uninstall(game: CatalogGame): Promise<void> {
    if (this.options.uninstallHandler) {
      return this.options.uninstallHandler(game);
    }
    if (!game.app_id) {
      throw new Error(`El juego '${game.name}' no tiene configurado un AppID para desinstalar.`);
    }
    await uninstallGame(game.app_id);
  }

  /**
   * Opens the game installation folder.
   */
  async openInstallFolder(game: CatalogGame): Promise<void> {
    if (this.options.openFolderHandler) {
      return this.options.openFolderHandler(game);
    }
    if (!game.app_id) {
      throw new Error(`El juego '${game.name}' no tiene configurado un AppID para abrir la carpeta.`);
    }
    await invoke<string>("open_game_install_folder", { appId: game.app_id });
  }

  /**
   * Resolves the current download and installation status for the game.
   */
  async getStatus(game: CatalogGame): Promise<ManagedDownloadStatus> {
    const active = digitalDownloadService.getManagedStatus(game.id) ||
      (game.app_id ? digitalDownloadService.getManagedStatus(game.app_id) : undefined);
    if (active) {
      return active;
    }

    if (!game.app_id) {
      return {
        app_id: 0,
        state: "not-installed",
        progress: null,
        bytes_downloaded: null,
        bytes_total: null,
        installed: false,
      };
    }

    const installed = await this.isInstalled(game);
    if (installed) {
      return {
        app_id: game.app_id,
        state: "installed",
        progress: 100,
        bytes_downloaded: null,
        bytes_total: null,
        installed: true,
      };
    }

    return steamDownloadStatus(game.app_id);
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
