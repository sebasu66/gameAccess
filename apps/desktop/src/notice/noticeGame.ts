import type { CatalogGame } from "../types";
import type { NoticeGame } from "./notice";

/** The game as the notice shows it: its name and the portrait cover (Steam library art first). */
export function noticeGame(game: Pick<CatalogGame, "name" | "app_id" | "capsule_image" | "header_image">): NoticeGame {
  const portrait = game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/library_600x900.jpg` : null;
  return { name: game.name, image: portrait ?? game.capsule_image ?? game.header_image ?? null };
}
