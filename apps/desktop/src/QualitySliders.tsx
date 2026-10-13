import { useState } from "react";
import { NO_BOUND_ICON } from "./MultiplayerParentOption";
import type { LibrarySearchFilters } from "./librarySearch";

/** Year bounds the catalog can actually contain, from its own release dates. */
const EARLIEST_YEAR = 1995;
const LATEST_YEAR = new Date().getFullYear() + 1;

/**
 * Ranking and release date as ranges, not checkboxes.
 *
 * "Nothing below 70%" and "nothing older than 2015" are answers on a scale, and
 * a boolean cannot express where the bar sits. Each slider starts disabled and
 * off, so an untouched panel filters nothing.
 */
export default function QualitySliders({ draft, onChange }: {
  draft: LibrarySearchFilters;
  onChange: (patch: Partial<LibrarySearchFilters>) => void;
}) {
  const [scoreOn, setScoreOn] = useState(draft.minReviewScore !== undefined);
  const [yearsOn, setYearsOn] = useState(draft.releaseYearFrom !== undefined || draft.releaseYearTo !== undefined);
  const score = draft.minReviewScore ?? 70;
  const from = draft.releaseYearFrom ?? EARLIEST_YEAR;
  const to = draft.releaseYearTo ?? LATEST_YEAR;
  const toggleScore = (on: boolean) => {
    setScoreOn(on);
    onChange({ minReviewScore: on ? score : undefined });
  };
  const toggleYears = (on: boolean) => {
    setYearsOn(on);
    onChange(on ? { releaseYearFrom: from, releaseYearTo: to } : { releaseYearFrom: undefined, releaseYearTo: undefined });
  };
  return (
    <div className="ga-filter-sliders">
      <div className={"ga-slider-row" + (scoreOn ? "" : " is-off")}>
        <label htmlFor="ga-min-score">
          <input type="checkbox" checked={scoreOn} onChange={event => toggleScore(event.target.checked)} />
          Puntaje mínimo
          <output htmlFor="ga-min-score">{scoreOn ? `${score}%` : <NO_BOUND_ICON size={13} aria-label="sin límite" />}</output>
        </label>
        <input id="ga-min-score" type="range" min={0} max={100} step={5} value={score} disabled={!scoreOn}
          onChange={event => onChange({ minReviewScore: Number(event.target.value) })} />
        <small>Porcentaje de reseñas positivas en Steam. 70% es el umbral de "mayormente positivas". No oculta juegos nuevos (menos de un mes) ni con pocas reseñas.</small>
      </div>
      <div className={"ga-slider-row" + (yearsOn ? "" : " is-off")}>
        <label htmlFor="ga-year-from">
          <input type="checkbox" checked={yearsOn} onChange={event => toggleYears(event.target.checked)} />
          Año de lanzamiento
          <output htmlFor="ga-year-from">{yearsOn ? `${from} – ${to === LATEST_YEAR ? "hoy" : to}` : <NO_BOUND_ICON size={13} aria-label="sin límite" />}</output>
        </label>
        <div className="ga-slider-pair">
          <input id="ga-year-from" type="range" min={EARLIEST_YEAR} max={LATEST_YEAR} step={1} value={from} disabled={!yearsOn}
            aria-label="Desde" onChange={event => onChange({ releaseYearFrom: Math.min(Number(event.target.value), to) })} />
          <input type="range" min={EARLIEST_YEAR} max={LATEST_YEAR} step={1} value={to} disabled={!yearsOn}
            aria-label="Hasta" onChange={event => onChange({ releaseYearTo: Math.max(Number(event.target.value), from) })} />
        </div>
        <small>Los juegos sin fecha legible quedan fuera cuando activás el rango.</small>
      </div>
    </div>
  );
}
