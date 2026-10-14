import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CirclePlus, X } from "lucide-react";
import { useOverlayClose } from "./useOverlayClose";
import OverlayScreenDimmer from "./OverlayScreenDimmer";
import { useDialogFocus } from "./dialogFocus";
import TriStateOption, { type TriState } from "./TriStateOption";
import GenrePicker from "./GenrePicker";
import { PlayersPanel, ScorePanel, DatePanel, PlusMinus, ClearButton } from "./SentencePanels";
import { buildFilterSentence, sentenceText, type SentencePart, type SentenceSlot } from "./filterSentence";
import { applyParentalPolicy } from "./parentalControl";
import { useParentalLocked } from "./ParentalControlSection";
import { DEFAULT_LIBRARY_FILTERS, MULTIPLAYER_OPTION_KEYS, CONTENT_FILTER_GROUPS, featureLabel, filterLibraryGames, type LibraryFeatureKey, type LibrarySearchFilters } from "./librarySearch";
import type { CatalogGame } from "./types";
import { genreLabel } from "./libraryGenres";
import { getAllAvailableSourceNames } from "./catalog/PluginSources";

/** Which filters group owns each criterion, and the positive/negative pair. */
const GROUPS = {
  genres: { include: "genres", exclude: "excludeGenres" },
  features: { include: "features", exclude: "excludeFeatures" },
  sources: { include: "sources", exclude: "excludeSources" },
} as const;
type GroupKey = keyof typeof GROUPS;

/** Keeps a term together with the punctuation that follows it, so a comma never starts a line. */
function glueTerms(parts: SentencePart[]): SentencePart[][] {
  const groups: SentencePart[][] = [];
  for (const part of parts) {
    if (!part.slot && /^\u2060?[,.)]/.test(part.text) && groups.length) groups[groups.length - 1].push(part);
    else groups.push([part]);
  }
  return groups;
}

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
  const parentalLocked = useParentalLocked();
  const sourceNames = [...new Set([...games.flatMap(game => game.download_source_names ?? []), ...getAllAvailableSourceNames()])].sort();
  const [draft, setDraft] = useState<LibrarySearchFilters>({ ...filters });
  /** The sentence term whose editor is open under it. */
  const [open, setOpen] = useState<SentenceSlot | null>(null);
  const closeRef = useRef(() => onApply(draft));
  closeRef.current = () => onApply(draft);
  const {closing,close} = useOverlayClose(useCallback(() => closeRef.current(), []));
  const previousFocus = useRef(document.activeElement);
  useEffect(() => () => { if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true }); }, []);
  const ref = useDialogFocus(close);
  // The enforced policy is merged in, so the count describes what the user will actually get.
  const effective = useMemo(() => applyParentalPolicy(draft), [draft]);
  const matches = filterLibraryGames(games, query, effective);
  /** Adds or removes a multiplayer option. Single player and multiplayer exclude each other. */
  const toggleFeature = (key: LibraryFeatureKey) => setDraft(current => {
    const present = current.features.includes(key);
    let features = present ? current.features.filter(item => item !== key) : [...current.features, key];
    if (!present && key === "single_player") features = features.filter(item => item !== "multiplayer" && !MULTIPLAYER_OPTION_KEYS.includes(item));
    if (!present && key === "multiplayer") features = features.filter(item => item !== "single_player");
    // Turning multiplayer off takes its modes with it, or they would keep filtering unseen.
    if (present && key === "multiplayer") features = features.filter(item => !MULTIPLAYER_OPTION_KEYS.includes(item));
    // Picking a mode implies multiplayer.
    if (!present && MULTIPLAYER_OPTION_KEYS.includes(key) && !features.includes("multiplayer")) features = [...features.filter(item => item !== "single_player"), "multiplayer"];
    return { ...current, features };
  });
  const set = (group: GroupKey, value: string, state: TriState) => setDraft(current => setCriterionState(current, group, value, state));
  const patch = (change: Partial<LibrarySearchFilters>) => setDraft(current => ({ ...current, ...change }));
  const sentence = buildFilterSentence(draft);
  const pickTerm = (slot: SentenceSlot) => {
    if (slot === "kind") { patch({ software: draft.software === true ? false : true }); return; }
    setOpen(current => current === slot ? null : slot);
  };
  /** Open editors appear above the sentence for its first line and below it for the second. */
  const topOpen = open === "genres" || open === "players";
  const clearPlayers = () => setDraft(current => ({ ...current,
    features: current.features.filter(item => item !== "single_player" && item !== "multiplayer" && !MULTIPLAYER_OPTION_KEYS.includes(item)) }));
  const setAllSources = (state: TriState) => setDraft(current => ({ ...current,
    sources: state === "include" ? [...sourceNames] : [], excludeSources: [] }));
  const adultGroup = CONTENT_FILTER_GROUPS[0];
  const adultState: TriState = draft.excludeContentDescriptorIds?.some(id => adultGroup.descriptorIds.includes(id)) ? "exclude"
    : draft.contentDescriptorIds?.some(id => adultGroup.descriptorIds.includes(id)) ? "include" : "off";
  const setAdult = (state: TriState) => patch({
    contentDescriptorIds: state === "include" ? [...adultGroup.descriptorIds] : undefined,
    excludeContentDescriptorIds: state === "exclude" ? [...adultGroup.descriptorIds] : undefined,
  });
  return createPortal(<div className={`ga-filter-backdrop${closing ? " is-closing" : ""}`} onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
    <OverlayScreenDimmer panelRef={ref} />
    <section ref={ref} className="ga-filter-dialog ga-wizard" role="dialog" aria-modal="true" aria-labelledby="ga-filter-title">
      <header><h2 id="ga-filter-title">Filtros</h2><button type="button" aria-label="Cerrar filtros" onClick={close}><X /></button></header>
      <div className="ga-sx-body">
        <div className="ga-sx-zone is-top" data-open={topOpen ? open : "none"}>
          {open === "genres" ? <div className="ga-sx-panel"><GenrePicker genres={genres} stateOf={genre => criterionState(draft, "genres", genre)} onSet={(genre, state) => set("genres", genre, state)}
            onClear={() => patch({ genres: [], excludeGenres: [] })} /></div> : null}
          {open === "players" ? <div className="ga-sx-panel"><PlayersPanel filters={draft} onToggle={toggleFeature} onClear={clearPlayers} /></div> : null}
        </div>
        <p className="ga-sx-sentence" aria-live="polite" aria-label={sentenceText(sentence)}>
          {sentence.map((line, row) => <span key={row} className="ga-sx-line">{glueTerms(line).map((group, g) => <span key={g} className="ga-sx-grp">{group.map((part, index) => part.slot
            ? <button key={index} type="button" className={"ga-sx-term" + (open === part.slot ? " is-open" : "")} aria-expanded={part.slot === "kind" ? undefined : open === part.slot}
              onClick={() => pickTerm(part.slot as SentenceSlot)}>{part.text}</button>
            : <span key={index}>{part.text.replaceAll("\u2060", "")}</span>)}</span>)}</span>)}
        </p>
        <div className="ga-sx-zone is-bottom" data-open={open && !topOpen ? open : "none"}>
          {open === "score" ? <div className="ga-sx-panel"><ScorePanel filters={draft} onChange={patch} /></div> : null}
          {open === "date" ? <div className="ga-sx-panel"><DatePanel filters={draft} onChange={patch} /></div> : null}
          {open === null ? <p className="ga-sx-tip">Tocá lo subrayado para cambiarlo.</p> : null}
        </div>
      </div>
      <div className="ga-sx-extras">
        <div className="ga-sx-extra">
          <span className="ga-sx-extra-title">Contenido para adultos</span>
          <PlusMinus label={parentalLocked ? "Bloqueado por control parental" : adultState === "include" ? "Sí" : adultState === "exclude" ? "No" : "Me da igual"} state={parentalLocked ? "exclude" : adultState} disabled={parentalLocked} title={parentalLocked ? LOCKED_TITLE : undefined} onSet={setAdult} />
        </div>
        {sourceNames.length ? <div className="ga-sx-extra">
          <span className="ga-sx-extra-title">Fuentes de descarga</span>
          <span className="ga-sx-bulk"><button type="button" className="ga-sx-clear" onClick={() => setAllSources("include")}><CirclePlus size={13} aria-hidden="true" />Todas</button><ClearButton label="Ninguna" onClick={() => setAllSources("off")} /></span>
          <div className="ga-sx-sources">{sourceNames.map(name => <PlusMinus key={name} label={name} state={criterionState(draft, "sources", name)} onSet={state => set("sources", name, state)} />)}</div>
        </div> : null}
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

export type FilterTagGroup = GroupKey | "rating" | "age";

export function activeFilterTags(filters: LibrarySearchFilters): { group: FilterTagGroup; value: string; label: string; direction: TriState }[] {
  const entries: { group: FilterTagGroup; value: string; label: string; direction: TriState }[] = [];
  if (filters.minReviewScore !== undefined) {
    entries.push({ group: "rating", value: "rating", label: `Rating ≥ ${Math.round(filters.minReviewScore / 10)}`, direction: "include" });
  }
  if (filters.maxAgeDays !== undefined) {
    const years = Math.round(filters.maxAgeDays / 365);
    entries.push({ group: "age", value: "age", label: years === 1 ? "Último año" : `≤ ${years} años`, direction: "include" });
  }
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
