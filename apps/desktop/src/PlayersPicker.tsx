import { Globe, Handshake, Network, Swords, Tv, User, Users, type LucideIcon } from "lucide-react";
import { MULTIPLAYER_BRANCHES, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";

const OPTION_ICONS: Partial<Record<LibraryFeatureKey, LucideIcon>> = {
  coop: Handshake, pvp: Swords, shared_split_screen: Tv, lan: Network, online_multiplayer: Globe, mmo: Users,
};

/**
 * Step 2 of the filter wizard: single player or multiplayer. Multiplayer opens
 * into its own requirements, which only mean something once it is chosen.
 */
export default function PlayersPicker({ filters, onToggle }: {
  filters: LibrarySearchFilters;
  onToggle: (key: LibraryFeatureKey) => void;
}) {
  const single = filters.features.includes("single_player");
  const multi = filters.features.includes("multiplayer");
  return (
    <div className="ga-wiz-players">
      <button type="button" className={"ga-wiz-card" + (single ? " is-on" : "")} aria-pressed={single}
        onClick={() => onToggle("single_player")}>
        <User size={22} aria-hidden="true" />
        <span><strong>Solo un jugador</strong><small>Sin multijugador de ningún tipo</small></span>
      </button>
      <button type="button" className={"ga-wiz-card" + (multi ? " is-on" : "")} aria-pressed={multi} aria-expanded={multi}
        onClick={() => onToggle("multiplayer")}>
        <Users size={22} aria-hidden="true" />
        <span><strong>Admite multijugador</strong><small>Elegí cómo querés jugar con otros</small></span>
      </button>
      {multi ? <div className="ga-wiz-branches">
        {MULTIPLAYER_BRANCHES.map(branch => <fieldset key={branch.id}>
          <legend>{branch.label}</legend>
          {branch.hint ? <p className="ga-wiz-hint">{branch.hint}</p> : null}
          <div className="ga-wiz-chips">
            {branch.options.map(option => {
              const on = filters.features.includes(option.key);
              const Icon = OPTION_ICONS[option.key] ?? Users;
              return <button key={option.key} type="button" className={"ga-wiz-chip" + (on ? " is-on" : "")} aria-pressed={on}
                onClick={() => onToggle(option.key)}><Icon size={15} aria-hidden="true" />{option.label}</button>;
            })}
          </div>
        </fieldset>)}
      </div> : null}
    </div>
  );
}
