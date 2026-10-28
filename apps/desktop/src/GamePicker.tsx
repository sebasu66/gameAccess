import { useEffect, useId, useRef, useState } from "react";
import { queryCatalogCache } from "./catalogCache";
import { useI18n } from "./i18n";
import type { CatalogGame } from "./types";
import "./game-picker.css";

const MAX_RESULTS = 8;
const releaseYear = (game: CatalogGame) => /\b(\d{4})\b/.exec(String(game.release_date ?? ""))?.[1];

/**
 * Choose a game of the catalog by typing part of its title ("dirt", "rally") or its AppID: the matching games are
 * listed to pick one (arrows and Enter work too). Used wherever the app must know exactly which game something is
 * (a manual download), so it never has to invent an AppID.
 */
export default function GamePicker({ value, onChange, label }: { value: CatalogGame | null; onChange: (game: CatalogGame | null) => void; label: string }) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [results, setResults] = useState<CatalogGame[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const query = text.trim();
    if (value && query === value.name) return;
    if (query.length < 2) { setResults([]); return; }
    const mine = ++request.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      const byAppId = /^\d+$/.test(query) ? { app_ids: [Number(query)] } : { query };
      void queryCatalogCache({ ...byAppId, limit: MAX_RESULTS, sort_by: "popularity" })
        .then(result => { if (mine === request.current) { setResults(result.items); setActive(0); setOpen(true); } })
        .catch(() => { if (mine === request.current) setResults([]); })
        .finally(() => { if (mine === request.current) setSearching(false); });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [text, value]);

  const choose = (game: CatalogGame) => { onChange(game); setText(game.name); setOpen(false); };
  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => (index + 1) % results.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index - 1 + results.length) % results.length); }
    else if (event.key === "Enter") { event.preventDefault(); choose(results[active]); }
    else if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="ga-game-picker">
      <label htmlFor={id}>{label}</label>
      <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
        placeholder={t("gamePickerPlaceholder")} value={text} onKeyDown={onKey} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onFocus={() => { if (results.length && !value) setOpen(true); }}
        onChange={event => { setText(event.target.value); if (value) onChange(null); }} />
      {value ? <p className="ga-game-picker-chosen">{t("gamePickerChosen", { name: value.name, appId: value.app_id ?? value.id })}</p>
        : text.trim().length >= 2 && !searching && !results.length ? <p className="ga-game-picker-none">{t("gamePickerNone")}</p> : null}
      {open && results.length ? (
        <ul id={`${id}-list`} role="listbox" className="ga-game-picker-list">
          {results.map((game, index) => (
            <li key={game.id} role="option" aria-selected={index === active} data-active={index === active || undefined}
              onMouseDown={event => { event.preventDefault(); choose(game); }} onMouseEnter={() => setActive(index)}>
              <b>{game.name}</b>
              <span>{[releaseYear(game), `AppID ${game.app_id ?? game.id}`].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
