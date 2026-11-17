import type { CatalogGame, GameDetails, SteamMetadata } from "./types";

export interface BundledScreenshot {
  id?: number;
  thumbnail?: string;
  full?: string;
}

export interface BundledGameArtwork {
  header_image?: string;
  capsule_image?: string;
  hero_image?: string;
  background?: string;
  screenshots?: BundledScreenshot[];
  url_map?: Record<string, string>;
}

export interface BundledArtworkManifest {
  version: number;
  generated_at_utc?: string;
  catalog_sha256?: string;
  game_count?: number;
  image_count?: number;
  games: Record<string, BundledGameArtwork>;
}

let manifestPromise: Promise<BundledArtworkManifest | null> | null = null;

function normalizeLocalPath(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/")) return value;
  return `/game-assets/${value.replace(/^\.?\//, "")}`;
}

function normalizeEntry(entry: BundledGameArtwork): BundledGameArtwork {
  return {
    ...entry,
    header_image: normalizeLocalPath(entry.header_image),
    capsule_image: normalizeLocalPath(entry.capsule_image),
    hero_image: normalizeLocalPath(entry.hero_image),
    background: normalizeLocalPath(entry.background),
    screenshots: entry.screenshots?.map((shot) => ({
      ...shot,
      thumbnail: normalizeLocalPath(shot.thumbnail),
      full: normalizeLocalPath(shot.full),
    })),
    url_map: entry.url_map
      ? Object.fromEntries(
          Object.entries(entry.url_map).map(([remote, local]) => [remote, normalizeLocalPath(local) ?? local]),
        )
      : undefined,
  };
}

export async function loadBundledArtworkManifest(): Promise<BundledArtworkManifest | null> {
  manifestPromise ??= fetch("/game-assets/manifest.json", { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) return null;
      const value = await response.json() as BundledArtworkManifest;
      if (!value || value.version !== 1 || !value.games || typeof value.games !== "object") return null;
      return {
        ...value,
        games: Object.fromEntries(
          Object.entries(value.games).map(([appId, entry]) => [appId, normalizeEntry(entry)]),
        ),
      };
    })
    .catch(() => null);
  return manifestPromise;
}

export function resetBundledArtworkManifestForTests(): void {
  manifestPromise = null;
}

function entryFor(manifest: BundledArtworkManifest | null, appId?: number | null): BundledGameArtwork | undefined {
  if (!manifest || !appId) return undefined;
  return manifest.games[String(appId)];
}

function rewriteHtml(value: string | undefined, replacements?: Record<string, string>): string | undefined {
  if (!value || !replacements) return value;
  let rewritten = value;
  for (const [remote, local] of Object.entries(replacements)) {
    if (!remote || !local || !rewritten.includes(remote)) continue;
    rewritten = rewritten.split(remote).join(local);
  }
  return rewritten;
}

export function applyBundledCatalogArtworkFromManifest(
  game: CatalogGame,
  manifest: BundledArtworkManifest | null,
): CatalogGame {
  const entry = entryFor(manifest, game.app_id);
  if (!entry) return game;
  return {
    ...game,
    header_image: entry.header_image ?? game.header_image,
    capsule_image: entry.capsule_image ?? game.capsule_image,
    hero_image: entry.hero_image ?? game.hero_image,
  };
}

export function applyBundledDetailsFromManifest(
  details: GameDetails,
  manifest: BundledArtworkManifest | null,
): GameDetails {
  const entry = entryFor(manifest, details.app_id);
  if (!entry) return details;

  const steam: SteamMetadata | null = details.steam
    ? {
        ...details.steam,
        header_image: entry.header_image ?? details.steam.header_image,
        capsule_image: entry.capsule_image ?? details.steam.capsule_image,
        hero_image: entry.hero_image ?? details.steam.hero_image,
        background: entry.background ?? details.steam.background,
        screenshots: entry.screenshots?.length ? entry.screenshots : details.steam.screenshots,
        about_the_game: rewriteHtml(details.steam.about_the_game, entry.url_map),
        detailed_description: rewriteHtml(details.steam.detailed_description, entry.url_map),
        minimum_requirements: rewriteHtml(details.steam.minimum_requirements, entry.url_map),
        recommended_requirements: rewriteHtml(details.steam.recommended_requirements, entry.url_map),
      }
    : details.steam;

  return {
    ...details,
    header_image: entry.header_image ?? details.header_image,
    capsule_image: entry.capsule_image ?? details.capsule_image,
    hero_image: entry.hero_image ?? details.hero_image,
    steam,
  };
}

export async function applyBundledCatalogArtwork(games: CatalogGame[]): Promise<CatalogGame[]> {
  const manifest = await loadBundledArtworkManifest();
  if (!manifest) return games;
  return games.map((game) => applyBundledCatalogArtworkFromManifest(game, manifest));
}

export async function applyBundledDetails(details: GameDetails): Promise<GameDetails> {
  const manifest = await loadBundledArtworkManifest();
  return applyBundledDetailsFromManifest(details, manifest);
}
