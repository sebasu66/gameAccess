import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import CircularScrollbar from "./CircularScrollbar";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";
import { useDialogFocus } from "./dialogFocus";
import { EMPTY_LIBRARY_FILTERS, GAMEPLAY_FILTER_GROUPS, featureLabel, filterLibraryGames, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
import type { CatalogGame } from "./types";

export default function LibraryFilterDialog({ games, query, filters, genres, onApply }: {
  games: CatalogGame[]; query: string; filters: LibrarySearchFilters; genres: string[];
  onApply: (filters: LibrarySearchFilters) => void;
}) {
  const [draft, setDraft] = useState<LibrarySearchFilters>({ ...filters, includeUncertain: filters.includeUncertain !== false });
  const closeRef = useRef(() => onApply(draft));
  closeRef.current = () => onApply(draft);
  const {closing,close} = useOverlayClose(useCallback(() => closeRef.current(), []));
  const previousFocus = useRef(document.activeElement);
  useEffect(() => () => { if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true }); }, []);
  const ref = useDialogFocus(close);
  const scrollRef = useRef<HTMLDivElement>(null);
  const matches = filterLibraryGames(games, query, draft);
  const possible = matches.filter(game => game.filter_match === "possible").length;
  const toggle = (group: "genres" | "features", key: string) => setDraft(current => {
    const selected = current[group] as string[];
    return { ...current, [group]: selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key] } as LibrarySearchFilters;
  });
  return createPortal(<div className={`ga-filter-backdrop${closing ? " is-closing" : ""}`} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <OverlayScreenDimmer panelRef={ref} />
    <section ref={ref} className="ga-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="ga-filter-title">
      <header><div><span className="ga-detail-eyebrow">ENCONTRÁ TU PRÓXIMO JUEGO</span><h2 id="ga-filter-title">Filtros</h2></div><button type="button" aria-label="Cerrar filtros" onClick={close}><X /></button></header>
      <p>Elegí cualquiera de las opciones de cada grupo. Los grupos se combinan para afinar la búsqueda.</p>
      <div className="ga-scroll-frame ga-filter-scroll-frame"><div ref={scrollRef} className="ga-filter-groups">
        <fieldset><legend>Géneros</legend><small>Cualquiera de los seleccionados</small><div className="ga-filter-choices">{genres.map(genre => <label key={genre}><input type="checkbox" checked={draft.genres.includes(genre)} onChange={() => toggle("genres", genre)} />{genre}</label>)}</div></fieldset>
        {GAMEPLAY_FILTER_GROUPS.map(group => <fieldset key={group.id}><legend>{group.label}</legend><small>Sin selección: cualquiera</small><div className="ga-filter-choices">{group.options.map(key => <label key={key}><input type="checkbox" checked={draft.features.includes(key)} onChange={() => toggle("features", key)} />{featureLabel(key)}</label>)}</div></fieldset>)}
      </div><CircularScrollbar targetRef={scrollRef} label="Desplazar opciones de filtros" /></div>
      <label className="ga-filter-uncertain"><input type="checkbox" checked={draft.includeUncertain !== false} onChange={event => setDraft(current => ({ ...current, includeUncertain: event.target.checked }))} /><span>Incluir juegos con información incompleta<small>Se muestran después de las coincidencias confirmadas, respetando tus favoritos.</small></span></label>
      <footer><div role="status" aria-live="polite"><strong>{matches.length} {matches.length === 1 ? "juego" : "juegos"}</strong><small>{matches.length - possible} {matches.length - possible === 1 ? "confirmado" : "confirmados"} · {possible} {possible === 1 ? "posible" : "posibles"}</small></div><button type="button" onClick={() => setDraft({ ...EMPTY_LIBRARY_FILTERS, includeUncertain: true })}>Limpiar todo</button><button type="button" className="ga-filter-apply" onClick={close}>Mostrar {matches.length} {matches.length === 1 ? "juego" : "juegos"}</button></footer>
    </section>
  </div>, document.body);
}

export function activeFilterTags(filters: LibrarySearchFilters): { group: "genres" | "features"; value: string; label: string }[] {
  return [...filters.genres.map(value => ({ group: "genres" as const, value, label: value })),
    ...filters.features.map(value => ({ group: "features" as const, value, label: featureLabel(value as LibraryFeatureKey) }))];
}
