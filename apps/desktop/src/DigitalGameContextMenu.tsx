import DigitalGameOptions from "./DigitalGameOptions";
import DigitalGameLog from "./DigitalGameLog";
import GameRecoveryDialog from "./GameRecoveryDialog";
import { useI18n } from "./i18n";
import { libraryMembership, useLibraryBusy, useLibraryGames } from "./libraryMembership";
import { removeLibraryGame } from "./libraryActions";
import { notify } from "./toasts";
import { translate } from "./i18n";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { SOURCES_CHANGED_EVENT, sourceAvailability } from "./catalog/PluginSources";
import { Download, Flame, FolderOpen, Play, Snowflake, Trash2 } from "lucide-react";

import { confirmNotice, hideNotice, showNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import RenameGameDialog from "./RenameGameDialog";
import FreezeDialog, { type FreezeMode } from "./FreezeDialog";
import { useFreezeJob } from "./freezeJobs";
import { useLibraryEntry } from "./libraryScan";
import { digitalCatalogService, type DigitalCatalog } from "./catalog/DigitalCatalog";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { gameStateManager } from "./GameStateManager";
import type { CatalogGame } from "./types";

export interface DigitalContextMenuRequest {
  game: CatalogGame;
  x: number;
  y: number;
  status?: ManagedDownloadStatus;
}

const contextMenuStyle = (x: number, y: number): CSSProperties => ({
  position: "fixed",
  left: Math.min(x, Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 1920) - 250)),
  top: Math.min(y, Math.max(8, (typeof window !== "undefined" ? window.innerHeight : 1080) - 150)),
});

/**
 * Uninstalling or removing from the library asks in the single notice, shows the work there and ends with the
 * result; it keeps going after the menu closes.
 */
async function uninstallWithNotice(game: CatalogGame, removing: boolean, linked: boolean, service: DigitalCatalog, labels: { confirm: string; warning: string; remove: string; removed: string }) {
  const ok = await confirmNotice({
    game: noticeGame(game),
    title: removing ? `${labels.confirm} ${game.name}` : translate("uninstallTitle", { name: game.name }),
    text: removing ? (linked ? translate("uninstallLinkedWarning") : labels.warning) : translate("uninstallBody"),
    confirmLabel: removing ? labels.remove : translate("noticeUninstallConfirm"),
    cancelLabel: translate("noticeCancel"),
  });
  if (!ok) return;
  showNotice({ game: noticeGame(game), tone: "info", title: translate(removing ? "uninstallRemoving" : "uninstallDeleting"), text: game.name, progress: null });
  try {
    if (removing) {
      await removeLibraryGame(game);
      showNotice({ game: noticeGame(game), tone: "ok", title: translate("toastLibraryRemoved", { name: game.name }), text: translate(linked ? "uninstallLinkedDoneDetail" : "uninstallLibraryDoneDetail") });
    } else {
      const { folder } = await service.uninstall(game);
      showNotice({ game: noticeGame(game), tone: "ok", title: translate("toastGameUninstalled", { name: game.name }), text: folder });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNotice({ game: noticeGame(game), tone: "error", title: removing ? labels.removed : translate("uninstallFailed"), text: message, actions: [{ label: translate("close"), run: () => hideNotice() }] });
  }
}

interface Props {
  request: DigitalContextMenuRequest;
  onClose: () => void;
  service?: DigitalCatalog;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
}

export default function DigitalGameContextMenu({
  request,
  onClose,
  service = digitalCatalogService,
  onInstall,
  onPlay,
}: Props) {
  const {locale, t} = useI18n();
  useLibraryGames();
  const libraryBusy = useLibraryBusy();
  const inLibrary = libraryMembership.has(request.game);
  const entry = useLibraryEntry(request.game.app_id ?? undefined);
  // A linked game is only a shortcut to a folder Game Access does not own: it can leave the library, never be uninstalled.
  const linked = Boolean(entry?.linked);
  const [renaming, setRenaming] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [showingLog, setShowingLog] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [freezing, setFreezing] = useState<FreezeMode | null>(null);
  // A freeze outlives this menu: while one runs, the menu only offers to watch it (never a second one).
  const freezeWork = useFreezeJob(request.game.app_id ?? request.game.id);
  const label = locale === "es" ? {add:"Añadir a biblioteca",remove:"Quitar de biblioteca",options:"Idioma y ejecución",confirm:"¿Quitar de biblioteca?",warning:"También se desinstalarán los archivos locales del juego.",removed:"No se pudo quitar el juego",back:"Volver"} : {add:"Add to library",remove:"Remove from library",options:"Language and launch",confirm:"Remove from library?",warning:"The game's local files will also be uninstalled.",removed:"Could not remove game",back:"Back"};
  const appId = request.game.app_id ?? request.game.id;
  const state = gameStateManager.resolve(request.status);
  const canInstalledAction = Boolean(appId) && state.canOpenInstallFolder;
  // Library actions only need the transfer to be stopped.
  const canManage = Boolean(appId) && !state.transferActive && !libraryBusy;
  // Desinstalar and the language/launch options need installed files.
  const canUninstall = canManage && (state.installed || state.prepared);
  const canPlay = Boolean(appId) && state.playButtonReady;
  // Freezing changes the game's files, so only games Game Access owns (downloaded or imported by moving).
  const canFreeze = canManage && !linked && Boolean(entry) && entry?.state === "ready" && state.installed;
  // Same rule as the Download button: it needs at least one connected source for this game.
  const [, refreshSources] = useState(0);
  useEffect(() => {
    const changed = () => refreshSources(value => value + 1);
    window.addEventListener(SOURCES_CHANGED_EVENT, changed);
    return () => window.removeEventListener(SOURCES_CHANGED_EVENT, changed);
  }, []);
  const hasSources = sourceAvailability(request.game).count > 0 || (request.game.availableSourceCount ?? 0) > 0;
  const canInstall = Boolean(appId) && !state.playButtonReady && hasSources;

  const install = async () => {
    onClose();
    if (onInstall) {
      void onInstall(request.game);
    } else {
      await service.download(request.game);
    }
  };

  const play = async () => {
    onClose();
    if (onPlay) {
      void onPlay(request.game);
    } else {
      await service.play(request.game);
    }
  };

  const openInstallFolder = async () => {
    if (!canInstalledAction) return;
    try {
      await service.openInstallFolder(request.game);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(`${translate("openFolderFailed")}: ${message}`, { tone: "error" });
    }
  };

  const uninstallSelected = () => {
    if (!canUninstall || linked) return;
    onClose();
    void uninstallWithNotice(request.game, false, linked, service, label);
  };

  const removeSelected = () => {
    if (!canManage) return;
    onClose();
    void uninstallWithNotice(request.game, true, linked, service, label);
  };

  return (
    <div className="ga-digital-menu-root" style={{display:"contents"}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape")onClose();event.stopPropagation();}}>
      {!configuring && !showingLog && !repairing && !renaming && !freezing ? (
        <div
          className="ga-game-options"
          role="menu"
          aria-label={`Opciones de ${request.game.name}`}
          style={contextMenuStyle(request.x, request.y)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canInstall}
            onClick={() => void install()}
          >
            <Download size={16} /> Instalar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canPlay}
            onClick={() => void play()}
          >
            <Play size={16} /> Jugar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canInstalledAction}
            onClick={() => void openInstallFolder()}
          >
            <FolderOpen size={16} /> Abrir carpeta de instalación
          </button>
          <button type="button" role="menuitem" disabled={!canUninstall} onClick={() => setConfiguring(true)}>{label.options}</button>
          <button type="button" role="menuitem" disabled={!entry || libraryBusy} onClick={() => setRenaming(true)}>{t("renameMenu")}</button>
          {request.status?.needs_repair ? <button type="button" role="menuitem" disabled={!canManage} onClick={() => setRepairing(true)}>⚠ {locale === "es" ? "Reparar juego" : "Repair game"}</button> : null}
          <button type="button" role="menuitem" disabled={!appId || !state.canOpenInstallFolder && !state.installed && !state.prepared} onClick={() => setShowingLog(true)}>{locale === "es" ? "Ver registro" : "View log"}</button>
          {freezeWork ? <button type="button" role="menuitem" onClick={() => setFreezing(freezeWork.mode)}><Snowflake size={16} /> {t(freezeWork.mode === "thaw" ? "thawRunning" : "freezeRunning")}</button> : null}
          {canFreeze && !freezeWork && !entry?.frozen ? <button type="button" role="menuitem" onClick={() => setFreezing("freeze")}><Snowflake size={16} /> {t("freezeMenu")}</button> : null}
          {canFreeze && !freezeWork && entry?.frozen !== "deep" ? <button type="button" role="menuitem" onClick={() => setFreezing("deep")}><Snowflake size={16} /> {t("deepFreezeMenu")}</button> : null}
          {canFreeze && !freezeWork && entry?.frozen ? <button type="button" role="menuitem" onClick={() => setFreezing("thaw")}><Flame size={16} /> {t("thawMenu")}</button> : null}
          {inLibrary ? <button type="button" role="menuitem" className="ga-danger-option" disabled={!canManage} onClick={removeSelected}>{label.remove}</button>
            : <button type="button" role="menuitem" disabled={libraryBusy} onClick={() => { try { libraryMembership.add(request.game); notify(translate("toastLibraryAdded", { name: request.game.name }), { tone: "success" }); } catch (error) { notify(translate("toastActionFailed", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" }); } onClose(); }}>{label.add}</button>}
          {linked ? null : <button
            type="button"
            role="menuitem"
            disabled={!canUninstall}
            onClick={uninstallSelected}
          >
            <Trash2 size={16} /> {t("noticeUninstallConfirm")}
          </button>}
        </div>
      ) : null}
      {repairing ? <GameRecoveryDialog game={request.game} mode="broken" message={request.status?.repair_warning || (locale === "es" ? "El juego no está listo para ejecutarse." : "The game is not ready to run.")} onClose={onClose} /> : null}
      {freezing ? <FreezeDialog game={request.game} mode={freezing} onClose={onClose} /> : null}
      {renaming ? <RenameGameDialog game={request.game} current={entry?.label ?? ""} onClose={onClose} /> : null}
      {showingLog ? <DigitalGameLog game={request.game} onClose={onClose} /> : null}
      {configuring ? <DigitalGameOptions game={request.game} onClose={onClose} disabled={!canUninstall} /> : null}
    </div>
  );
}
