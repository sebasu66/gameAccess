import { CircleMinus, CirclePlus, Eraser, Globe, Handshake, Network, Swords, Tv, User, Users, type LucideIcon } from "lucide-react";
import FancySlider from "./FancySlider";
import { dateWords, EARLIEST_YEAR, latestYear } from "./filterSentence";
import type { TriState } from "./TriStateOption";
import type { LibraryFeatureKey, LibrarySearchFilters } from "./librarySearch";

type Chip = { key: LibraryFeatureKey; label: string; Icon: LucideIcon };
const WHAT: Chip[] = [
  { key: "coop", label: "Cooperativo / PvE", Icon: Handshake },
  { key: "pvp", label: "PvP", Icon: Swords },
  { key: "mmo", label: "MMO", Icon: Users },
];
const WHERE: Chip[] = [
  { key: "shared_split_screen", label: "Misma pantalla", Icon: Tv },
  { key: "lan", label: "LAN", Icon: Network },
  { key: "online_multiplayer", label: "Online", Icon: Globe },
];

/** "Solo un jugador" or "Multijugador" side by side; multijugador opens its modes. */
export function PlayersPanel({ filters, onToggle, onClear }: { filters: LibrarySearchFilters; onToggle: (key: LibraryFeatureKey) => void; onClear: () => void }) {
  const single = filters.features.includes("single_player");
  const multi = filters.features.includes("multiplayer");
  const chips = (list: Chip[]) => list.map(({ key, label, Icon }) => {
    const on = filters.features.includes(key);
    return <button key={key} type="button" className={"ga-sx-chip" + (on ? " is-on" : "")} aria-pressed={on} onClick={() => onToggle(key)}>
      <Icon size={15} aria-hidden="true" />{label}
    </button>;
  });
  return (
    <div className="ga-sx-players">
      <ClearButton onClick={onClear} disabled={!single && !multi} />
      <div className="ga-sx-pair">
        <button type="button" className={"ga-sx-big" + (single ? " is-on" : "")} aria-pressed={single} onClick={() => onToggle("single_player")}>
          <User size={20} aria-hidden="true" />Solo un jugador
        </button>
        <button type="button" className={"ga-sx-big" + (multi ? " is-on" : "")} aria-pressed={multi} onClick={() => onToggle("multiplayer")}>
          <Users size={20} aria-hidden="true" />Multijugador
        </button>
      </div>
      {multi ? <div className="ga-sx-modes">
        <div className="ga-sx-row">{chips(WHAT)}</div>
        <div className="ga-sx-row"><span className="ga-sx-rowlabel">Se juega</span>{chips(WHERE)}</div>
      </div> : null}
    </div>
  );
}

/** The minimum positive-review percentage. */
export function ScorePanel({ filters, onChange }: { filters: LibrarySearchFilters; onChange: (patch: Partial<LibrarySearchFilters>) => void }) {
  const score = filters.minReviewScore;
  return (
    <div className="ga-sx-score">
      <div className="ga-sx-what"><strong>Reseñas positivas</strong><span>Mostrar solo juegos que le gustaron al menos a este porcentaje de quienes los probaron.</span></div>
      <FancySlider min={0} max={100} step={5} value={score ?? 60} label="Porcentaje mínimo de reseñas positivas" format={n => `${n} %`}
        onChange={value => onChange({ minReviewScore: value as number })} />
      <ClearButton label="Sin mínimo" disabled={score === undefined} onClick={() => onChange({ minReviewScore: undefined })} />
    </div>
  );
}

const PRESETS = [{ label: "Último año", years: 1 }, { label: "2 años", years: 2 }, { label: "5 años", years: 5 }, { label: "10 años", years: 10 }];

/** How recent: quick windows, or an exact range of years. */
export function DatePanel({ filters, onChange }: { filters: LibrarySearchFilters; onChange: (patch: Partial<LibrarySearchFilters>) => void }) {
  const now = new Date().getFullYear();
  const top = latestYear();
  const from = filters.releaseYearFrom ?? EARLIEST_YEAR;
  const to = filters.releaseYearTo ?? top;
  const anyDate = filters.releaseYearFrom === undefined && filters.releaseYearTo === undefined;
  const active = (years: number) => filters.releaseYearFrom === now - years && (filters.releaseYearTo ?? top) >= now;
  return (
    <div className="ga-sx-date">
      <div className="ga-sx-what"><strong>Año de lanzamiento</strong><span>Mové las dos puntas para elegir desde qué año y hasta cuál. {anyDate ? "Hoy: cualquier fecha." : `Hoy: ${dateWords(filters)}.`}</span></div>
      <div className="ga-sx-row">
        <button type="button" className={"ga-sx-chip" + (anyDate ? " is-on" : "")} aria-pressed={anyDate}
          onClick={() => onChange({ releaseYearFrom: undefined, releaseYearTo: undefined })}>Cualquier fecha</button>
        {PRESETS.map(({ label, years }) => <button key={years} type="button" className={"ga-sx-chip" + (active(years) ? " is-on" : "")} aria-pressed={active(years)}
          onClick={() => onChange({ releaseYearFrom: now - years, releaseYearTo: top })}>{label}</button>)}
      </div>
      <FancySlider min={EARLIEST_YEAR} max={top} step={1} value={[from, to]} label="Año de lanzamiento" ariaLabels={["Desde el año", "Hasta el año"]}
        format={n => n >= top ? "hoy" : String(n)}
        onChange={value => { const [f, t] = value as [number, number]; onChange({ releaseYearFrom: f, releaseYearTo: t }); }} />
    </div>
  );
}

/** Wipes one group of choices, and nothing else. */
export function ClearButton({ label = "Limpiar", onClick, disabled }: { label?: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="ga-sx-clear" onClick={onClick} disabled={disabled}><Eraser size={13} aria-hidden="true" />{label}</button>;
}

/** A name with its own + (I want it) and − (I don't) controls; pressing the active one clears it. */
export function PlusMinus({ label, state, onSet, disabled, title }: {
  label: string; state: TriState; onSet: (state: TriState) => void; disabled?: boolean; title?: string;
}) {
  return (
    <span className={`ga-sx-pmrow is-${state}`} title={title}>
      <span>{label}</span>
      <button type="button" className="ga-sx-pm is-include" aria-pressed={state === "include"} disabled={disabled} aria-label={`Incluir ${label}`}
        onClick={() => onSet(state === "include" ? "off" : "include")}><CirclePlus size={18} aria-hidden="true" /></button>
      <button type="button" className="ga-sx-pm is-exclude" aria-pressed={state === "exclude"} disabled={disabled} aria-label={`Excluir ${label}`}
        onClick={() => onSet(state === "exclude" ? "off" : "exclude")}><CircleMinus size={18} aria-hidden="true" /></button>
    </span>
  );
}
