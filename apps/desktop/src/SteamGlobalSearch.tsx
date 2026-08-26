import { useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Loader2, Search, X } from "lucide-react";

import { searchSteam } from "./api";
import SteamStoreDetail from "./SteamStoreDetail";
import type { CatalogGame, SteamSearchResult } from "./types";
import "./steam-search.css";

type Props = {
  query: string;
  setQuery: (value: string) => void;
  onOpenCatalogGame: (game: CatalogGame) => void;
};

function formatPrice(result: SteamSearchResult) {
  const price = result.price;
  if (!price || price.final == null || !price.currency) return null;
  if (price.final === 0) return "Gratis";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: price.currency,
      maximumFractionDigits: 2,
    }).format(price.final / 100);
  } catch {
    return `${(price.final / 100).toFixed(2)} ${price.currency}`;
  }
}

function accessLabel(result: SteamSearchResult) {
  const game = result.catalog_game;
  if (!game) return "Steam · disponible para explorar y comprar";
  if (game.copies_available > 0) {
    return `${game.copies_available} licencia${game.copies_available === 1 ? "" : "s"} disponible${game.copies_available === 1 ? "" : "s"}`;
  }
  if (game.copies_total > 0) return `${game.copies_total} licencia${game.copies_total === 1 ? "" : "s"} · ocupada${game.copies_total === 1 ? "" : "s"} ahora`;
  return "Sin licencias configuradas";
}

export default function SteamGlobalSearch({ query, setQuery, onOpenCatalogGame }: Props) {
  const [results, setResults] = useState<SteamSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [selectedStore, setSelectedStore] = useState<SteamSearchResult | null>(null);
  const requestId = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      searchSteam(trimmed, 20)
        .then((response) => {
          if (requestId.current === id) setResults(response.results);
        })
        .catch((err) => {
          if (requestId.current === id) {
            setResults([]);
            setError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 280);

    return () => window.clearTimeout(timer);
  }, [trimmed]);

  const open = focused && trimmed.length >= 2;
  const shown = useMemo(() => results.slice(0, 12), [results]);

  const openResult = (result: SteamSearchResult) => {
    setFocused(false);
    if (result.catalog_game) {
      onOpenCatalogGame(result.catalog_game);
      return;
    }
    setSelectedStore(result);
  };

  return (
    <>
      <div className="global-search" onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 140)}>
        <label className="search-box global-search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en GameAccess y Steam"
            autoComplete="off"
          />
          {loading ? <Loader2 className="spin global-search-spinner" size={15} /> : null}
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={15} /></button> : null}
        </label>

        {open ? (
          <section className="global-search-popover" aria-label="Resultados de Steam">
            <div className="global-search-head">
              <strong>Steam</strong>
              <span>{loading ? "Buscando…" : `${results.length} resultado${results.length === 1 ? "" : "s"}`}</span>
            </div>

            {error ? <div className="global-search-message">No pudimos consultar Steam ahora mismo.</div> : null}
            {!loading && !error && !shown.length ? <div className="global-search-message">No encontramos juegos con ese nombre.</div> : null}

            <div className="global-search-results">
              {shown.map((result) => {
                const price = formatPrice(result);
                const inPool = Boolean(result.catalog_game);
                return (
                  <button
                    type="button"
                    key={result.app_id}
                    className={`global-search-result ${inPool ? "in-pool" : "steam-only"}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openResult(result)}
                    title={`Abrir ficha de ${result.name}`}
                  >
                    <div className="global-search-art">
                      {result.image_url ? <img src={result.image_url} alt="" loading="lazy" /> : <Gamepad2 size={22} />}
                    </div>
                    <div className="global-search-copy">
                      <strong>{result.name}</strong>
                      <span className={inPool ? "pool-state" : "steam-state"}>{accessLabel(result)}</span>
                    </div>
                    <div className="global-search-side">
                      {price ? <strong>{price}</strong> : null}
                      <small>App {result.app_id}</small>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="global-search-foot">El buscador cubre Steam completo. Cada juego puede abrir su ficha aunque todavía no tenga una licencia en el pool.</div>
          </section>
        ) : null}
      </div>

      {selectedStore ? <SteamStoreDetail result={selectedStore} onClose={() => setSelectedStore(null)} /> : null}
    </>
  );
}
