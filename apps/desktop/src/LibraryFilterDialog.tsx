import { useI18n } from "./i18n";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Lock, X } from "lucide-react";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";
import { useDialogFocus } from "./dialogFocus";
import TriStateOption, { type TriState } from "./TriStateOption";
import GenrePicker from "./GenrePicker";
import PlayersPicker from "./PlayersPicker";
import ExtrasPicker from "./ExtrasPicker";
import { buildFilterSentence } from "./filterSentence";
import { applyParentalPolicy } from "./parentalControl";
import { useParentalLocked } from "./ParentalControlSection";
import { DEFAULT_LIBRARY_FILTERS, MULTIPLAYER_OPTION_KEYS, CONTENT_FILTER_GROUPS, featureLabel, filterLibraryGames, gameIsSoftware, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
import type { CatalogGame } from "./types";
import { genreLabel } from "./libraryGenres";

/** Which filters group owns each criterion, and the positive/negative pair. */
const GROUPS = {
  genres: { include: "genres", exclude: "excludeGenres" },
  features: { include: "features", exclude: "excludeFeatures" },
  sources: { include: "sources", exclude: "excludeSources" },
} as const;
type GroupKey = keyof typeof GROUPS;

const LOCKED_TITLE = "Bloqueado por control parental";

/** Read one criterion's current direction. */
export function criterionState(filters: LibrarySearchFilters, group: GroupKey, value: string): TriState {
  const pair = GROUPS[group];
  const included = (filters[pair.include] ?? []) as string[];
  const excluded = (filters[pair.exclude] ?? []) as string[];
  if (excluded.includes(value)) return "exclude";
  if (included.includes(value)) return "include";
  return "off";
}

/** Move one criterion to a direction, clearing the other. */
export function setCriterionState(filters: LibrarySearchFilters, group: GroupKey, value: string, state: TriState): LibrarySearchFilters {
  const pair = GROUPS[group];
  const included = ((filters[pair.include] ?? []) as string[]).filter(item => item !== value);
  const excluded = ((filters[pair.exclude] ?? []) as string[]).filter(item => item !== value);
  if (state === "include") included.push(value);
  if (state === "exclude") excluded.push(value);
  return { ...filters, [pair.include]: included, [pair.exclude]: excluded } as LibrarySearchFilters;
}

export default function LibraryFilterDialog({ games, query, filters, genres, onApply }: {
  games: CatalogGame[]; query: string; filters: LibrarySearchFilters; genres: string[];
  onApply: (filters: LibrarySearchFilters) => void;
}) {
  const { t } = useI18n();
  const parentalLocked = useParentalLocked();
  const sourceNames = [...new Set(games.flatMap(game => game.download_source_names ?? []))].sort();
  const [draft, setDraft] = useState<LibrarySearchFilters>({ ...filters });
  const closeRef = useRef(() => onApply(draft));
  closeRef.current = () => onApply(draft);
  const {closing,close} = useOverlayClose(useCallback(() => closeRef.current(), []));
  const previousFocus = useRef(document.activeElement);
  useEffect(() => () => { if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true }); }, []);
  const ref = useDialogFocus(close);
  // The enforced policy is merged in, so the counts under a lock describe what
  // the user will actually get rather than what the raw filters would return.
  const effective = useMemo(() => applyParentalPolicy(draft), [draft]);
  const matches = filterLibraryGames(games, query, effective);
  // How many games each content group would actually reach, measured on the
  // catalog rather than shown from a tag count.
  const descriptorCount = (ids: number[]) =>
    games.filter(game => ids.some(id => (game.content_descriptorids ?? []).includes(id))).length;
  // "Solo un jugador" and "Admite multijugador" contradict each other, so
  // choosing one clears the other and disables the multiplayer tree.
  const singleOnlySelected = draft.features.includes("single_player");
  const multiplayerSelected = draft.features.includes("multiplayer");
  /** Any multiplayer option at all, which is what makes "Solo un jugador" contradictory. */
  const multiplayerModeSelected = multiplayerSelected
    || MULTIPLAYER_OPTION_KEYS.some(key => draft.features.includes(key));
  const multiplayerSelectedCount = (multiplayerSelected ? 1 : 0)
    + MULTIPLAYER_OPTION_KEYS.filter(key => draft.features.includes(key)).length;
  /** Everything the players section currently asks for. */
  const playersSelectedCount = multiplayerSelectedCount + (singleOnlySelected ? 1 : 0);
  /** How many catalog records the Software filter would reach. */
  const softwareCount = games.filter(gameIsSoftware).length;
  /** Adds or removes a tree option. The tree is positive-only: a checkbox is a requirement. */
  const toggleFeature = (key: LibraryFeatureKey) => setDraft(current => {
    const present = current.features.includes(key);
    let features = present ? current.features.filter(item => item !== key) : [...current.features, key];
    if (!present && key === "single_player") features = features.filter(item => item !== "multiplayer");
    if (!present && key === "multiplayer") features = features.filter(item => item !== "single_player");
    // Turning the parent off takes its children with it, or the tree would keep
    // filtering by options the panel shows as unavailable.
    if (present && key === "multiplayer") {
      features = features.filter(item => !MULTIPLAYER_OPTION_KEYS.includes(item));
    }
    return { ...current, features };
  });
  const set = (group: GroupKey, value: string, state: TriState) => setDraft(current => {
    const next = setCriterionState(current, group, value, state);
    if (group !== "features" || state === "off") return next;
    if (value === "single_player") return { ...next, features: next.features.filter(key => key !== "multiplayer") };
    if (value === "multiplayer") return { ...next, features: next.features.filter(key => key !== "single_player") };
    return next;
  });
  const sentence = buildFilterSentence(draft);
  const patch = (change: Partial<LibrarySearchFilters>) => setDraft(current => ({ ...current, ...change }));
  return createPortal(<div className={`ga-filter-backdrop${closing ? " is-closing" : ""}`} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <OverlayScreenDimmer panelRef={ref} />
    <section ref={ref} className="ga-filter-dialog ga-wizard" role="dialog" aria-modal="true" aria-labelledby="ga-filter-title">
      <header><div><span className="ga-detail-eyebrow">ENCONTRÁ TU PRÓXIMO JUEGO</span><h2 id="ga-filter-title">Filtros</h2></div><button type="button" aria-label="Cerrar filtros" onClick={close}><X /></button></header>
      <p className="ga-wiz-sentence" aria-live="polite">{sentence.map((part, index) => part.hl ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</p>
      <div className="ga-wiz-cols">
        <section className="ga-wiz-col" aria-labelledby="ga-wiz-h1">
          <h3 id="ga-wiz-h1"><i>1</i>Quiero encontrar {draft.software === true ? "programas" : "juegos"} de</h3>
          <GenrePicker genres={genres} stateOf={genre => criterionState(draft, "genres", genre)} onSet={(genre, state) => set("genres", genre, state)}
            footer={CONTENT_FILTER_GROUPS.map(group => {
              const chosen = draft.contentDescriptorIds?.some(id => group.descriptorIds.includes(id)) ?? false;
              return <label key={group.id} className={"ga-wiz-content" + (parentalLocked ? " is-locked" : "")} title={parentalLocked ? LOCKED_TITLE : "Filtra por la clasificación oficial de Valve, no por etiquetas de la comunidad"}>
                {parentalLocked ? <Lock size={13} aria-hidden="true" /> : null}
                <input type="checkbox" checked={chosen} disabled={parentalLocked}
                  onChange={event => patch({ contentDescriptorIds: event.target.checked ? [...group.descriptorIds] : undefined })} />
                <span>{group.label} <small>({descriptorCount(group.descriptorIds)})</small></span>
                {parentalLocked ? <small className="ga-filter-locked-note">{LOCKED_TITLE}</small> : null}
              </label>;
            })} />
        </section>
        <section className="ga-wiz-col" aria-labelledby="ga-wiz-h2">
          <h3 id="ga-wiz-h2"><i>2</i>Que sea</h3>
          <PlayersPicker filters={draft} onToggle={toggleFeature} />
        </section>
        <section className="ga-wiz-col" aria-labelledby="ga-wiz-h3">
          <h3 id="ga-wiz-h3"><i>3</i>Y además</h3>
          <ExtrasPicker draft={draft} onChange={patch} sourceNames={sourceNames}
            sourceState={name => criterionState(draft, "sources", name)} onSource={(name, state) => set("sources", name, state)}
            gameCount={games.length - softwareCount} softwareCount={softwareCount} />
        </section>
      </div>
      <footer><div role="status" aria-live="polite"><strong>{matches.length} {matches.length === 1 ? "juego" : "juegos"}</strong></div><button type="button" onClick={() => setDraft({ ...DEFAULT_LIBRARY_FILTERS })}>Limpiar todo</button><button type="button" className="ga-filter-apply" onClick={close}>Mostrar {matches.length} {matches.length === 1 ? "juego" : "juegos"}</button></footer>
    </section>
  </div>, document.body);
}

/** Chip text for one criterion. Genres are concept ids and show their Spanish label. */
function tagLabel(group: GroupKey, value: string): string {
  if (group === "features") return featureLabel(value as LibraryFeatureKey);
  return group === "genres" ? genreLabel(value) : value;
}

export function activeFilterTags(filters: LibrarySearchFilters): { group: GroupKey; value: string; label: string; direction: TriState }[] {
  const entries: { group: GroupKey; value: string; label: string; direction: TriState }[] = [];
  for (const group of Object.keys(GROUPS) as GroupKey[]) {
    const pair = GROUPS[group];
    for (const value of (filters[pair.include] ?? []) as string[]) {
      entries.push({ group, value, label: tagLabel(group, value), direction: "include" });
    }
    for (const value of (filters[pair.exclude] ?? []) as string[]) {
      // The label marks the direction, so a chip cannot be mistaken for its opposite.
      entries.push({ group, value, label: `sin ${tagLabel(group, value)}`, direction: "exclude" });
    }
  }
  return entries;
}
