import { useState } from "react";
import { Download } from "lucide-react";
import type { CatalogGame } from "./types";

export function downloadArtworkCandidates(game: CatalogGame): string[] {
  const appId = game.app_id;
  const candidates = [
    game.header_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : null,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null,
    game.hero_image,
    game.capsule_image,
  ];
  return [...new Set(candidates.filter((url): url is string => typeof url === "string" && Boolean(url.trim())).map(url => url.trim()))];
}

function ArtworkImage({ sources }: { sources: string[] }) {
  const [index, setIndex] = useState(0);
  const source = sources[index];
  if (!source) return <Download size={28} aria-hidden="true" />;
  return <img key={source} src={source} alt="" draggable={false}
    style={{ objectFit: "contain" }}
    onError={() => setIndex(current => current + 1)} />;
}

/** The wide picture of an active download: the game's hero, the same wide art as the catalog banner (spotlightSlides.ts),
 *  shown whole; the usual candidates follow if a game has none. */
export function DigitalDownloadThumb({ game }: { game: CatalogGame }) {
  const hero = game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/library_hero.jpg` : null;
  const sources = [...new Set([game.hero_image, hero, ...downloadArtworkCandidates(game)].filter((url): url is string => Boolean(url)))];
  return <ArtworkImage key={JSON.stringify([game.id, sources])} sources={sources} />;
}

export default function DigitalDownloadArtwork({ game }: { game: CatalogGame }) {
  const sources = downloadArtworkCandidates(game);
  return <ArtworkImage key={JSON.stringify([game.id, sources])} sources={sources} />;
}
