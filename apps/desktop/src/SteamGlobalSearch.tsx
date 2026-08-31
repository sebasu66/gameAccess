import { useEffect } from "react";
import { Search, X } from "lucide-react";

import { LIBRARY_SEARCH_EVENT } from "./librarySearch";
import type { CatalogGame } from "./types";

type Props = {
  query: string;
  setQuery: (value: string) => void;
  onOpenCatalogGame: (game: CatalogGame) => void;
};

export default function SteamGlobalSearch({ query, setQuery }: Props) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(LIBRARY_SEARCH_EVENT, { detail: { query } }));
  }, [query]);

  return (
    <div className="global-search">
      <label className="search-box global-search-box">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar en tu biblioteca"
          autoComplete="off"
          aria-label="Buscar en tu biblioteca"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">
            <X size={15} />
          </button>
        ) : null}
      </label>
    </div>
  );
}
