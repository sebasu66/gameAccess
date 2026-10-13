import { useI18n } from "./i18n";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Lock, X } from "lucide-react";
import CircularScrollbar from "./CircularScrollbar";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";
import { useDialogFocus } from "./dialogFocus";
import TriStateOption, { type TriState } from "./TriStateOption";
import MultiplayerParentOption from "./MultiplayerParentOption";
import QualitySliders from "./QualitySliders";
import { applyParentalPolicy } from "./parentalControl";
import { useParentalLocked } from "./ParentalControlSection";
import { DEFAULT_LIBRARY_FILTERS, MULTIPLAYER_BRANCHES, MULTIPLAYER_OPTION_KEYS, CONTENT_FILTER_GROUPS, featureLabel, filterLibraryGames, gameIsSoftware, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
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
  const scrollRef = useRef<HTMLDivElement>(null);
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
  /** Drafts carrying user selections in either direction, for the group counters. */
  const selectedCount = (group: GroupKey) => {
    const pair = GROUPS[group];
    const included = (draft[pair.include] ?? []) as string[];
    const excluded = (draft[pair.exclude] ?? []) as string[];
    return included.length + excluded.length;
  };
  const renderOptions = (group: GroupKey, values: { value: string; label: string; hint?: string }[], options: { locked?: boolean; disabled?: boolean; disableValue?: string } = {}) =>
    <div className="ga-filter-choices">{values.map(({ value, label, hint }) => {
      // The option that contradicts the current selection reads as disabled too.
      const contradicting = options.disabled || (options.disableValue !== undefined && value === options.disableValue);
      return <TriStateOption
        key={value}
        label={label}
        hint={hint}
        disabled={contradicting}
        disabledTitle={options.disabled ? "No aplica a \"Solo un jugador\"" : "Contradice \"Solo un jugador\""}
        state={options.locked ? "exclude" : criterionState(draft, group, value)}
        locked={options.locked}
        lockedTitle={LOCKED_TITLE}
        onSet={state => set(group, value, state)}
      />;
    })}</div>;
  return createPortal(<div className={`ga-filter-backdrop${closing ? " is-closing" : ""}`} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <OverlayScreenDimmer panelRef={ref} />
    <section ref={ref} className="ga-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="ga-filter-title">
      <header><div><span className="ga-detail-eyebrow">ENCONTRÁ TU PRÓXIMO JUEGO</span><h2 id="ga-filter-title">Filtros</h2></div><button type="button" aria-label="Cerrar filtros" onClick={close}><X /></button></header>
      <p>Usá <strong>+</strong> para exigir un criterio y <strong>−</strong> para excluirlo: "aventura, pero no rol". Los grupos se combinan.</p>
      <div className="ga-scroll-frame ga-filter-scroll-frame"><div ref={scrollRef} className="ga-filter-groups">
        <details className="ga-filter-accordion"><summary>Géneros <small>{selectedCount("genres") || ""}</small></summary>{renderOptions("genres", genres.map(genre => ({ value: genre, label: genreLabel(genre) })))}</details>
        {CONTENT_FILTER_GROUPS.map(group => {
          const chosen = draft.contentDescriptorIds?.some(id => group.descriptorIds.includes(id)) ?? false;
          return <details className={"ga-filter-accordion" + (parentalLocked ? " is-parental-locked" : "")} key={group.id}>
            <summary title={parentalLocked ? LOCKED_TITLE : undefined}>
              {parentalLocked ? <Lock size={12} aria-hidden="true" /> : null}
              {group.label} <small>{chosen ? "1" : ""}</small>
              {parentalLocked ? <small className="ga-filter-locked-note">{LOCKED_TITLE}</small> : null}
            </summary>
            <div className="ga-filter-choices">
              <label title="Filtra por la clasificación oficial de Valve, no por etiquetas de la comunidad">
                <input type="checkbox" checked={chosen} disabled={parentalLocked}
                  onChange={event => setDraft(current => ({
                    ...current,
                    contentDescriptorIds: event.target.checked ? [...group.descriptorIds] : undefined,
                  }))} />
                {group.label}
                <small>({descriptorCount(group.descriptorIds)})</small>
              </label>
            </div>
          </details>;
        })}
        {sourceNames.length > 0 && <details className="ga-filter-accordion"><summary>{t("sourcesFilter")} <small>{selectedCount("sources") || ""}</small></summary>{renderOptions("sources", sourceNames.map(name => ({ value: name, label: name })))}</details>}
        <details className="ga-filter-accordion" open>
          <summary>Jugadores <small>{playersSelectedCount || ""}</small></summary>
          <div className="ga-tree">
            {/* One section, two halves that mirror each other: the restrictive
                "single-player only" and the inclusive "admits multiplayer" with
                everything that hangs off it. */}
            <label className={"ga-tree-parent" + (draft.features.includes("single_player") ? " is-selected" : "") + (multiplayerModeSelected ? " is-branch-disabled" : "")}
              title={multiplayerModeSelected ? "Contradice la selección de multijugador" : "Juegos que no tienen multijugador"}>
              <input type="checkbox" checked={draft.features.includes("single_player")} disabled={multiplayerModeSelected}
                onChange={() => toggleFeature("single_player")} />
              <strong>Solo un jugador</strong>
              <small>Sin multijugador de ningún tipo</small>
            </label>
            <MultiplayerParentOption
              selected={draft.features.includes("multiplayer")}
              disabled={singleOnlySelected}
              onToggle={() => toggleFeature("multiplayer")}
            />
            {MULTIPLAYER_BRANCHES.map(branch => {
              const chosen = branch.options.filter(option => draft.features.includes(option.key)).length;
              // A branch cannot be picked when its parent is off: the options
              // only mean something for a game that admits multiplayer.
              const off = singleOnlySelected || !draft.features.includes("multiplayer");
              return <fieldset className={"ga-tree-branch" + (off ? " is-branch-disabled" : "")} key={branch.id} disabled={off}>
                <legend>{branch.label} {chosen ? <small>{chosen}</small> : null}</legend>
                {branch.hint ? <p className="ga-tree-hint">{branch.hint}</p> : null}
                {branch.options.map(option => <label key={option.key} title={off ? "Activá \"Admite multijugador\" primero" : undefined}>
                  <input type="checkbox" checked={draft.features.includes(option.key)} onChange={() => toggleFeature(option.key)} />
                  {option.label}
                </label>)}
              </fieldset>;
            })}
          </div>
        </details>
        {/* One choice, two universes. A program has no PvP, no LAN and no story
            mode, so searching both at once would put records on screen that most
            of the other filters cannot describe. */}
        <details className="ga-filter-accordion" open>
          <summary>Qué buscás</summary>
          <div className="ga-filter-choices">
            <label>
              <input type="radio" name="ga-content-kind" checked={draft.software !== true}
                onChange={() => setDraft(current => ({ ...current, software: false }))} />
              Juegos
              <small>({games.length - softwareCount})</small>
            </label>
            <label title="Blender, OBS Studio, Godot Engine y similares: software que Steam lista dentro del catálogo de juegos">
              <input type="radio" name="ga-content-kind" checked={draft.software === true}
                onChange={() => setDraft(current => ({ ...current, software: true }))} />
              Programas
              <small>({softwareCount})</small>
            </label>
          </div>
          {draft.software === true ? <p className="ga-tree-hint">Los programas no tienen PvP, ni LAN, ni modo historia: los demás filtros no se aplican.</p> : null}
        </details>
      </div><CircularScrollbar targetRef={scrollRef} label="Desplazar opciones de filtros" /></div>
      <QualitySliders draft={draft} onChange={patch => setDraft(current => ({ ...current, ...patch }))} />
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
