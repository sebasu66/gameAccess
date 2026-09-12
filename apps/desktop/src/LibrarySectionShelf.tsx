import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SECTION_PAGE_SIZE, SECTION_PREVIEW_SIZE, sectionPage } from "./librarySections";
import type { LibrarySection } from "./librarySections";
import type { CatalogGame } from "./types";
interface Props { section: LibrarySection; selectedId?: number; renderGame: (game: CatalogGame) => ReactNode; reset: number }
export default function LibrarySectionShelf({ section, selectedId, renderGame, reset }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The toolbar reset token intentionally restores this shelf preview.
  useEffect(() => { setExpanded(false); setPage(0); }, [reset]);
  const selectedPosition = section.games.findIndex(game => game.id === selectedId);
  useEffect(() => {
    const index = selectedPosition;
    if (index >= SECTION_PREVIEW_SIZE) { setExpanded(true); setPage(Math.floor(index / SECTION_PAGE_SIZE)); }
    else if (index >= 0) setPage(0);
  }, [selectedPosition]);
  const visible = sectionPage(section.games, expanded, page);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll only when navigation or the rendered page changes.
  useEffect(() => {
    const selected = rootRef.current?.querySelector<HTMLElement>(".is-selected");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedId, visible.page, expanded]);
  const changePage = (next: number) => { setPage(next); rootRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); };
  return <section ref={rootRef} className="library-section" aria-label={section.title}>
    <header className="library-section-heading">
      <div><h2>{section.title} <small>{section.games.length}</small></h2>{section.id === "installed" ? <span>Últimos jugados primero</span> : null}</div>
      {section.games.length > SECTION_PREVIEW_SIZE ? <button type="button" aria-expanded={expanded} aria-controls={`section-${section.id}`} onClick={() => { setExpanded(!expanded); setPage(0); }}>{expanded ? "Mostrar menos" : "Ver todos"}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button> : null}
    </header>
    <div id={`section-${section.id}`} className="library-section-grid">{visible.games.map(renderGame)}</div>
    {!section.games.length ? <p className="library-section-empty">No hay juegos instalados en esta vista.</p> : null}
    {expanded && visible.lastPage > 0 ? <nav className="library-section-pages" aria-label={`Páginas de ${section.title}`}><button type="button" disabled={visible.page === 0} onClick={() => changePage(visible.page - 1)}>Anterior</button><span>{visible.start + 1}–{visible.start + visible.games.length} de {section.games.length}</span><button type="button" disabled={visible.page === visible.lastPage} onClick={() => changePage(visible.page + 1)}>Siguiente</button></nav> : null}
  </section>;
}
