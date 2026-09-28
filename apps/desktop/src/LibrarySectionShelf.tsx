import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { SECTION_PREVIEW_SIZE } from "./librarySections";
import { narrate } from "./narrationLog";
import type { LibrarySection } from "./librarySections";
import type { CatalogGame } from "./types";

interface Props {
  section: LibrarySection;
  selectedId?: number;
  renderGame: (game: CatalogGame) => ReactNode;
  reset: number;
  scrollRoot: RefObject<HTMLDivElement>;
}

export default function LibrarySectionShelf({ section, selectedId, renderGame, reset, scrollRoot }: Props) {
  const [visibleCount, setVisibleCount] = useState(SECTION_PREVIEW_SIZE);
  const [batchSize, setBatchSize] = useState(SECTION_PREVIEW_SIZE);
  const previousVisibleCountRef = useRef(SECTION_PREVIEW_SIZE);
  const rootRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The toolbar reset token intentionally restores this shelf preview.
  useEffect(() => { setVisibleCount(SECTION_PREVIEW_SIZE); }, [reset]);

  useEffect(() => {
    const root = scrollRoot.current;
    const grid = rootRef.current?.querySelector<HTMLElement>(".library-section-grid");
    if (!root || !grid) return;

    const measure = () => {
      const firstCard = grid.querySelector<HTMLElement>(".library-room-card");
      if (!firstCard) return;
      const cardRect = firstCard.getBoundingClientRect();
      const style = getComputedStyle(grid);
      const columnGap = Number.parseFloat(style.columnGap) || 0;
      const rowGap = Number.parseFloat(style.rowGap) || 0;
      const columns = Math.max(1, Math.floor((grid.clientWidth + columnGap) / (cardRect.width + columnGap)));
      const rowHeight = Math.max(1, cardRect.height + rowGap);
      const visibleRowsWithBuffer = Math.max(2, Math.ceil((root.clientHeight * 1.5) / rowHeight));
      const nextBatchSize = columns * visibleRowsWithBuffer;
      setBatchSize(nextBatchSize);
      setVisibleCount(current => Math.min(section.games.length, Math.max(current, nextBatchSize)));
    };

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    resizeObserver.observe(grid);
    measure();
    return () => resizeObserver.disconnect();
  }, [reset, scrollRoot, section.games.length]);

  const selectedPosition = section.games.findIndex(game => game.id === selectedId);
  useEffect(() => {
    if (selectedPosition >= 0) {
      setVisibleCount(current => Math.max(current, Math.min(section.games.length, selectedPosition + 1)));
    }
  }, [selectedPosition, section.games.length]);

  useEffect(() => {
    const root = scrollRoot.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || visibleCount >= section.games.length) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(section.games.length);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleCount(current => Math.min(section.games.length, current + batchSize));
      }
    }, { root, rootMargin: `${Math.min(800, Math.max(240, Math.round(root.clientHeight * 0.9)))}px 0px` });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRoot, section.games.length, visibleCount, batchSize]);

  const visibleGames = section.games.slice(0, visibleCount);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keep keyboard selection visible after more cards render.
  useEffect(() => {
    const selected = rootRef.current?.querySelector<HTMLElement>(".is-selected");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedId, visibleCount]);

  useEffect(() => {
    const previous = previousVisibleCountRef.current;
    previousVisibleCountRef.current = visibleCount;
    if (visibleCount > previous) {
      void narrate(`Infinite scroll loaded ${visibleCount - previous} more ${section.id} game card(s); ${visibleCount}/${section.games.length} are visible.`, { area: "CATALOG" });
    }
  }, [section.games.length, section.id, visibleCount]);

  return <section ref={rootRef} className="library-section" aria-label={section.title}>
    <header className="library-section-heading">
      <div>
        <h2>{section.title} <small>{section.games.length}</small></h2>
        {section.description ? <span>{section.description}</span> : section.id === "installed" ? <span>Últimos jugados primero</span> : null}
      </div>
    </header>
    <div id={`section-${section.id}`} className="library-section-grid">{visibleGames.map(renderGame)}</div>
    {!section.games.length ? <p className="library-section-empty">{section.emptyMessage ?? "No hay juegos en esta vista."}</p> : null}
    {visibleCount < section.games.length ? <div ref={sentinelRef} className="library-section-sentinel" aria-hidden="true" /> : null}
  </section>;
}
