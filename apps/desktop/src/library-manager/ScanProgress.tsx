import { useEffect, useRef } from "react";
import CircularScrollbar from "../CircularScrollbar";
import type { ImportScanProgress } from "../native";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";
import "./scan-progress.css";

/**
 * The import scan while it runs: a hard disk at work (the platter turns, the head sweeps across it and the activity
 * light blinks), the folder being read now, how many were read, and the games found so far, added to a list that
 * scrolls inside its own height (the dialog does not grow with it) and follows the newest one.
 */
export function ScanProgress({ progress, c }: { progress: ImportScanProgress | null; c: LibraryCopy }) {
  const listRef = useRef<HTMLDivElement>(null);
  const found = progress?.found ?? [];
  // The list follows the newest game unless the player scrolled up to read.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    if (atBottom) list.scrollTop = list.scrollHeight;
  }, [found.length]);
  return (
    <section className="ga-scan" aria-live="polite" aria-label={c.wzScanning}>
      <div className="ga-scan-top">
        <svg className="ga-scan-disk" viewBox="0 0 120 120" aria-hidden="true">
          <rect x="4" y="4" width="112" height="112" rx="10" className="ga-scan-case" />
          <g className="ga-scan-platter">
            <circle cx="56" cy="56" r="44" className="ga-scan-plate" />
            {[0, 1, 2, 3, 4, 5].map(i => <circle key={i} cx="56" cy="56" r={14 + i * 5.4} className="ga-scan-track" />)}
            <path d="M56 12 A44 44 0 0 1 99 49 L56 56 Z" className="ga-scan-sector" />
            <circle cx="56" cy="56" r="8" className="ga-scan-hub" />
          </g>
          <g className="ga-scan-arm">
            <circle cx="102" cy="100" r="7" className="ga-scan-pivot" />
            <path d="M102 100 L64 40" className="ga-scan-rod" />
            <rect x="59" y="35" width="9" height="6" rx="1.5" transform="rotate(-57 63.5 38)" className="ga-scan-head" />
          </g>
          <circle cx="16" cy="104" r="3" className="ga-scan-led" />
        </svg>
        <div className="ga-scan-status">
          <span className="ga-scan-eyebrow">{progress?.folder ? c.wzLiveReading : c.wzLiveStarting}</span>
          {/* Long paths keep their end (the folder's own name), cut at the start. */}
          <p className="ga-scan-folder" title={progress?.folder || undefined}><bdi>{progress?.folder || "…"}</bdi></p>
          <div className="ga-scan-counts">
            <span>{c.wzLiveFolders(progress?.folders ?? 0)}</span>
            <span>{c.wzLiveFound(found.length)}</span>
          </div>
        </div>
      </div>
      <div className="ga-scan-list-frame">
        <div ref={listRef} className="ga-scan-list">
          {found.length ? <ul>
            {found.map(game => (
              <li key={game.path}>
                <b title={game.path}>{game.name}</b>
                <span className="ga-scan-kind">{game.kind === "steam" ? "Steam" : c.wzLiveFolderKind}</span>
                <span className="ga-scan-size">{formatBytes(game.size_bytes)}</span>
              </li>
            ))}
          </ul> : <p className="ga-scan-empty">{c.wzLiveEmpty}</p>}
        </div>
        <CircularScrollbar targetRef={listRef} label={c.wzLiveFound(found.length)} />
      </div>
    </section>
  );
}
