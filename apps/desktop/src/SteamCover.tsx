import { useEffect, useMemo, useRef, useState } from "react";
import { isPortraitArtwork } from "./libraryArtwork";
import { artworkChain, portraitCandidates, rememberedArtwork } from "./gameArtwork";
import { useArtworkChain, WideInPortrait } from "./GameArt";
import { cachedLibraryCover, forgetLibraryCover, resolveLibraryCover } from "./libraryCoverResolver";
import { useCoverTier, type CoverTier } from "./coverSize";
import { debugLog, debugTrace, flushDebugLog } from "./debugLog";
import type { CatalogGame } from "./types";

/**
 * Aggregate cover statistics. Per-image lines would flood the activity log
 * (one IPC write per line), so probes are counted here and a single summary is
 * emitted periodically. `portrait` versus `landscape` tells us how often the
 * card ends up showing an apaisada image inside a portrait frame.
 */
const coverStats = { probes: 0, failed: 0, portrait: 0, landscape: 0, noSource: 0, resolvedApi: 0, cards: 0 };

export function flushCoverDiagnostics(): void {
  if (!coverStats.cards && !coverStats.probes) return;
  const total = coverStats.portrait + coverStats.landscape;
  const ratio = total ? Math.round((coverStats.portrait / total) * 100) : 0;
  debugLog("COVERS", `resumen: tarjetas=${coverStats.cards} probes=${coverStats.probes} fallidos=${coverStats.failed} `
    + `portrait=${coverStats.portrait} landscape=${coverStats.landscape} sinFuente=${coverStats.noSource} `
    + `apiResuelta=${coverStats.resolvedApi} (${ratio}% portrait)`);
  coverStats.probes = 0;
  coverStats.failed = 0;
  coverStats.portrait = 0;
  coverStats.landscape = 0;
  coverStats.noSource = 0;
  coverStats.resolvedApi = 0;
  coverStats.cards = 0;
  flushDebugLog();
}

function CoverBody({ game, tier }: { game: CatalogGame; tier: CoverTier }) {
  const appId = game.app_id ?? null;
  // What loaded last time comes first and needs no resolver; otherwise the resolver's cached answer.
  const [resolved, setResolved] = useState<string | null>(() => rememberedArtwork(appId, "portrait") ?? cachedLibraryCover(appId, tier));
  // The resolver answers with the size the grid needs. The other candidates are only a fallback, so a card
  // never downloads a fixed-size (or wrong-orientation) image before the resolver has answered.
  const [resolveDone, setResolveDone] = useState(() => Boolean(resolved) || !appId);
  const [candidates] = useState(() => portraitCandidates(game, tier));
  const sources = useMemo(() => !resolveDone && !resolved ? [] : artworkChain(appId, "portrait", resolved ? [resolved, ...candidates] : candidates),
    [appId, candidates, resolveDone, resolved]);
  const chain = useArtworkChain(appId, "portrait", sources, (width, height) => {
    const portrait = isPortraitArtwork(width, height);
    coverStats.probes++;
    if (portrait) coverStats.portrait++; else coverStats.landscape++;
    return portrait;
  }, (url) => {
    coverStats.failed++;
    debugTrace("COVERS", `app_id=${appId} falló ${url}`);
    // A resolved path that stopped loading (Steam moved the art to a new hash) is asked again next time.
    if (appId && url === resolved) forgetLibraryCover(appId, tier);
  });
  const attempted = useRef(false);
  useEffect(() => {
    coverStats.cards++;
    debugTrace("COVERS", `app_id=${appId} tier=${tier} candidatos=${candidates.length} conResuelta=${Boolean(resolved)}`);
  }, [appId, candidates.length, resolved, tier]);
  useEffect(() => {
    if (!appId || resolved || attempted.current) return;
    // A ref, not state: setting state here re-ran the effect and its cleanup cancelled the request.
    // Only an unmount (or a tier change) cancels now, which is what a scrolled-past card should do.
    attempted.current = true;
    // Wait a moment before asking: a card that is scrolled past within this time never asks at all.
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      resolveLibraryCover(appId, tier, controller.signal).then((url) => {
        if (controller.signal.aborted) return;
        if (url) { coverStats.resolvedApi++; setResolved(url); }
        setResolveDone(true);
      }).catch(() => { if (!controller.signal.aborted) setResolveDone(true); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); attempted.current = false; };
  }, [appId, resolved, tier]);
  // Still asking: the card keeps its own background, without a placeholder that would flash.
  if (!resolveDone && !resolved) return null;
  if (chain.exhausted) {
    coverStats.noSource++;
    // No portrait anywhere: the wide picture whole, then the title over a background.
    return <WideInPortrait game={game} />;
  }
  return <img key={chain.source} src={chain.source!} alt="" draggable={false} loading="lazy" style={{ visibility: chain.loaded ? "visible" : "hidden", objectFit: "contain" }}
    onError={chain.onError} onLoad={chain.onLoad} />;
}

/** Remounts the cover body when the grid zoom moves it to another size tier. */
function CoverImage({ game }: { game: CatalogGame }) {
  const tier = useCoverTier();
  return <CoverBody key={tier} game={game} tier={tier} />;
}

export default function SteamCover({ game }: { game: CatalogGame }) {
  return <CoverImage key={game.app_id ?? game.id} game={game} />;
}

/** Emits the aggregate cover summary while diagnostics are on. */
export function useCoverDiagnostics(): void {
  useEffect(() => {
    const timer = setInterval(flushCoverDiagnostics, 5000);
    return () => {
      clearInterval(timer);
      flushCoverDiagnostics();
    };
  }, []);
}
