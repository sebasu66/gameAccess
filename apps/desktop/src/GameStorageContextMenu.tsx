import { invoke } from "@tauri-apps/api/core";
import type { CSSProperties } from "react";
import { Archive, FolderOpen, Trash2 } from "lucide-react";

import type { ManagedDownloadStatus } from "./downloadTypes";
import { gameStateManager } from "./GameStateManager";
import { freezeGame, thawGame, uninstallGame } from "./gameStorage";
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
}

export default function GameStorageContextMenu({ request, onClose }: Props) {
  const appId = request.game.app_id;
  const state = gameStateManager.resolve(request.status);
  const canInstalledAction = Boolean(appId) && state.canOpenInstallFolder;
  const canFreezeAction = Boolean(appId) && (state.canFreeze || state.canThaw);

  const openInstallFolder = async () => {
    onClose();
    if (!canInstalledAction || !appId) return;
    try {
      await invoke<string>("open_game_install_folder", { appId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`No pudimos abrir la carpeta de instalación.

${message}`);
    }
  };

  const uninstallSelected = async () => {
    onClose();
    if (!state.canUninstall || !appId) return;
    if (!window.confirm(`¿Desinstalar ${request.game.name}? Steam administrará la eliminación de sus archivos.`)) return;
    try {
      await uninstallGame(appId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`No pudimos iniciar la desinstalación.

${message}`);
    }
  };

  const toggleFreezeSelected = async () => {
    onClose();
    if (!canFreezeAction || !appId) return;
    if (state.canFreeze && !window.confirm(`¿Congelar ${request.game.name}? GameAccess lo sacará de Steam y lo comprimirá para ahorrar espacio.`)) return;
    try {
      if (state.canThaw) await thawGame(appId);
      else await freezeGame(appId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`No pudimos ${state.canThaw ? "restaurar" : "congelar"} el juego.

${message}`);
    }
  };

  return (
    <div
      role="menu"
      aria-label={`Opciones de ${request.game.name}`}
      style={contextMenuStyle(request.x, request.y)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: canInstalledAction ? 1 : 0.5 }} disabled={!canInstalledAction} onClick={() => void openInstallFolder()}>
        <FolderOpen size={16} /> Abrir carpeta de instalación
      </button>
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: state.canUninstall ? 1 : 0.5 }} disabled={!state.canUninstall} onClick={() => void uninstallSelected()}>
        <Trash2 size={16} /> Desinstalar
      </button>
      <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: canFreezeAction ? 1 : 0.5 }} disabled={!canFreezeAction} onClick={() => void toggleFreezeSelected()}>
        <Archive size={16} /> {state.canThaw ? "Descongelar" : "Comprimir / congelar"}
      </button>
    </div>
  );
}
