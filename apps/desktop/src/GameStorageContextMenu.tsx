import { invoke } from "@tauri-apps/api/core";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Download, FolderOpen, Play, Trash2 } from "lucide-react";

import AppDialog from "./AppDialog";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { gameStateManager } from "./GameStateManager";
import { uninstallGame } from "./gameStorage";
import type { CatalogGame } from "./types";

export interface GameStorageContextMenuRequest {
  game: CatalogGame;
  x: number;
  y: number;
  status?: ManagedDownloadStatus;
}

const contextMenuStyle = (x: number, y: number): CSSProperties => ({
  position: "fixed",
  left: Math.min(x, Math.max(8, window.innerWidth - 250)),
  top: Math.min(y, Math.max(8, window.innerHeight - 150)),
  zIndex: 10000,
  minWidth: 230,
  padding: 6,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.15)",
  background: "rgba(16,18,24,.98)",
  boxShadow: "0 14px 40px rgba(0,0,0,.45)",
});

const contextItemStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "9px 10px",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  font: "inherit",
};

interface Props {
  request: GameStorageContextMenuRequest;
  onClose: () => void;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
}

export default function GameStorageContextMenu({ request, onClose, onInstall, onPlay }: Props) {
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: "warning" | "error" } | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const appId = request.game.app_id;
  const state = gameStateManager.resolve(request.status);
  const canInstalledAction = Boolean(appId) && state.canOpenInstallFolder;
  const canPlay = Boolean(appId) && state.playButtonReady;
  const canInstall = Boolean(appId) && !state.playButtonReady;

  const install = () => {
    onClose();
    if (canInstall) void onInstall?.(request.game);
  };

  const play = () => {
    onClose();
    if (canPlay) void onPlay?.(request.game);
  };

  const openInstallFolder = async () => {
    if (!canInstalledAction || !appId) return;
    try {
      await invoke<string>("open_game_install_folder", { appId });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialog({ title: "No se pudo abrir la carpeta", message, tone: "error" });
    }
  };

  const uninstallSelected = () => {
    if (!state.canUninstall || !appId) return;
    setDialog({
      title: `¿Desinstalar ${request.game.name}?`,
      message: "Steam administrará la eliminación de los archivos del juego.",
      tone: "warning",
    });
  };

  const confirmUninstall = async () => {
    if (!appId) return;
    setUninstalling(true);
    try {
      await uninstallGame(appId);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialog({ title: "No se pudo iniciar la desinstalación", message, tone: "error" });
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <>
    {!dialog ? <div
      role="menu"
      aria-label={`Opciones de ${request.game.name}`}
      style={contextMenuStyle(request.x, request.y)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: canInstall ? 1 : 0.5 }} disabled={!canInstall} onClick={install}>
        <Download size={16} /> Instalar
      </button>
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: canPlay ? 1 : 0.5 }} disabled={!canPlay} onClick={play}>
        <Play size={16} /> Jugar
      </button>
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: canInstalledAction ? 1 : 0.5 }} disabled={!canInstalledAction} onClick={() => void openInstallFolder()}>
        <FolderOpen size={16} /> Abrir carpeta de instalación
      </button>
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: state.canUninstall ? 1 : 0.5 }} disabled={!state.canUninstall} onClick={uninstallSelected}>
        <Trash2 size={16} /> Desinstalar
      </button>
    </div> : null}
    {dialog ? <AppDialog title={dialog.title} message={dialog.message} tone={dialog.tone} onClose={onClose} onConfirm={dialog.title.startsWith("¿Desinstalar") ? () => void confirmUninstall() : undefined} confirmDisabled={uninstalling} confirmLabel="Desinstalar" cancelLabel="No, volver" /> : null}
    </>
  );
}
