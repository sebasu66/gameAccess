import { useEffect, useRef, useState } from "react";
import { Gamepad2, Search, X } from "lucide-react";

import type { CatalogGame } from "./types";

export function LibrarySphere({ games, query, setQuery, onOpen, onClose, detailOpen = false }: {
  games: CatalogGame[];
  query: string;
  setQuery: (value: string) => void;
  onOpen: (game: CatalogGame) => void;
  onClose: () => void;
  detailOpen?: boolean;
}) {
  const visible = games.filter((game) => game.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const columns = 11;
  const selectedGame = visible[selectedIndex] ?? visible[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const radius = Math.max(900, Math.min(1800, entry.contentRect.width * .72));
      root.style.setProperty("--dome-radius", `${Math.round(radius)}px`);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    if (!detailOpen) rootRef.current?.focus({ preventScroll: true });
  }, [detailOpen]);

  const moveSelection = (delta: number) => {
    setSelectedIndex((current) => Math.max(0, Math.min(visible.length - 1, current + delta)));
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (detailOpen) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (event.target instanceof HTMLInputElement && key !== "escape") return;
    const moves: Record<string, number> = {arrowleft: -1, a: -1, arrowright: 1, d: 1, arrowup: -columns, w: -columns, arrowdown: columns, s: columns};
    if (moves[key] !== undefined) moveSelection(moves[key]);
    else if (key === "enter" && selectedGame) onOpen(selectedGame);
    else if (key === "escape") onClose();
    else return;
    event.preventDefault();
  };

  return (
    <div ref={rootRef} className={`library-vault dome-root ${detailOpen ? "has-detail" : ""}`} role="dialog" aria-modal="true" aria-label="Tu biblioteca completa" tabIndex={-1} onKeyDown={keyDown}>
      <div className="library-vault-head">
        <div><span className="eyebrow">BIBLIOTECA INMERSIVA</span><h2>{selectedGame?.name ?? "Tus juegos"}</h2><p>{visible.length} juegos en esta vista</p></div>
        <div className="library-vault-actions">
          <label className="library-search"><Search size={18} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en tu biblioteca" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={16} /></button> : null}</label>
          <button type="button" className="library-close" onClick={onClose} aria-label="Cerrar biblioteca"><X size={20} /></button>
        </div>
      </div>
      <div className="dome-viewport">
        <div className="dome-stage"><div className="dome-sphere">
          {visible.map((game, index) => {
            const selectedRow = Math.floor(selectedIndex / columns);
            const selectedColumn = selectedIndex % columns;
            const row = Math.floor(index / columns);
            const column = index % columns;
            const offsetX = column - selectedColumn;
            const offsetY = row - selectedRow;
            const selected = index === selectedIndex;
            return <button type="button" className={`dome-cell ${selected ? "is-selected" : ""}`} key={game.id} style={{ "--dome-x": offsetX, "--dome-y": offsetY } as React.CSSProperties} onClick={() => setSelectedIndex(index)} onDoubleClick={() => onOpen(game)} aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}`} aria-current={selected ? "true" : undefined}>
              {game.capsule_image || game.header_image ? <img src={game.capsule_image ?? game.header_image ?? ""} alt="" draggable={false} /> : <span className="dome-cell-fallback"><Gamepad2 size={32} /></span>}<span>{game.name}</span>
            </button>;
          })}
        </div></div>
        <div className="dome-vignette" />
        {!visible.length ? <div className="library-empty">No encontramos juegos con “{query}”.</div> : null}
      </div>
      {selectedGame ? <div className="dome-selection-readout"><span>{selectedIndex + 1} / {visible.length}</span><strong>{selectedGame.name}</strong><small>ENTER · ABRIR FICHA</small></div> : null}
      <section  className="dome-controls-hint" aria-label="Controles de navegación">{detailOpen ? <><span>NAVEGAR ACCIONES · WASD / FLECHAS</span><span>ACTIVAR · ENTER</span><span>VOLVER · ESC</span></> : <><span>NAVEGAR · WASD / FLECHAS</span><span>VER DETALLES · ENTER</span><span>BUSCAR · CTRL+F</span><span>VOLVER · ESC</span></>}</section>
    </div>
  );
}

