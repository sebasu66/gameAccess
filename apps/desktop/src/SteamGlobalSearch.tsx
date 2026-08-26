import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Gamepad2, Loader2, Search, X } from "lucide-react";

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
  if (!game) return "Disponible para explorar y comprar";
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
  const [selectedStore, setSelectedStore] = useState<SteamSearchResult | null>(null);
  const requestId = useRef(0);
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;

  useEffect(() => {
    if (!searching) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      searchSteam(trimmed, 40)
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
  }, [trimmed, searching]);

  const openResult = (result: SteamSearchResult) => {
    if (result.catalog_game) {
      onOpenCatalogGame(result.catalog_game);
      return;
    }
    setSelectedStore(result);
  };

  const backHome = () => {
    setSelectedStore(null);
    setQuery("");
  };

  return (
    <>
      <div className="global-search">
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

        {searching ? (
          <section className="global-search-page" aria-label={`Resultados para ${trimmed}`}>
            <div className="global-search-page-inner">
              <div className="global-search-page-head">
                <button className="global-search-back" type="button" onClick={backHome}>
                  <ArrowLeft size={18} /> Volver al inicio
                </button>
                <div>
                  <span className="global-search-eyebrow">BÚSQUEDA GLOBAL</span>
                  <h1>Resultados para “{trimmed}”</h1>
                  <p>
                    {loading
                      ? "Buscando en Steam y cruzando disponibilidad con GameAccess…"
                      : `${results.length} resultado${results.length === 1 ? "" : "s"}. Podés abrir cualquier juego aunque todavía no tenga una licencia en el pool.`}
                  </p>
                </div>
              </div>

              {error ? <div className="global-search-message">No pudimos consultar Steam ahora mismo.</div> : null}
              {!loading && !error && !results.length ? <div className="global-search-message">No encontramos juegos con ese nombre.</div> : null}

              <div className="global-search-results-page">
                {results.map((result) => {
                  const price = formatPrice(result);
                  const inPool = Boolean(result.catalog_game);
                  return (
                    <button
                      type="button"
                      key={result.app_id}
                      className={`global-search-result-card ${inPool ? "in-pool" : "steam-only"}`}
                      onClick={() => openResult(result)}
                      title={`Abrir ficha de ${result.name}`}
                    >
                      <div className="global-search-card-art">
                        {result.image_url ? <img src={result.image_url} alt="" loading="lazy" /> : <Gamepad2 size={34} />}
                      </div>
                      <div className="global-search-card-copy">
                        <strong>{result.name}</strong>
                        <span className={inPool ? "pool-state" : "steam-state"}>{accessLabel(result)}</span>
                      </div>
                      <div className="global-search-card-side">
                        {price ? <strong>{price}</strong> : <strong>Ver ficha</strong>}
                        <small>Steam App {result.app_id}</small>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {selectedStore ? <SteamStoreDetail result={selectedStore} onClose={() => setSelectedStore(null)} /> : null}
    </>
  );
}
