import { useState } from "react";
import { Gamepad2 } from "lucide-react";
import { isPortraitArtwork, libraryArtworkCandidates } from "./libraryArtwork";
import type { CatalogGame } from "./types";

function CoverImage({ game }: { game: CatalogGame }) {
  const sources = libraryArtworkCandidates(game);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const source = sources[sourceIndex];
  if (!source) return <span className="library-cover-fallback"><Gamepad2 size={34} /><span>{game.name}</span></span>;
  const next = () => setSourceIndex((current) => current + 1);
  return <img key={source} src={source} alt="" draggable={false} loading="lazy" style={{ visibility: loadedSource === source ? "visible" : "hidden", objectFit: "contain" }} onError={next} onLoad={(event) => {
    const image = event.currentTarget;
    if (isPortraitArtwork(image.naturalWidth, image.naturalHeight)) setLoadedSource(source);
    else next();
  }} />;
}

export default function SteamCover({ game }: { game: CatalogGame }) {
  return <CoverImage key={`${game.id}:${game.app_id}:${game.capsule_image}`} game={game} />;
}
