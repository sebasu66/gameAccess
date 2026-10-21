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

import AppDialog from "./AppDialog";
import RenameGameDialog from "./RenameGameDialog";
import FreezeDialog, { type FreezeMode } from "./FreezeDialog";
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
  const [removing, setRemoving] = useState(false);
  const [freezing, setFreezing] = useState<FreezeMode | null>(null);
  const label = locale === "es" ? {add:"Añadir a biblioteca",remove:"Quitar de biblioteca",options:"Idioma y ejecución",confirm:"¿Quitar de biblioteca?",warning:"También se desinstalarán los archivos locales del juego.",removed:"No se pudo quitar el juego",back:"Volver"} : {add:"Add to library",remove:"Remove from library",options:"Language and launch",confirm:"Remove from library?",warning:"The game's local files will also be uninstalled.",removed:"Could not remove game",back:"Back"};
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: "warning" | "error" } | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [progress, setProgress] = useState<{ phase: "working" | "done"; label: string; detail?: string } | null>(null);
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
      setDialog({ title: translate("openFolderFailed"), message, tone: "error" });
    }
  };

  const uninstallSelected = () => {
    if (!canUninstall || linked) return;
    setRemoving(false);
    setDialog({
      title: translate("uninstallTitle", { name: request.game.name }),
      message: translate("uninstallBody"),
      tone: "warning",
    });
  };

  const confirmUninstall = async () => {
    setUninstalling(true);
    // The dialog stays open and narrates the work, then shows the result.
    setProgress({ phase: "working", label: translate(removing ? "uninstallRemoving" : "uninstallDeleting"), detail: request.game.name });
    try {
      if (removing) {
        await removeLibraryGame(request.game);
        notify(translate("toastLibraryRemoved", { name: request.game.name }), { tone: "success" });
        setProgress({ phase: "done", label: translate("uninstallLibraryDone"), detail: translate(linked ? "uninstallLinkedDoneDetail" : "uninstallLibraryDoneDetail") });
      } else {
        const { folder } = await service.uninstall(request.game);
        notify(translate("toastGameUninstalled", { name: request.game.name }), { tone: "success" });
        setProgress({ phase: "done", label: translate("uninstallFolderDone"), detail: folder });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProgress(null);
      setDialog({ title: removing ? label.removed : translate("uninstallFailed"), message, tone: "error" });
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <div className="ga-digital-menu-root" style={{display:"contents"}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape"&&!uninstalling)onClose();event.stopPropagation();}}>
      {!dialog && !configuring && !showingLog && !repairing && !renaming && !freezing ? (
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
          {canFreeze && !entry?.frozen ? <button type="button" role="menuitem" onClick={() => setFreezing("freeze")}><Snowflake size={16} /> {t("freezeMenu")}</button> : null}
          {canFreeze && entry?.frozen !== "deep" ? <button type="button" role="menuitem" onClick={() => setFreezing("deep")}><Snowflake size={16} /> {t("deepFreezeMenu")}</button> : null}
          {canFreeze && entry?.frozen ? <button type="button" role="menuitem" onClick={() => setFreezing("thaw")}><Flame size={16} /> {t("thawMenu")}</button> : null}
          {inLibrary ? <button type="button" role="menuitem" className="ga-danger-option" disabled={!canManage} onClick={() => { setRemoving(true); setDialog({title:label.confirm+" "+request.game.name,message:linked ? t("uninstallLinkedWarning") : label.warning,tone:"warning"}); }}>{label.remove}</button>
            : <button type="button" role="menuitem" disabled={libraryBusy} onClick={() => { try { libraryMembership.add(request.game); notify(translate("toastLibraryAdded", { name: request.game.name }), { tone: "success" }); } catch (error) { notify(translate("toastActionFailed", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" }); } onClose(); }}>{label.add}</button>}
          {linked ? null : <button
            type="button"
            role="menuitem"
            disabled={!canUninstall}
            onClick={uninstallSelected}
          >
            <Trash2 size={16} /> Desinstalar
          </button>}
        </div>
      ) : null}
      {repairing ? <GameRecoveryDialog game={request.game} mode="broken" message={request.status?.repair_warning || (locale === "es" ? "El juego no está listo para ejecutarse." : "The game is not ready to run.")} onClose={onClose} /> : null}
      {freezing ? <FreezeDialog game={request.game} mode={freezing} onClose={onClose} /> : null}
      {renaming ? <RenameGameDialog game={request.game} current={entry?.label ?? ""} onClose={onClose} /> : null}
      {showingLog ? <DigitalGameLog game={request.game} onClose={onClose} /> : null}
      {configuring ? <DigitalGameOptions game={request.game} onClose={onClose} disabled={!canUninstall} /> : null}
      {dialog ? (
        <AppDialog
          title={dialog.title}
          message={dialog.message}
          tone={dialog.tone}
          onClose={uninstalling ? () => undefined : onClose}
          progress={progress ?? undefined}
          onConfirm={dialog.tone === "warning" ? () => void confirmUninstall() : undefined}
          confirmDisabled={uninstalling}
          confirmLabel={removing ? label.remove : "Desinstalar"}
          cancelLabel="No, volver"
        />
      ) : null}
    </div>
  );
}
