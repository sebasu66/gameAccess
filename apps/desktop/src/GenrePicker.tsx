import { useMemo, useState, type ReactNode } from "react";
import { Minus, Plus, Search } from "lucide-react";
import { genreIcon, genreRank } from "./genreIcons";
import { genreLabel } from "./libraryGenres";
import { normalizeSearchText } from "./libraryText";
import type { TriState } from "./TriStateOption";

const NEXT: Record<TriState, TriState> = { off: "include", include: "exclude", exclude: "off" };

/**
 * Step 1 of the filter wizard: every genre as an icon tile with its own search box.
 * One tap requires the genre (+), a second tap excludes it (−), a third clears it.
 */
export default function GenrePicker({ genres, stateOf, onSet, footer }: {
  genres: string[];
  stateOf: (genre: string) => TriState;
  onSet: (genre: string, state: TriState) => void;
  footer?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  // The curated genres come first in a fixed order; the long tail of small ones hides behind "Ver más".
  const { visible, hidden } = useMemo(() => {
    const needle = normalizeSearchText(text);
    if (needle) return { visible: genres.filter(genre => normalizeSearchText(genreLabel(genre)).includes(needle)), hidden: 0 };
    const main = genres.filter(genre => genreRank(genre) >= 0).sort((a, b) => genreRank(a) - genreRank(b));
    const rest = genres.filter(genre => genreRank(genre) < 0);
    return showAll ? { visible: [...main, ...rest], hidden: 0 } : { visible: main, hidden: rest.length };
  }, [genres, text, showAll]);
  return (
    <div className="ga-wiz-genres">
      <label className="ga-wiz-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={text} placeholder="Buscá un género" aria-label="Buscar género"
          onChange={event => setText(event.target.value)} />
      </label>
      <p className="ga-wiz-hint">Tocá una vez para pedirlo <b>+</b>, dos para excluirlo <b>−</b>.</p>
      <div className="ga-wiz-genre-grid" role="group" aria-label="Géneros">
        {visible.map(genre => {
          const state = stateOf(genre);
          const Icon = genreIcon(genre);
          const label = genreLabel(genre);
          return (
            <button key={genre} type="button" className={`ga-wiz-genre is-${state}`} aria-pressed={state !== "off"}
              aria-label={`${label}: ${state === "include" ? "exigido" : state === "exclude" ? "excluido" : "sin elegir"}`}
              onClick={() => onSet(genre, NEXT[state])}>
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
              {state === "include" ? <Plus className="ga-wiz-badge" size={13} aria-hidden="true" /> : null}
              {state === "exclude" ? <Minus className="ga-wiz-badge" size={13} aria-hidden="true" /> : null}
            </button>
          );
        })}
        {hidden > 0 ? <button type="button" className="ga-wiz-more" onClick={() => setShowAll(true)}>Ver {hidden} géneros más</button> : null}
        {visible.length === 0 ? <p className="ga-wiz-empty">Ningún género se llama así.</p> : null}
      </div>
      {footer}
    </div>
  );
}
