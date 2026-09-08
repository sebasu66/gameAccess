import type { CatalogGame, SteamMetadata, SteamMovie, SteamScreenshot } from "./types";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const optionalString = (value: unknown) => String(value || "") || undefined;
const optionalNumber = (value: unknown) => Number(value) || undefined;

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function descriptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(record(item).description || "")).filter(Boolean);
}

function screenshots(value: unknown): SteamScreenshot[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const shot = record(item);
    return {
      id: optionalNumber(shot.id),
      thumbnail: optionalString(shot.path_thumbnail),
      full: optionalString(shot.path_full),
    };
  });
}

function movies(value: unknown): SteamMovie[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const movie = record(item);
    const mp4 = record(movie.mp4);
    const webm = record(movie.webm);
    return {
      id: optionalNumber(movie.id),
      name: optionalString(movie.name),
      thumbnail: optionalString(movie.thumbnail),
      mp4: optionalString(mp4.max || mp4["480"]),
      webm: optionalString(webm.max || webm["480"]),
      highlight: Boolean(movie.highlight),
    };
  });
}

function priceOverview(value: unknown): SteamMetadata["price"] {
  const price = record(value);
  if (!Object.keys(price).length) return null;
  return {
    currency: optionalString(price.currency),
    initial: optionalNumber(price.initial),
    final: optionalNumber(price.final),
    discount_percent: Number(price.discount_percent) || 0,
    initial_formatted: optionalString(price.initial_formatted),
    final_formatted: optionalString(price.final_formatted),
  };
}

function metacriticOverview(value: unknown): SteamMetadata["metacritic"] {
  const metacritic = record(value);
  if (!metacritic.score) return null;
  return { score: Number(metacritic.score), url: optionalString(metacritic.url) };
}

export function normalizeSteamStoreMetadata(game: CatalogGame, raw: Record<string, unknown>): SteamMetadata {
  const data = record(raw);
  const release = record(data.release_date);
  const requirements = record(data.pc_requirements);
  const platforms = record(data.platforms);
  const recommendations = record(data.recommendations);
  const achievements = record(data.achievements);

  return {
    app_id: game.app_id ?? (Number(data.steam_appid) || 0),
    name: String(data.name || game.name),
    short_description: optionalString(data.short_description),
    about_the_game: optionalString(data.about_the_game),
    detailed_description: optionalString(data.detailed_description),
    developers: stringList(data.developers),
    publishers: stringList(data.publishers),
    genres: descriptions(data.genres),
    categories: descriptions(data.categories),
    supported_languages: optionalString(data.supported_languages),
    release_date: optionalString(release.date),
    coming_soon: Boolean(release.coming_soon),
    required_age: data.required_age as number | string | undefined,
    metacritic: metacriticOverview(data.metacritic),
    recommendation_count: optionalNumber(recommendations.total),
    achievement_count: optionalNumber(achievements.total),
    price: priceOverview(data.price_overview),
    is_free: Boolean(data.is_free),
    windows: Boolean(platforms.windows),
    mac: Boolean(platforms.mac),
    linux: Boolean(platforms.linux),
    minimum_requirements: optionalString(requirements.minimum),
    recommended_requirements: optionalString(requirements.recommended),
    screenshots: screenshots(data.screenshots),
    movies: movies(data.movies),
    header_image: optionalString(data.header_image || game.header_image),
    capsule_image: game.capsule_image ?? undefined,
    hero_image: optionalString(data.background_raw || data.background || game.hero_image),
    background: optionalString(data.background_raw || data.background || game.hero_image),
    steam_url: game.steam_url ?? undefined,
    source: "steam-store",
  };
}
