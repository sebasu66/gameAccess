import { useEffect, useRef, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { isPortraitArtwork, libraryArtworkCandidates } from "./libraryArtwork";
import { cachedLibraryCover, resolveLibraryCover } from "./libraryCoverResolver";
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
  const [resolved, setResolved] = useState<string | null>(() => cachedLibraryCover(game.app_id, tier));
  // The resolver answers with the size the grid needs. The catalog capsule is only a fallback, so a card
  // never downloads a fixed-size (or wrong-orientation) image before the resolver has answered.
  const [resolveDone, setResolveDone] = useState(() => Boolean(resolved) || !game.app_id);
  const [candidates] = useState(() => libraryArtworkCandidates(game));
  const sources = resolved ? [resolved, ...candidates] : resolveDone ? candidates : [];
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const attempted = useRef(false);
  const source = sources[sourceIndex];
  useEffect(() => {
    coverStats.cards++;
    debugTrace("COVERS", `app_id=${game.app_id} tier=${tier} candidatos=${candidates.length} conResuelta=${Boolean(resolved)}`);
  }, [game.app_id, candidates.length, resolved, tier]);
  useEffect(() => {
    if (!game.app_id || resolved || attempted.current) return;
    // A ref, not state: setting state here re-ran the effect and its cleanup cancelled the request.
    // Only an unmount (or a tier change) cancels now, which is what a scrolled-past card should do.
    attempted.current = true;
    // Wait a moment before asking: a card that is scrolled past within this time never asks at all.
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      resolveLibraryCover(game.app_id!, tier, controller.signal).then((url) => {
        if (controller.signal.aborted) return;
        if (url) { coverStats.resolvedApi++; setResolved(url); setSourceIndex(0); }
        setResolveDone(true);
      }).catch(() => { if (!controller.signal.aborted) setResolveDone(true); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); attempted.current = false; };
  }, [game.app_id, resolved, tier]);
  if (!source) {
    coverStats.noSource++;
    return <span className="library-cover-fallback"><Gamepad2 size={34} /><span>{game.name}</span></span>;
  }
  const next = () => {
    coverStats.failed++;
    debugTrace("COVERS", `app_id=${game.app_id} candidato ${sourceIndex + 1}/${sources.length} falló`);
    setSourceIndex((current) => current + 1);
  };
  return <img key={source} src={source} alt="" draggable={false} loading="lazy" style={{ visibility: loadedSource === source ? "visible" : "hidden", objectFit: "contain" }} onError={next} onLoad={(event) => {
    const image = event.currentTarget;
    coverStats.probes++;
    const portrait = isPortraitArtwork(image.naturalWidth, image.naturalHeight);
    if (portrait) {
      coverStats.portrait++;
      debugTrace("COVERS", `app_id=${game.app_id} portrait ok ${image.naturalWidth}x${image.naturalHeight} (candidato ${sourceIndex + 1})`);
      setLoadedSource(source);
    } else {
      coverStats.landscape++;
      debugTrace("COVERS", `app_id=${game.app_id} descartada por no ser portrait ${image.naturalWidth}x${image.naturalHeight} (candidato ${sourceIndex + 1})`);
      next();
    }
  }} />;
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
