import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Download, Play, Snowflake } from "lucide-react";
import { Flip, gsap, motionOk } from "./motion/gsap";
import { gameStateManager } from "./GameStateManager";
import { useI18n } from "./i18n";
import { useLibraryScan } from "./libraryScan";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import SteamCover from "./SteamCover";
import { downloadManager } from "./downloadManager";
import { bentoLayout, bentoRowHeight, type BentoKind } from "./bentoLayout";
import type { DownloadMap } from "./LibraryRoomParts";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";
import "./library-bento.css";

const GAP = 14;
const landscape = (game: CatalogGame) => game.app_id ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.app_id}/header.jpg` : game.header_image ?? game.capsule_image ?? "";
export type LibraryPill = "all" | "installed" | "favorites";

interface Props {
  games: CatalogGame[];
  downloads: DownloadMap;
  preferences?: Record<number, 1 | -1>;
  pill: LibraryPill;
  indexes: Map<number, number>;
  selectedId?: number;
  onSelect: (index: number, openDetails?: boolean) => void;
  onContextMenu: (request: { game: CatalogGame; x: number; y: number; status?: ManagedDownloadStatus }) => void;
}

interface Card { game: CatalogGame; kind: BentoKind; frozen?: LibraryGame["frozen"]; status?: ManagedDownloadStatus }

const BentoCard = memo(function BentoCard({ card, index, selected, onSelect, onContextMenu }: { card: Card; index: number; selected: boolean; onSelect: Props["onSelect"]; onContextMenu: Props["onContextMenu"] }) {
  const { t } = useI18n();
  const { game, kind, frozen, status } = card;
  const active = gameStateManager.resolve(status).transferActive;
  const progress = active ? downloadManager.progress(status) : 0;
  return (
    <button
      type="button"
      className="ga-bento-card"
      data-kind={kind}
      data-frozen={frozen || undefined}
      data-library-game-id={game.id}
      aria-current={selected ? "true" : undefined}
      aria-label={`${game.name}${kind === "ready" ? t("cardAriaReady") : ""}${frozen ? ` · ${t(frozen === "deep" ? "bentoDeepFrozen" : "bentoFrozen")}` : ""}`}
      onFocus={() => onSelect(index, false)}
      onClick={() => onSelect(index)}
      onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => { event.preventDefault(); onSelect(index, false); onContextMenu({ game, x: event.clientX, y: event.clientY, status }); }}
    >
      {kind === "ready" ? <span className="ga-bento-cover"><SteamCover game={game} /></span> : <img className="ga-bento-landscape" src={landscape(game)} alt="" loading="lazy" />}
      {kind === "ready" ? <span className="ga-card-installed ga-bento-play" aria-hidden="true"><Play size={12} fill="currentColor" /></span> : null}
      {frozen && kind !== "deep" ? <span className="ga-bento-frost" title={t("bentoFrozen")} aria-hidden="true"><Snowflake size={15} /></span> : null}
      {kind === "deep" ? <span className="ga-bento-ice" aria-hidden="true"><Snowflake size={20} /><span>{t("bentoIce")}</span></span> : null}
      <span className="ga-bento-name"><span>{game.name}</span>{kind === "pending" ? <Download size={15} aria-hidden="true" /> : kind === "deep" ? <Snowflake size={15} aria-hidden="true" /> : null}</span>
      {active ? <span className="ga-bento-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress / 100})` }} /></span> : null}
    </button>
  );
});

/**
 * The library as a bento grid (docs/TAREA-interfaz-nueva.md T7): installed games in portrait, games to install in
 * small landscape, deep-frozen ones grouped on the right with an ice veil. Removed games shrink in their place before
 * the rest move with Flip; a finished download grows from landscape to portrait.
 */
export default function LibraryBento({ games, downloads, preferences = {}, pill, indexes, selectedId, onSelect, onContextMenu }: Props) {
  const { t } = useI18n();
  const scan = useLibraryScan();
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [rowHeight, setRowHeight] = useState(84);

  const cards = useMemo<Card[]>(() => {
    const entries = new Map(scan.games.map(entry => [entry.app_id, entry]));
    return games.flatMap(game => {
      const status = (game.app_id ? downloads[game.app_id] : undefined) ?? downloads[game.id];
      const state = gameStateManager.resolve(status);
      const entry = game.app_id ? entries.get(game.app_id) : undefined;
      const installed = state.installed || state.prepared || Boolean(entry?.installed);
      if (pill === "installed" && !installed) return [];
      if (pill === "favorites" && preferences[game.id] !== 1) return [];
      const kind: BentoKind = installed ? (entry?.frozen === "deep" ? "deep" : "ready") : "pending";
      return [{ game, kind, frozen: installed ? entry?.frozen : undefined, status }];
    });
  }, [games, downloads, scan.games, pill, preferences]);

  // Columns and row height follow the grid width: three landscape rows are as tall as one portrait.
  useLayoutEffect(() => {
    const host = grid.current;
    if (!host) return;
    const measure = () => {
      const width = host.clientWidth;
      const cols = Math.max(1, Math.floor((width + GAP) / (180 + GAP)));
      const columnWidth = (width - GAP * (cols - 1)) / cols;
      setColumns(cols);
      setRowHeight(bentoRowHeight(columnWidth, GAP));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    return () => observer?.disconnect();
  }, []);

  const placed = useMemo(() => bentoLayout(cards.map(card => ({ kind: card.kind, value: card })), columns), [cards, columns]);

  // Leaving cards stay one moment to shrink in place; then the rest move to their new slots.
  const [leaving, setLeaving] = useState<Array<{ card: Card; style: CSSProperties }>>([]);
  const lastPlaced = useRef(placed);
  const flipState = useRef<Flip.FlipState | null>(null);
  if (grid.current && motionOk()) flipState.current = Flip.getState(grid.current.querySelectorAll(".ga-bento-slot:not([data-leaving]) > .ga-bento-card"));
  useEffect(() => {
    const now = new Set(placed.map(item => item.value.game.id));
    const gone = lastPlaced.current.filter(item => !now.has(item.value.game.id));
    lastPlaced.current = placed;
    if (!gone.length || !motionOk()) return;
    setLeaving(gone.map(item => ({ card: item.value, style: { gridColumn: item.column, gridRow: `${item.row} / span ${item.rowSpan}` } })));
  }, [placed]);
  useLayoutEffect(() => {
    if (!flipState.current || !grid.current) return;
    Flip.from(flipState.current, { targets: grid.current.querySelectorAll(".ga-bento-slot:not([data-leaving]) > .ga-bento-card"), duration: .6, ease: "expo.inOut", absolute: true, delay: leaving.length ? .25 : 0,
      onEnter: elements => gsap.fromTo(elements, { opacity: 0, scale: .85 }, { opacity: 1, scale: 1, duration: .45, ease: "power3.out" }) });
    flipState.current = null;
  }, [placed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leaving.length || !grid.current) return;
    const nodes = grid.current.querySelectorAll("[data-leaving]");
    const tween = gsap.to(nodes, { scale: .5, opacity: 0, duration: .3, ease: "power2.in", onComplete: () => setLeaving([]) });
    return () => { tween.kill(); };
  }, [leaving]);

  const counts = {
    ready: cards.filter(card => card.kind === "ready").length,
    pending: cards.filter(card => card.kind === "pending").length,
    deep: cards.filter(card => card.kind === "deep").length,
  };
  return (
    <div className="ga-bento-wrap">
      <div className="ga-bento-head">
        <h2>{t("bentoTitle")}</h2>
        <span>{t("bentoCounts", { ready: counts.ready, pending: counts.pending })}{counts.deep ? t("bentoCountsDeep", { deep: counts.deep }) : ""}</span>
      </div>
      <div ref={grid} className="ga-bento" style={{ "--ga-bento-row": `${rowHeight}px`, "--ga-bento-columns": columns } as CSSProperties}>
        {placed.map(item => (
          <div key={item.value.game.id} className="ga-bento-slot" style={{ gridColumn: item.column, gridRow: `${item.row} / span ${item.rowSpan}` }}>
            <BentoCard card={item.value} index={indexes.get(item.value.game.id) ?? 0} selected={item.value.game.id === selectedId} onSelect={onSelect} onContextMenu={onContextMenu} />
          </div>
        ))}
        {leaving.map(({ card, style }) => (
          <div key={`leaving-${card.game.id}`} className="ga-bento-slot" style={style} data-leaving="true" aria-hidden="true">
            <div className="ga-bento-card" data-kind={card.kind}>{card.kind === "ready" ? <span className="ga-bento-cover"><SteamCover game={card.game} /></span> : <img className="ga-bento-landscape" src={landscape(card.game)} alt="" />}</div>
          </div>
        ))}
      </div>
      {!cards.length ? <p className="ga-bento-empty">{t("bentoEmpty")}</p> : null}
    </div>
  );
}
