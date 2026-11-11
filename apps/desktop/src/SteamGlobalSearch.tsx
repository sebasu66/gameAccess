import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { useAiSearch } from "./aiSuggestions";

import { LIBRARY_SEARCH_EVENT } from "./librarySearch";
import { useI18n } from "./i18n";
import { getAppScreen, setAppScreen } from "./appScreen";

type Props = {
  query: string;
  setQuery: (value: string) => void;
  /** Filter while typing (the new shell's content header, §4.3) instead of on Enter. */
  live?: boolean;
};

/** How long typing rests before a live search runs. */
const LIVE_SEARCH_MS = 220;

export default function SteamGlobalSearch({ query, setQuery, live = false }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(query);
  // With the magic button on and an AI connected the search is a request in words (LibraryRoom, aiSuggestions.ts).
  const askAi = useAiSearch().on;

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
      // The new shell's header searching what is on screen (Help, Settings) takes Ctrl+F there.
      const pageSearch = document.querySelector<HTMLInputElement>("[data-ga-head-search]");
      if (pageSearch?.offsetParent) { pageSearch.focus({ preventScroll: true }); pageSearch.select(); return; }
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

  useEffect(() => {
    // A request in words to the AI waits for Enter: it is not sent at every pause.
    if (!live || askAi || draft.trim() === query) return;
    const timer = window.setTimeout(() => setQuery(draft.trim()), LIVE_SEARCH_MS);
    return () => window.clearTimeout(timer);
  }, [askAi, draft, live, query, setQuery]);

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
    <div className={askAi ? "global-search is-ai" : "global-search"}>
      <label className="search-box global-search-box">
        {askAi ? <Sparkles className="ga-search-icon" size={26} strokeWidth={2} onClick={commitSearch} style={{ cursor: "pointer" }} /> : <Search className="ga-search-icon" size={28} strokeWidth={2} onClick={commitSearch} style={{ cursor: "pointer" }} />}
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={askAi ? t("aiAskPlaceholder") : t("uiBuscaTuProximoJuego")}
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
