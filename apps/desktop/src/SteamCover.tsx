import { useEffect, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { isPortraitArtwork, libraryArtworkCandidates } from "./libraryArtwork";
import { cachedLibraryCover, resolveLibraryCover } from "./libraryCoverResolver";
import type { CatalogGame } from "./types";

function CoverImage({ game }: { game: CatalogGame }) {
  const [resolved, setResolved] = useState<string | null>(() => cachedLibraryCover(game.app_id));
  const [candidates] = useState(() => libraryArtworkCandidates(game));
  const sources = [...(resolved ? [resolved] : []), ...candidates];
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const source = sources[sourceIndex];
  useEffect(() => {
    if (source || !game.app_id || resolved) return;
    let cancelled = false;
    void resolveLibraryCover(game.app_id).then((url) => {
      if (!cancelled && url) { setResolved(url); setSourceIndex(0); }
    });
    return () => { cancelled = true; };
  }, [source, game.app_id, resolved]);
  if (!source) return <span className="library-cover-fallback"><Gamepad2 size={34} /><span>{game.name}</span></span>;
  const next = () => setSourceIndex((current) => current + 1);
  return <img key={source} src={source} alt="" draggable={false} loading="lazy" style={{ visibility: loadedSource === source ? "visible" : "hidden", objectFit: "contain" }} onError={next} onLoad={(event) => {
    const image = event.currentTarget;
    if (isPortraitArtwork(image.naturalWidth, image.naturalHeight)) setLoadedSource(source);
    else next();
  }} />;
}

export default function SteamCover({ game }: { game: CatalogGame }) {
  return <CoverImage key={game.app_id ?? game.id} game={game} />;
}
