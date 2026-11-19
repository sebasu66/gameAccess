/**
 * The detail of Manager › Games (Seba, 2026-11-19; docs/GUI_DESIGN.md §4.49).
 *
 * The first column of the screen: the game's card art on top, its figures under it, then its properties —language and
 * launch, which BASE includes, and personalization, which is PLUS (DigitalGameOptions with `layout="panel"`)— and last
 * its activity log. It shows the **last row the player picked**; with several rows ticked, a line on top says how many
 * and the properties are still the last one's, so one game is always what is being read.
 *
 * It replaces the row that unfolded (§4.20b): the log lives here, so the grid is only a list.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ScrollText } from "lucide-react";
import { EyeSlash } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import DigitalGameOptions from "../DigitalGameOptions";
import SteamCover from "../SteamCover";
import { GaButton } from "../components/ga/Buttons";
import type { RowAction } from "./RowExpand";
import { ArtworkFallback } from "../GameArt";
import { digitalProcessManager, type LibraryGame } from "../catalog/DigitalProcessManager";
import { isHiddenGame, useGameCards } from "../gameCard";
import { libraryDemo } from "../libraryScan";
import { isSteamOwned } from "../steamLibrary";
import { uiDemo } from "../devDemo/uiDemo";
import type { CatalogGame } from "../types";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

/** The game's log, as the unfolded row used to show it (gameaccess-log.txt: import, install, each Play, each freeze). */
function GameLog({ game, c }: { game: LibraryGame; c: LibraryCopy }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // A folder not yet identified (no AppID) has no game log the launcher can find.
    if (game.app_id == null) { setText(""); return; }
    if (libraryDemo() || uiDemo()) { setText("2026-10-12 21:04:11 | importado | carpeta adaptada al estándar actual\n2026-10-12 21:04:12 | analisis | estado=ready; ejecutable=Game/game.exe"); return; }
    void digitalProcessManager.gameLog({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame)
      .then(result => { if (live) setText(result.log ?? ""); }).catch(() => { if (live) setText(""); });
    return () => { live = false; };
  }, [game.app_id, game.name]);
  const lines = (text ?? "").split("\n").filter(line => line.trim());
  return <div className="lm-history" tabIndex={-1}>
    {text === null ? <p>{c.working}</p> : !lines.length ? <p>{c.noHistory}</p> : lines.map((line, index) => <p key={index}>{line}</p>)}
  </div>;
}

export default function GameDetail({ game, member, catalogGame, c, picked, actions }: {
  game?: LibraryGame; catalogGame?: CatalogGame; c: LibraryCopy;
  /** A game of the library with no folder yet: it has its art, its name and its two actions, and nothing to edit. */ member?: CatalogGame;
  /** How many rows are ticked: more than one, and the detail says so before showing the last one picked. */ picked: number;
  /** What this one game offers (GameLibraryManager.gameActions): the grid no longer draws them. */ actions: RowAction[];
}) {
  const { t } = useI18n();
  const cards = useGameCards();
  const log = useRef<HTMLDivElement>(null);
  const id = game?.app_id ?? null;
  useEffect(() => { log.current?.scrollTo({ top: 0 }); }, [id]);
  if (!game) return <aside className="lm-detail-pane" aria-label={t("lmDetailAria")}>
    {member ? <>
      <div className="lm-detail-art"><SteamCover game={member} /></div>
      <header className="lm-detail-head"><h3 className="ga-heading lm-detail-name" title={member.name}>{member.name}</h3></header>
      <DetailActions actions={actions.filter(action => action.tone !== "danger")} />
      <DetailActions actions={actions.filter(action => action.tone === "danger")} className="lm-detail-risky" />
    </> : <p className="lm-empty">{t("lmDetailNone")}</p>}
  </aside>;
  const asCatalog = catalogGame ?? ({ id: id ?? 0, app_id: id, name: game.name } as CatalogGame);
  const hidden = id != null && isHiddenGame({ app_id: id, id }, cards);
  return <aside className="lm-detail-pane" aria-label={t("lmDetailAria")}>
    {picked > 1 ? <p className="lm-detail-many" role="status">{t("lmDetailMany", { count: picked })}</p> : null}
    {/* The art fills the detail's width, edge to edge, and the name sits under it. */}
    <div className="lm-detail-art">{id ? <SteamCover game={asCatalog} /> : <ArtworkFallback name={game.name} />}</div>
    <header className="lm-detail-head">
      <h3 className="ga-heading lm-detail-name" title={game.name}>{game.name}</h3>
      {hidden ? <p className="lm-detail-state"><span className="lm-status" title={c.hiddenInPlayTip}><EyeSlash />{c.hiddenInPlay}</span></p> : null}
    </header>
    <DetailActions actions={actions.filter(action => action.tone !== "danger")} />
    {game.issues.length && (!game.unfinished || game.stalled) ? <div className="lm-needs"><b>{c.whatNeeds}</b>
      <ul>{game.issues.map(issue => <li key={issue.code}><AlertTriangle />{issue.message}{issue.bytes ? <em>({formatBytes(issue.bytes)})</em> : null}</li>)}</ul></div> : null}
    <DigitalGameOptions key={id ?? game.name} game={asCatalog} layout="panel" cardOnly={!runnable(game)}
      after={[{ id: "log", label: c.historyTitle, icon: <ScrollText aria-hidden="true" />, content: <div ref={log}><GameLog game={game} c={c} /></div> }]} />
    <DetailActions actions={actions.filter(action => action.tone === "danger")} className="lm-detail-risky" />
  </aside>;
}

/*
 * The game's own actions as buttons (Seba, 2026-11-19): what it offers goes **under its name**, and what cannot be
 * undone --uninstall it, delete it from disk, take it out of the library-- goes at the **very end** of the detail,
 * after its properties: up there it cut the view in two, and those are also done to several games at once from the
 * grid's selection, which keeps them.
 */
function DetailActions({ actions, className }: { actions: RowAction[]; className?: string }) {
  if (!actions.length) return null;
  return <div className={`ga-actions lm-detail-acts${className ? ` ${className}` : ""}`}>
    {actions.map(action => <GaButton key={action.label} variant={action.tone === "accent" ? "primary" : action.tone === "danger" ? "danger" : action.tone === "frost" ? "frost" : "secondary"}
      icon={action.icon} disabled={action.disabled} title={action.label} onClick={action.onClick}>{action.label.split(":")[0]}</GaButton>)}
  </div>;
}

/** The same rule as the grid's menu: language and launch only for a game whose files Game Access runs. */
const runnable = (game: LibraryGame) => game.app_id != null && !isSteamOwned(game) && !game.partial && game.frozen !== "deep";
