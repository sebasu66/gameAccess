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

export default function DigitalDownloadArtwork({ game }: { game: CatalogGame }) {
  const sources = downloadArtworkCandidates(game);
  return <ArtworkImage key={JSON.stringify([game.id, sources])} sources={sources} />;
}
