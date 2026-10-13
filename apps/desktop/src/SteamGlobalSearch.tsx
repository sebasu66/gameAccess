import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { LIBRARY_SEARCH_EVENT } from "./librarySearch";

type Props = {
  query: string;
  setQuery: (value: string) => void;
};

export default function SteamGlobalSearch({ query, setQuery }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

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

  const commitSearch = () => {
    setQuery(draft.trim());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSearch();
    }
  };

  const handleClear = () => {
    setDraft("");
    setQuery("");
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="global-search">
      <label className="search-box global-search-box">
        <Search className="ga-search-icon" size={28} strokeWidth={2} onClick={commitSearch} style={{ cursor: "pointer" }} />
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscá tu próximo juego"
          autoComplete="off"
          aria-label="Buscar juegos por título o metadatos"
        />
        {draft || query ? (
          <button type="button" onClick={handleClear} aria-label="Limpiar búsqueda">
            <X size={15} />
          </button>
        ) : null}
      </label>
    </div>
  );
}
