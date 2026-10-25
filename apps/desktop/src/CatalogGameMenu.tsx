import { useEffect, useState } from "react";
import { BookmarkPlus, Download, ExternalLink, Heart, HeartOff } from "lucide-react";
import GameSideMenu, { type SideMenuItem } from "./GameSideMenu";
import { gameStateManager } from "./GameStateManager";
import { translate, useI18n } from "./i18n";
import { libraryMembership, useLibraryBusy, useLibraryGames } from "./libraryMembership";
import { openSteamStore } from "./native";
import { notify } from "./toasts";
import { SOURCES_CHANGED_EVENT, sourceAvailability } from "./catalog/PluginSources";
import { getPluginStatuses, PLUGINS_CHANGED_EVENT, subscribePluginStatuses } from "./catalog/PluginRuntime";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";

/** Some source plugin is running: without one there is nothing to install from. */
const sourcePluginOn = () => getPluginStatuses().some(plugin => plugin.type === "source_provider" && plugin.alive);

/**
 * A catalog card's menu, in the same glass side panel as the library's: add to the library, install (only when the
 * game has download sources and a source plugin is on), its Steam page, and add to or remove from favorites. Only
 * what can run is listed; uninstalling, renaming and the rest live in the library.
 */
export default function CatalogGameMenu({ game, anchor, status, favorite, onInstall, onFavorite, onClose }: {
  game: CatalogGame; anchor: HTMLElement; status?: ManagedDownloadStatus; favorite: boolean;
  onInstall?: (game: CatalogGame) => void | Promise<void>; onFavorite?: (game: CatalogGame) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  useLibraryGames();
  const libraryBusy = useLibraryBusy();
  const [, refresh] = useState(0);
  useEffect(() => {
    const changed = () => refresh(value => value + 1);
    window.addEventListener(SOURCES_CHANGED_EVENT, changed);
    window.addEventListener(PLUGINS_CHANGED_EVENT, changed);
    const unsubscribe = subscribePluginStatuses(changed);
    return () => { window.removeEventListener(SOURCES_CHANGED_EVENT, changed); window.removeEventListener(PLUGINS_CHANGED_EVENT, changed); unsubscribe(); };
  }, []);
  const appId = game.app_id ?? game.id;
  const state = gameStateManager.resolve(status);
  const hasSources = sourceAvailability(game).count > 0 || (game.availableSourceCount ?? 0) > 0;
  const canInstall = Boolean(appId) && hasSources && sourcePluginOn() && !state.playButtonReady && !state.transferActive && !state.installed;
  const items: SideMenuItem[] = [];
  if (canInstall) items.push({ key: "install", primary: true, label: t("flipInstall"), icon: <Download size={15} aria-hidden="true" />, run: () => void onInstall?.(game) });
  if (!libraryMembership.has(game) && !libraryBusy) items.push({ key: "library", label: t("catalogMenuAddLibrary"), icon: <BookmarkPlus size={15} aria-hidden="true" />, run: () => {
    try { libraryMembership.add(game); notify(translate("toastLibraryAdded", { name: game.name }), { tone: "success" }); }
    catch (error) { notify(translate("toastActionFailed", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" }); }
  } });
  if (game.app_id) items.push({ key: "steam", label: t("catalogMenuSteam"), icon: <ExternalLink size={15} aria-hidden="true" />, run: () => void openSteamStore(game.app_id!).catch(error => notify(translate("toastActionFailed", { error: String(error) }), { tone: "error" })) });
  if (onFavorite) items.push(favorite
    ? { key: "favorite", label: t("catalogMenuUnfavorite"), icon: <HeartOff size={15} aria-hidden="true" />, run: () => onFavorite(game) }
    : { key: "favorite", label: t("catalogMenuFavorite"), icon: <Heart size={15} aria-hidden="true" />, run: () => onFavorite(game) });
  return <GameSideMenu anchor={anchor} label={t("flipMenuLabel", { name: game.name })} items={items} onClose={onClose} />;
}
