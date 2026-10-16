import { useMemo, useState } from "react";
import { CircleMinus, CirclePlus, Search } from "lucide-react";
import { genreIcon } from "./genreIcons";
import { genreLabel } from "./libraryGenres";
import { normalizeSearchText } from "./libraryText";
import { ClearButton } from "./SentencePanels";
import type { TriState } from "./TriStateOption";
import { useI18n } from "./i18n";

/**
 * The genre list behind "cualquier género": a small search box and an
 * alphabetical, scrollable list. Every row has its own + (I want it) and
 * − (I don't want it); pressing the active one again clears it.
 */
export default function GenrePicker({ genres, stateOf, onSet, onClear }: {
  genres: string[];
  stateOf: (genre: string) => TriState;
  onSet: (genre: string, state: TriState) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const rows = useMemo(() => {
    const needle = normalizeSearchText(text);
    return genres
      .map(id => ({ id, label: genreLabel(id) }))
      .filter(row => !needle || normalizeSearchText(row.label).includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [genres, text]);
  return (
    <div className="ga-sx-genres">
      <div className="ga-sx-genre-head">
      <label className="ga-sx-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={text} placeholder={t("uiBuscarGenero")} aria-label={t("uiBuscarGenero")} autoFocus
          onChange={event => setText(event.target.value)} />
      </label>
      <ClearButton onClick={onClear} disabled={!genres.some(genre => stateOf(genre) !== "off")} />
      </div>
      <ul className="ga-sx-genre-list" aria-label={t("uiGeneros")}>
        {rows.map(({ id, label }) => {
          const state = stateOf(id);
          const Icon = genreIcon(id);
          return (
            <li key={id} className={`is-${state}`}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              <button type="button" className="ga-sx-pm is-include" aria-pressed={state === "include"} title={`Quiero juegos de ${label}`}
                aria-label={`Incluir ${label}`} onClick={() => onSet(id, state === "include" ? "off" : "include")}><CirclePlus size={18} aria-hidden="true" /></button>
              <button type="button" className="ga-sx-pm is-exclude" aria-pressed={state === "exclude"} title={`No quiero juegos de ${label}`}
                aria-label={`Excluir ${label}`} onClick={() => onSet(id, state === "exclude" ? "off" : "exclude")}><CircleMinus size={18} aria-hidden="true" /></button>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="ga-sx-empty">{t("uiNingunGeneroSeLlama")}</li> : null}
      </ul>
    </div>
  );
}
