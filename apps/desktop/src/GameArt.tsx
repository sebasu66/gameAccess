import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import "./game-art.css";
import { artworkChain, artworkMonogram, isUsableArtwork, markArtworkBroken, rememberArtwork, wideCandidates, type ArtKind } from "./gameArtwork";
import { forgetLibraryCover, resolveLibraryCover } from "./libraryCoverResolver";
import type { CatalogGame } from "./types";

type WideGame = Partial<Pick<CatalogGame, "app_id" | "header_image" | "capsule_image" | "hero_image">> & { name: string };

/**
 * Walks a chain of artwork URLs: a URL that errors, decodes to 0x0 or to Steam's tiny placeholder, or that `accept`
 * refuses (a landscape image for a portrait card) is marked broken and the next one is tried; the one that loads
 * is remembered for the game. `exhausted` tells the caller to draw its fallback.
 */
export function useArtworkChain(appId: number | null | undefined, kind: ArtKind, sources: string[], accept?: (width: number, height: number) => boolean, onBroken?: (url: string) => void) {
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const source = sources.find(url => !failed.includes(url)) ?? null;
  const fail = (url: string) => {
    // Offline every image fails: that says nothing about the URL, so nothing is remembered as broken.
    if (typeof navigator === "undefined" || navigator.onLine !== false) markArtworkBroken(url, appId, kind);
    onBroken?.(url);
    setFailed(current => current.includes(url) ? current : [...current, url]);
  };
  return {
    source,
    loaded: Boolean(source) && loaded === source,
    exhausted: !source,
    onError: () => { if (source) fail(source); },
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
      if (!source) return;
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
      if (!isUsableArtwork(width, height) || (accept && !accept(width, height))) return fail(source);
      rememberArtwork(appId, kind, source);
      setLoaded(source);
    },
  };
}

/**
 * The wide chain: the catalog's header and Steam's unhashed paths first, and only when all of them failed, the
 * hashed header from the store API (recent games publish nothing else). The API is asked once per card.
 */
export function useWideArtwork(game: WideGame) {
  const appId = game.app_id ?? null;
  const [candidates] = useState(() => artworkChain(appId, "wide", wideCandidates(game)));
  const [resolved, setResolved] = useState<string | null>(null);
  const [lookup, setLookup] = useState<"idle" | "asking" | "done">("idle");
  const sources = useMemo(() => resolved ? [...candidates, resolved] : candidates, [candidates, resolved]);
  const chain = useArtworkChain(appId, "wide", sources, undefined, url => { if (appId && url === resolved) forgetLibraryCover(appId, "wide"); });
  // Once per card. The request is only cancelled when the card unmounts (scrolled past), not by its own state change.
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!chain.exhausted || lookup !== "idle" || !appId) return;
    setLookup("asking");
    const current = controller.current = new AbortController();
    const finish = (url: string | null) => {
      if (current.signal.aborted) return;
      if (url && !candidates.includes(url)) setResolved(url);
      setLookup("done");
    };
    void resolveLibraryCover(appId, "wide", current.signal).then(finish, () => finish(null));
  }, [chain.exhausted, lookup, appId, candidates]);
  // While Steam is asked, the card keeps its own background: the title would only flash before the picture.
  return { ...chain, waiting: chain.exhausted && Boolean(appId) && lookup !== "done" };
}

/** The last resort: the title over a background, never a hole or a broken image. `compact` shows two letters. */
export function ArtworkFallback({ name, compact, className }: { name: string; compact?: boolean; className?: string }) {
  return <span className={`ga-art-fallback${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`} title={compact ? name : undefined} aria-hidden="true">
    <span>{compact ? artworkMonogram(name) : name}</span>
  </span>;
}

/** A wide picture for landscape grids (library manager, kid mode, bento wide cards) with its own repair chain. */
export function GameWideArt({ game, className, compact, lazy = true }: { game: WideGame; className?: string; compact?: boolean; lazy?: boolean }) {
  return <WideArtBody key={game.app_id ?? game.name} game={game} className={className} compact={compact} lazy={lazy} />;
}

function WideArtBody({ game, className, compact, lazy }: { game: WideGame; className?: string; compact?: boolean; lazy: boolean }) {
  const art = useWideArtwork(game);
  if (art.exhausted) return art.waiting ? null : <ArtworkFallback name={game.name} compact={compact} className={className} />;
  return <img key={art.source} className={className} src={art.source!} alt="" draggable={false} loading={lazy ? "lazy" : undefined}
    style={{ visibility: art.loaded ? "visible" : "hidden" }} onError={art.onError} onLoad={art.onLoad} />;
}

/**
 * A portrait card whose game has no portrait art: the wide picture whole, over a blurred copy of itself, with the
 * title under it. When even the wide chain fails, the title fallback.
 */
export function WideInPortrait({ game }: { game: WideGame }) {
  const art = useWideArtwork(game);
  if (art.exhausted) return art.waiting ? null : <ArtworkFallback name={game.name} />;
  return <span className="ga-art-composed" data-loaded={art.loaded || undefined}>
    <img className="ga-art-composed-backdrop" src={art.source!} alt="" aria-hidden="true" draggable={false} />
    <img key={art.source} className="ga-art-composed-image" src={art.source!} alt="" draggable={false} onError={art.onError} onLoad={art.onLoad} />
    <span className="ga-art-composed-title">{game.name}</span>
  </span>;
}
