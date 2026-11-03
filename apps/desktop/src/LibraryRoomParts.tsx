import SteamCover from "./SteamCover";
import type { ReactNode, RefObject } from "react";
import { Download, Gamepad2, Loader2, Play, XCircle } from "lucide-react";

import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { playUiSound } from "./uiSounds";
import type { CatalogGame } from "./types";
import { useI18n, translate } from "./i18n";

export type DownloadMap = Record<number, ManagedDownloadStatus>;
export type FocusZone = "grid" | "actions";

export type LibraryAction = {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  kind: "play" | "download" | "cancel" | "verify";
  reason?: string | null;
};

const ACTION_PREVIOUS_KEYS = new Set(["arrowleft", "arrowup"]);
const ACTION_NEXT_KEYS = new Set(["arrowright", "arrowdown"]);

function InstallStateBadge({ status }: { game: CatalogGame; status?: ManagedDownloadStatus }) {
  const { t } = useI18n();
  const state = gameStateManager.resolve(status);
  if (!state.playButtonReady) return null;
  return <span className="library-install-state ready" title={t("uiListoParaPresionarJugar")}><Play size={12} fill="currentColor" /></span>;
}

export function selectedDownload(appId: number | null | undefined, downloads: DownloadMap) {
  if (!appId) return undefined;
  return downloads[appId];
}

export function libraryRoomClass(focusZone: FocusZone, showcaseMode: boolean, hasSelection: boolean) {
  if (!hasSelection) return "library-room focus-grid is-empty";
  if (showcaseMode) return `library-room focus-${focusZone} is-showcase`;
  return `library-room focus-${focusZone}`;
}

export function buildActions(game: CatalogGame | undefined, status: ManagedDownloadStatus | undefined, busy: boolean): LibraryAction[] {
  if (!game) return [];
  const state = gameStateManager.resolve(status);

  if (state.primaryAction === "wait") {
    const label = translate("actionProcessing");
    return [{ label, icon: <Loader2 className="spin" size={23} />, disabled: true, kind: "verify" }];
  }

  if (state.primaryAction === "play") {
    return [{
      label: translate("actionPlay"),
      icon: busy ? <Loader2 className="spin" size={23} /> : <Play size={23} fill="currentColor" />,
      disabled: busy,
      reason: busy ? translate("actionBusyReason") : null,
      kind: "play",
    }];
  }

  if (state.primaryAction === "cancel") {
    const cancelling = state.technicalState === "cancelling";
    return [{
      label: cancelling ? translate("actionCancelling") : translate("actionCancelDownload"),
      icon: cancelling ? <Loader2 className="spin" size={23} /> : <XCircle size={23} />,
      disabled: cancelling,
      kind: "cancel",
    }];
  }

  if (state.primaryAction === "verify") {
    return [{ label: translate("actionVerifying"), icon: <Loader2 className="spin" size={23} />, disabled: true, kind: "verify" }];
  }

    const srcCount = (game as any).availableSourceCount ?? 0;
  
  return [{
    label: translate("actionDownload"),
    icon: <Download size={23} />,
    disabled: (!game.app_id && !game.id),
    kind: "download",
  }];
}

export interface ActionKeyContext {
  actionIndex: number;
  actionRefs: RefObject<Array<HTMLButtonElement | null>>;
  setActionIndex: (index: number) => void;
  returnToGrid: () => void;
  activateAction: () => void;
}

function focusAction(index: number, context: ActionKeyContext) {
  playUiSound("move");
  context.setActionIndex(index);
  context.actionRefs.current?.[index]?.focus({ preventScroll: true });
}

function actionCount(context: ActionKeyContext) {
  return Math.max(1, context.actionRefs.current?.filter(Boolean).length ?? 0);
}

export function handleActionKey(key: string, context: ActionKeyContext) {
  if (key === "escape") {
    context.returnToGrid();
    return true;
  }
  if (ACTION_PREVIOUS_KEYS.has(key)) {
    focusAction((context.actionIndex - 1 + actionCount(context)) % actionCount(context), context);
    return true;
  }
  if (ACTION_NEXT_KEYS.has(key)) {
    focusAction((context.actionIndex + 1) % actionCount(context), context);
    return true;
  }
  if (key === "enter") {
    context.activateAction();
    return true;
  }
  return false;
}

export interface GridKeyContext {
  selectedIndex: number;
  columns: number;
  enterActions: () => void;
  moveGrid: (delta: number) => void;
}

export function handleGridKey(key: string, context: GridKeyContext) {
  if (key === "enter") {
    context.enterActions();
    return true;
  }
  if (key === "escape") return true;
  if (key === "arrowleft") {
    if (context.selectedIndex % context.columns !== 0) context.moveGrid(-1);
    return true;
  }
  if (key === "arrowright") {
    if (context.selectedIndex % context.columns !== context.columns - 1) context.moveGrid(1);
    return true;
  }
  if (key === "arrowup") {
    context.moveGrid(-context.columns);
    return true;
  }
  if (key === "arrowdown") {
    context.moveGrid(context.columns);
    return true;
  }
  return false;
}

export function LibraryHint() {
  const { t } = useI18n();
  return (
    <div className="library-room-hint">
      <span>{t("uiNavegarFlechas")}</span>
      <span>{t("uiIrATituloLetras")}</span>
      <span>{t("uiEntrarActivarEnter")}</span>
      <span>{t("uiVolverEsc")}</span>
    </div>
  );
}

export function EmptyLibraryContent({ gridRef, loading }: { gridRef: RefObject<HTMLDivElement>; loading: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <aside className="library-room-feature">
        <div className="library-room-feature-shade" />
        <div className="library-room-feature-copy">
          <span className="eyebrow">{t("uiTuBiblioteca")}</span>
          <h1>{loading ? t("emptyLibraryPreparing") : t("emptyLibraryTitle")}</h1>
          <p>{loading ? t("emptyLibraryLoadingBody") : t("emptyLibraryBody")}</p>
          {loading ? <span className="library-room-loading"><Loader2 size={14} className="spin" /> {t("uiCargandoBiblioteca")}</span> : null}
        </div>
      </aside>
      <section className="library-room-catalog">
        <header className="library-room-heading"><small>{t("ui0Juegos")}</small></header>
        <div ref={gridRef} className="library-room-grid library-room-empty-grid">
          <div className="library-room-empty-state">
            <Gamepad2 size={42} />
            <strong>{loading ? t("emptyViewSearching") : t("emptyViewTitle")}</strong>
            <span>{loading ? t("emptyViewLoadingBody") : t("emptyViewBody")}</span>
          </div>
        </div>
      </section>
    </>
  );
}

export { FeaturePanel } from "./LibraryDetailPanel";

interface CatalogPanelProps {
  games: CatalogGame[];
  downloads: DownloadMap;
  selectedIndex: number;
  gridRef: RefObject<HTMLDivElement>;
  onSelect: (index: number) => void;
}

export function CatalogPanel(props: CatalogPanelProps) {
  return (
    <section className="library-room-catalog">
      <header className="library-room-heading"><small>{props.games.length} juegos</small></header>
      <div ref={props.gridRef} className="library-room-grid">
        {props.games.map((game, index) => (
          <button
            type="button"
            key={game.id}
            className={`library-room-card ${index === props.selectedIndex ? "is-selected" : ""}`}
            data-library-game-id={game.id}
            onClick={() => props.onSelect(index)}
            aria-current={index === props.selectedIndex ? "true" : undefined}
            aria-label={translate(index === props.selectedIndex ? "selectedGameAria" : "selectGameAria", { name: game.name })}
            tabIndex={-1}
          >
            <span className="library-room-card-art">
              <SteamCover game={game} />
              <InstallStateBadge game={game} status={game.app_id ? props.downloads[game.app_id] : undefined} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
