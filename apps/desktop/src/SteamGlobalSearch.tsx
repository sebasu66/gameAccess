import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

import { LIBRARY_SEARCH_EVENT } from "./librarySearch";

type Props = {
  query: string;
  setQuery: (value: string) => void;
};

export default function SteamGlobalSearch({ query, setQuery }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      // gameaccess internal Ctrl+F: consume the browser/Tauri find shortcut globally.
      if (!(event.ctrlKey || event.metaKey) || event.altKey || !["f", "k"].includes(event.key.toLowerCase())) return;
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    };

    window.addEventListener("keydown", handleSearchShortcut, true);
    return () => window.removeEventListener("keydown", handleSearchShortcut, true);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(LIBRARY_SEARCH_EVENT, { detail: { query } }));
  }, [query]);

  return (
    <div className="global-search">
      <label className="search-box global-search-box">
        <Search className="ga-search-icon" size={28} strokeWidth={2} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscá tu próximo juego"
          autoComplete="off"
          aria-label="Buscar juegos por título o metadatos"
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
