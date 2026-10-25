import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CirclePlus, Download } from "lucide-react";
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
import { queryCatalogCache } from "./catalogCache";
import { catalogParamsFromFilters, useCatalogGenreNames } from "./catalogFilterParams";
import { genreLabel } from "./libraryGenres";
import { getAllAvailableSourceNames } from "./catalog/PluginSources";
import { useI18n, translate } from "./i18n";
import { GaClose } from "./components/ga/Buttons";

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

/** Height each editor needs, so the sentence can make room by moving. */
const ZONE_HEIGHT: Record<SentenceSlot, number> = { genres: 250, players: 190, score: 196, date: 96 };

const lockedTitle = () => translate("filterLockedByParental");

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

/** Brings the real mouse pointer to a spot in the window (desktop app only; elsewhere it does nothing). */
async function moveMouseTo(x: number, y: number) {
  try {
    const { getCurrentWindow, LogicalPosition } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setCursorPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  } catch { /* running in a plain browser */ }
}

export default function LibraryFilterDialog({ games, query, filters, genres, onApply, countFromCatalog = false }: {
  games: CatalogGame[]; query: string; filters: LibrarySearchFilters; genres: string[];
  /** Count against the whole catalog (the same query the grid uses), not only the games loaded in memory. */
  countFromCatalog?: boolean;
  onApply: (filters: LibrarySearchFilters) => void;
}) {
  const { t } = useI18n();
  const parentalLocked = useParentalLocked();
  const sourceNames = [...new Set([...games.flatMap(game => game.download_source_names ?? []), ...getAllAvailableSourceNames()])].sort();
  const [draft, setDraft] = useState<LibrarySearchFilters>({ ...filters });
  /** The sentence term whose editor is open under it. */
  const [open, setOpen] = useState<SentenceSlot | null>(null);
  const closeRef = useRef(() => onApply(draft));
  // Programs (Blender, OBS…) are never offered: the library is always games only.
  closeRef.current = () => onApply({ ...draft, software: false });
  const {closing,close} = useOverlayClose(useCallback(() => closeRef.current(), []));
  const previousFocus = useRef(document.activeElement);
  useEffect(() => () => { if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true }); }, []);
  const ref = useDialogFocus(close);
  // The enforced policy is merged in, so the count describes what the user will actually get.
  const effective = useMemo(() => applyParentalPolicy(draft), [draft]);
  const localCount = useMemo(() => countFromCatalog ? 0 : filterLibraryGames(games, query, effective).length, [countFromCatalog, games, query, effective]);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const genreNames = useCatalogGenreNames();
  useEffect(() => {
    if (!countFromCatalog) return;
    let current = true;
    const timer = window.setTimeout(() => {
      queryCatalogCache({ ...catalogParamsFromFilters(query, effective, genreNames), limit: 1 })
        .then(result => { if (current) setCatalogCount(result.total); })
        .catch(() => { if (current) setCatalogCount(null); });
    }, 150);
    return () => { current = false; window.clearTimeout(timer); };
  }, [countFromCatalog, query, effective, genreNames]);
  const matchCount = countFromCatalog ? catalogCount ?? 0 : localCount;
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
    setOpen(current => current === slot ? null : slot);
  };
  /** Open editors appear above the sentence for its first line and below it for the second. */
  const topOpen = open === "genres" || open === "players";
  const bottomOpen = open === "score" || open === "date";
  /** The last editor shown, kept while its zone closes so it does not vanish mid-animation. */
  const lastShown = useRef<SentenceSlot | null>(null);
  if (open) lastShown.current = open;
  const shown = open ?? lastShown.current;
  const bodyRef = useRef<HTMLDivElement>(null);
  // An open editor tidies itself away: when the pointer leaves it, or when nothing happens for a while.
  // Opening a slider also brings the mouse to its handle, so it can be moved straight away.
  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (!body) return;
    const isSlider = open === "score" || open === "date";
    const idleMs = isSlider ? 2200 : 6000;
    let idle: number | undefined;
    let leave: number | undefined;
    const hide = () => setOpen(current => current === open ? null : current);
    const restartIdle = () => { window.clearTimeout(idle); idle = window.setTimeout(hide, idleMs); };
    const inside = (target: EventTarget | null) => target instanceof Element && !!target.closest(".ga-sx-zone.is-open, .ga-sx-term.is-open");
    const onActivity = (event: Event) => {
      if (inside(event.target)) { window.clearTimeout(leave); leave = undefined; restartIdle(); return; }
      const pressed = event instanceof MouseEvent && event.buttons > 0;
      if (event.type === "pointermove" && !pressed && leave === undefined) leave = window.setTimeout(hide, 700);
    };
    const events = ["pointermove", "pointerdown", "keydown", "input", "wheel"] as const;
    events.forEach(name => body.addEventListener(name, onActivity, true));
    restartIdle();
    let warp: number | undefined;
    if (isSlider) warp = window.setTimeout(() => {
      const input = body.querySelector<HTMLInputElement>(".ga-sx-zone.is-open input[type=range]");
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const fraction = (Number(input.value) - Number(input.min)) / ((Number(input.max) - Number(input.min)) || 1);
      void moveMouseTo(rect.left + 12 + (rect.width - 24) * fraction, rect.top + rect.height / 2);
    }, 420);
    return () => {
      window.clearTimeout(idle); window.clearTimeout(leave); window.clearTimeout(warp);
      events.forEach(name => body.removeEventListener(name, onActivity, true));
    };
  }, [open]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesChosen = (draft.sources?.length ?? 0) + (draft.excludeSources?.length ?? 0) > 0;
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
      <header>
        <h2 id="ga-filter-title">{t("uiFiltros")}</h2>
        <div className="ga-sx-corner">
          <div className="ga-sx-chipwrap">
            <span className={"ga-sx-cat" + (draft.features.includes("has_downloads") || sourcesChosen ? " is-on" : "") + (sourcesOpen ? " is-open" : "")}>
              <button type="button" className="ga-sx-cat-main" aria-pressed={draft.features.includes("has_downloads")}
                title={t("uiPedirQueElJuego")} onClick={() => toggleFeature("has_downloads")}><Download size={14} aria-hidden="true" />{t("uiFuentesDeDescarga")}</button>
              <button type="button" className="ga-sx-cat-more" aria-expanded={sourcesOpen} aria-label={t("uiElegirFuentesUnaPor")} onClick={() => setSourcesOpen(value => !value)}><ChevronDown size={15} aria-hidden="true" /></button>
            </span>
            {sourcesOpen ? <div className="ga-sx-pop" role="group" aria-label={t("uiFuentesDeDescarga")}>
              <div className="ga-sx-bulk"><button type="button" className="ga-sx-clear" onClick={() => setAllSources("include")}><CirclePlus size={13} aria-hidden="true" />{t("uiTodas")}</button><ClearButton label={t("uiNinguna")} onClick={() => setAllSources("off")} /></div>
              {sourceNames.length === 0 ? <p className="ga-sx-tip">{t("uiTodaviaNoImportasteFuentes")}</p>
                : <div className="ga-sx-sources">{sourceNames.map(name => <PlusMinus key={name} label={name} state={criterionState(draft, "sources", name)} onSet={state => set("sources", name, state)} />)}</div>}
            </div> : null}
          </div>
          <span className={"ga-sx-cat is-adult" + (adultState !== "off" ? " is-on" : "")} title={parentalLocked ? lockedTitle() : undefined}>
            <PlusMinus label={t("uiContenidoAdulto")} state={parentalLocked ? "exclude" : adultState} disabled={parentalLocked} onSet={setAdult} />
          </span>
          <GaClose label={t("uiCerrarFiltros")} onClick={close} />
        </div>
      </header>
      <div className={"ga-sx-body" + (topOpen || bottomOpen ? " has-open" : "")} ref={bodyRef}>
        <div className={"ga-sx-zone is-top" + (topOpen ? " is-open" : "")} style={{ ["--zone-h" as string]: `${ZONE_HEIGHT[shown ?? "genres"]}px` }}>
          {topOpen && shown === "genres" ? <div className="ga-sx-panel"><GenrePicker genres={genres} stateOf={genre => criterionState(draft, "genres", genre)} onSet={(genre, state) => set("genres", genre, state)}
            onClear={() => patch({ genres: [], excludeGenres: [] })} /></div> : null}
          {(topOpen || shown === "players") && shown === "players" ? <div className="ga-sx-panel"><PlayersPanel filters={draft} onToggle={toggleFeature} onClear={clearPlayers} /></div> : null}
        </div>
        <p className="ga-sx-sentence" aria-live="polite" aria-label={sentenceText(sentence)}>
          {sentence.map((line, row) => <span key={row} className="ga-sx-line">{glueTerms(line).map((group, g) => <span key={g} className="ga-sx-grp">{group.map((part, index) => part.slot
            ? <button key={index} type="button" className={"ga-sx-term" + (open === part.slot ? " is-open" : "")} aria-expanded={open === part.slot}
              onClick={() => pickTerm(part.slot as SentenceSlot)}>{part.text}</button>
            : <span key={index}>{part.text.replaceAll("\u2060", "")}</span>)}</span>)}</span>)}
        </p>
        <div className={"ga-sx-zone is-bottom" + (bottomOpen ? " is-open" : "")} style={{ ["--zone-h" as string]: `${ZONE_HEIGHT[shown ?? "score"]}px` }}>
          {shown === "score" ? <div className="ga-sx-panel is-bare"><ScorePanel filters={draft} onChange={patch} /></div> : null}
          {shown === "date" ? <div className="ga-sx-panel is-bare"><DatePanel filters={draft} onChange={patch} /></div> : null}
        </div>
        <p className={"ga-sx-tip" + (open === null ? " is-shown" : "")}>{t("uiTocaLoSubrayadoPara")}</p>
      </div>
      <footer><div role="status" aria-live="polite"><strong>{t(matchCount === 1 ? "gamesCountOne" : "gamesCountMany", { count: matchCount })}</strong></div><button type="button" onClick={() => setDraft({ ...DEFAULT_LIBRARY_FILTERS })}>{t("uiLimpiarTodo")}</button><button type="button" className="ga-filter-apply" onClick={close}>{t(matchCount === 1 ? "filterShowOne" : "filterShowMany", { count: matchCount })}</button></footer>
    </section>
  </div>, document.body);
}

/** Chip text for one criterion. Genres are concept ids and show their Spanish label. */
function tagLabel(group: GroupKey, value: string): string {
  if (group === "features") return featureLabel(value as LibraryFeatureKey);
  return group === "genres" ? genreLabel(value) : value;
}

export type FilterTagGroup = GroupKey | "rating" | "reviews" | "age";

export function activeFilterTags(filters: LibrarySearchFilters): { group: FilterTagGroup; value: string; label: string; direction: TriState }[] {
  const entries: { group: FilterTagGroup; value: string; label: string; direction: TriState }[] = [];
  if (filters.minReviewScore !== undefined) {
    entries.push({ group: "rating", value: "rating", label: translate("filterTagRating", { n: Math.round(filters.minReviewScore / 10) }), direction: "include" });
  }
  if (filters.minReviewCount !== undefined) {
    entries.push({ group: "reviews", value: "reviews", label: translate("filterTagMinReviews", { n: filters.minReviewCount }), direction: "include" });
  }
  if (filters.maxAgeDays !== undefined) {
    const years = Math.round(filters.maxAgeDays / 365);
    entries.push({ group: "age", value: "age", label: years === 1 ? translate("filterTagLastYear") : translate("filterTagYears", { years }), direction: "include" });
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
