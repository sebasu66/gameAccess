import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { LIBRARY_SEARCH_EVENT } from "./librarySearch";
import { useI18n } from "./i18n";
import { getAppScreen, setAppScreen } from "./appScreen";

type Props = {
  query: string;
  setQuery: (value: string) => void;
};

export default function SteamGlobalSearch({ query, setQuery }: Props) {
  const { t } = useI18n();
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
      const focus = () => { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); };
      if (getAppScreen() === "games") { focus(); return; }
      // From another mode (Home, Settings, parental): back to the games, then the field once it shows.
      setAppScreen("games");
      const started = Date.now();
      const whenShown = () => {
        const input = inputRef.current;
        if (input && getAppScreen() === "games" && input.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false && Number(getComputedStyle(input.closest(".app-shell > main") ?? input).opacity) > .5) focus();
        else if (Date.now() - started < 3000) window.setTimeout(whenShown, 50);
      };
      whenShown();
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
          placeholder={t("uiBuscaTuProximoJuego")}
          autoComplete="off"
          aria-label={t("uiBuscarJuegosPorTitulo")}
        />
        {draft || query ? (
          <button type="button" onClick={handleClear} aria-label={t("uiLimpiarBusqueda")}>
            <X size={15} />
          </button>
        ) : null}
      </label>
    </div>
  );
}
