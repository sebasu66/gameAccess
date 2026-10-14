import { CircleMinus, CirclePlus, Eraser, Globe, Handshake, Network, Swords, Tv, User, Users, type LucideIcon } from "lucide-react";
import FancySlider from "./FancySlider";
import { RELEASE_POSITIONS, RELEASE_STEPS, RELEASE_TRACK, releaseIndexAt, releaseIndexFor, releaseShort } from "./releaseScale";
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
    <div className="ga-sx-slider">
      <span className="ga-sx-slider-title">Reseñas positivas</span>
      <FancySlider min={0} max={100} step={5} value={score ?? 0} label="Porcentaje mínimo de reseñas positivas" format={n => n === 0 ? "sin mínimo" : `${n} %`}
        onChange={value => onChange({ minReviewScore: (value as number) === 0 ? undefined : value as number })} />
    </div>
  );
}

/** How recent: one slider, a year per step in the past and a month per step near the present. */
export function DatePanel({ filters, onChange }: { filters: LibrarySearchFilters; onChange: (patch: Partial<LibrarySearchFilters>) => void }) {
  const index = releaseIndexFor(filters.maxAgeDays);
  return (
    <div className="ga-sx-slider">
      <span className="ga-sx-slider-title">Lanzamiento</span>
      <FancySlider min={0} max={RELEASE_TRACK} step={1} value={RELEASE_POSITIONS[index]} label="Cuánto hace que salió el juego"
        format={n => releaseShort(RELEASE_STEPS[releaseIndexAt(n)])}
        onChange={value => onChange({ maxAgeDays: RELEASE_STEPS[releaseIndexAt(value as number)], releaseYearFrom: undefined, releaseYearTo: undefined })} />
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
