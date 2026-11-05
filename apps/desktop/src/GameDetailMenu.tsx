import { Download, Info, Play, SlidersHorizontal } from "lucide-react";
import type { CSSProperties } from "react";
import { gameStateManager } from "./GameStateManager";
import { useI18n } from "./i18n";
import { openLibraryManager } from "./libraryManagerNav";
import { useLibraryEntry } from "./libraryScan";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";

/**
 * The "…" menu of the game detail (Seba, 2026-11-05): Play or Install, Manage and Details, nothing else. Everything
 * else about a game (rename, folder, log, freeze, uninstall) lives in its row of the library manager.
 */
export default function GameDetailMenu({ request, onClose, onPlay, onInstall, onDetails, onLeave }: {
  request: { game: CatalogGame; x: number; y: number; status?: ManagedDownloadStatus }; onClose: () => void;
  onPlay: (game: CatalogGame) => void; onInstall: (game: CatalogGame) => void; onDetails: (game: CatalogGame) => void;
  /** Closes the detail: the manager opens behind it otherwise. */ onLeave: () => void;
}) {
  const { t } = useI18n();
  const { game, status } = request;
  const entry = useLibraryEntry(game.app_id ?? undefined);
  const state = gameStateManager.resolve(status);
  const style: CSSProperties = { position: "fixed", left: Math.min(request.x, window.innerWidth - 250), top: Math.min(request.y, window.innerHeight - 150) };
  const pick = (run: () => void) => () => { onClose(); run(); };
  return (
    <div className="ga-digital-menu-root" style={{ display: "contents" }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") onClose(); event.stopPropagation(); }}>
      <div className="ga-game-options" role="menu" aria-label={t("flipMenuLabel", { name: game.name })} style={style}>
        {state.playButtonReady || (entry?.installed && !state.transferActive)
          ? <button type="button" role="menuitem" onClick={pick(() => onPlay(game))}><Play size={16} /> {t("flipPlay")}</button>
          : !state.transferActive ? <button type="button" role="menuitem" onClick={pick(() => onInstall(game))}><Download size={16} /> {t("flipInstall")}</button> : null}
        {entry ? <button type="button" role="menuitem" onClick={pick(() => { onLeave(); openLibraryManager(game.app_id ?? undefined); })}><SlidersHorizontal size={16} /> {t("flipManage")}</button> : null}
        <button type="button" role="menuitem" onClick={pick(() => onDetails(game))}><Info size={16} /> {t("infoMenu")}</button>
      </div>
    </div>
  );
}
