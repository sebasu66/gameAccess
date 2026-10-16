import { CircleMinus, CirclePlus, Eraser, Globe, Handshake, Network, Swords, Tv, User, Users, type LucideIcon } from "lucide-react";
import FancySlider from "./FancySlider";
import { RELEASE_POSITIONS, RELEASE_STEPS, RELEASE_TRACK, releaseIndexAt, releaseIndexFor, releaseShort } from "./releaseScale";
import type { TriState } from "./TriStateOption";
import type { LibraryFeatureKey, LibrarySearchFilters } from "./librarySearch";
import { MIN_REVIEWS_OPTION } from "./librarySearch";
import { useI18n, type TranslationKey, translate } from "./i18n";

type Chip = { key: LibraryFeatureKey; label: TranslationKey; Icon: LucideIcon };
const WHAT: Chip[] = [
  { key: "coop", label: "chipCoop", Icon: Handshake },
  { key: "pvp", label: "chipPvp", Icon: Swords },
  { key: "mmo", label: "chipMmo", Icon: Users },
];
const WHERE: Chip[] = [
  { key: "shared_split_screen", label: "chipSameScreen", Icon: Tv },
  { key: "lan", label: "chipLan", Icon: Network },
  { key: "online_multiplayer", label: "chipOnline", Icon: Globe },
];

/** "Solo un jugador" or "Multijugador" side by side; multijugador opens its modes. */
export function PlayersPanel({ filters, onToggle, onClear }: { filters: LibrarySearchFilters; onToggle: (key: LibraryFeatureKey) => void; onClear: () => void }) {
  const { t } = useI18n();
  const single = filters.features.includes("single_player");
  const multi = filters.features.includes("multiplayer");
  const chips = (list: Chip[]) => list.map(({ key, label, Icon }) => {
    const on = filters.features.includes(key);
    return <button key={key} type="button" className={"ga-sx-chip" + (on ? " is-on" : "")} aria-pressed={on} onClick={() => onToggle(key)}>
      <Icon size={15} aria-hidden="true" />{t(label)}
    </button>;
  });
  return (
    <div className="ga-sx-players">
      <ClearButton onClick={onClear} disabled={!single && !multi} />
      <div className="ga-sx-pair">
        <button type="button" className={"ga-sx-big" + (single ? " is-on" : "")} aria-pressed={single} onClick={() => onToggle("single_player")}>
          <User size={20} aria-hidden="true" />{t("playersSolo")}
        </button>
        <button type="button" className={"ga-sx-big" + (multi ? " is-on" : "")} aria-pressed={multi} onClick={() => onToggle("multiplayer")}>
          <Users size={20} aria-hidden="true" />{t("playersMulti")}
        </button>
      </div>
      {multi ? <div className="ga-sx-modes">
        <div className="ga-sx-row">{chips(WHAT)}</div>
        <div className="ga-sx-row"><span className="ga-sx-rowlabel">{t("uiSeJuega")}</span>{chips(WHERE)}</div>
      </div> : null}
    </div>
  );
}

/** The minimum positive-review percentage, with a checkbox that also requires a minimum number of reviews. */
export function ScorePanel({ filters, onChange }: { filters: LibrarySearchFilters; onChange: (patch: Partial<LibrarySearchFilters>) => void }) {
  const { t } = useI18n();
  const score = filters.minReviewScore;
  const reviewsOn = filters.minReviewCount !== undefined;
  return (
    <div className="ga-sx-slider">
      <span className="ga-sx-slider-title">{t("uiResenasPositivas")}</span>
      <FancySlider min={0} max={100} step={5} value={score ?? 0} label={t("uiPorcentajeMinimoDeResenas")} format={n => n === 0 ? t("scoreNoMinimum") : `${n} %`}
        onChange={value => onChange({ minReviewScore: (value as number) === 0 ? undefined : value as number })} />
      <label className={"ga-sx-check" + (reviewsOn ? " is-on" : "")}>
        <input type="checkbox" checked={reviewsOn}
          onChange={event => onChange({ minReviewCount: event.target.checked ? MIN_REVIEWS_OPTION : undefined })} />
        {t("minReviewsOption", { n: MIN_REVIEWS_OPTION })}
      </label>
    </div>
  );
}

/** How recent: one slider, a year per step in the past and a month per step near the present. */
export function DatePanel({ filters, onChange }: { filters: LibrarySearchFilters; onChange: (patch: Partial<LibrarySearchFilters>) => void }) {
  const { t } = useI18n();
  const index = releaseIndexFor(filters.maxAgeDays);
  return (
    <div className="ga-sx-slider">
      <span className="ga-sx-slider-title">{t("uiLanzamiento")}</span>
      <FancySlider min={0} max={RELEASE_TRACK} step={1} value={RELEASE_POSITIONS[index]} label={t("uiCuantoHaceQueSalio")}
        format={n => releaseShort(RELEASE_STEPS[releaseIndexAt(n)])}
        onChange={value => onChange({ maxAgeDays: RELEASE_STEPS[releaseIndexAt(value as number)], releaseYearFrom: undefined, releaseYearTo: undefined })} />
    </div>
  );
}

/** Wipes one group of choices, and nothing else. */
export function ClearButton({ label, onClick, disabled }: { label?: string; onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <button type="button" className="ga-sx-clear" onClick={onClick} disabled={disabled}><Eraser size={13} aria-hidden="true" />{label ?? t("uiLimpiar")}</button>;
}

/** A name with its own + (I want it) and − (I don't) controls; pressing the active one clears it. */
export function PlusMinus({ label, state, onSet, disabled, title }: {
  label: string; state: TriState; onSet: (state: TriState) => void; disabled?: boolean; title?: string;
}) {
  return (
    <span className={`ga-sx-pmrow is-${state}`} title={title}>
      <span>{label}</span>
      <button type="button" className="ga-sx-pm is-include" aria-pressed={state === "include"} disabled={disabled} aria-label={translate("includeNamed", { name: label })}
        onClick={() => onSet(state === "include" ? "off" : "include")}><CirclePlus size={18} aria-hidden="true" /></button>
      <button type="button" className="ga-sx-pm is-exclude" aria-pressed={state === "exclude"} disabled={disabled} aria-label={translate("excludeNamed", { name: label })}
        onClick={() => onSet(state === "exclude" ? "off" : "exclude")}><CircleMinus size={18} aria-hidden="true" /></button>
    </span>
  );
}
