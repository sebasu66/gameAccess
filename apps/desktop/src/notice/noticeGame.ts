import { rememberedArtwork } from "../gameArtwork";
import { cachedLibraryCover } from "../libraryCoverResolver";
import type { CatalogGame } from "../types";
import type { NoticeGame } from "./notice";

/** The game as the notice shows it: its name and the portrait cover (what the grids already resolved or saw load first;
 *  the notice repairs a broken one itself, GameThumb). */
export function noticeGame(game: Pick<CatalogGame, "name" | "app_id" | "capsule_image" | "header_image">): NoticeGame {
  const portrait = game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/library_600x900.jpg` : null;
  const known = rememberedArtwork(game.app_id, "portrait") ?? cachedLibraryCover(game.app_id, "1x") ?? cachedLibraryCover(game.app_id, "2x");
  return { name: game.name, image: known ?? portrait ?? game.capsule_image ?? game.header_image ?? null, appId: game.app_id ?? null };
}
