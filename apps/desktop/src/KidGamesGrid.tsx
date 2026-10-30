import { useEffect } from "react";
import { CheckCheck, Minus, Plus, X } from "lucide-react";
import { GaButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { scanLibrary, useLibraryScan } from "./libraryScan";
import { loadShortcuts, useShortcuts } from "./appShortcuts";
import { kidDays, setKidDraft, setKidGameMinutes, toggleKidGame, toggleKidShortcut, useKidState, type Kid } from "./kidMode";
import type { LibraryGame } from "./catalog/DigitalProcessManager";
import type { AppShortcut } from "./appShortcuts";
import "./library-manager/manager.css";

/**
 * The child's games (vault/Modo niño.md): the library manager's table with four columns only. Each installed game of
 * the library (and each shortcut to another program) can be shown to the child or not, and have its own limit:
 * "general" (free within the daily time) or a specific one, in steps of 30 minutes up to the daily time.
 * "All" and "None" above the table choose every game at once, or clear the choice.
 */
const STEP = 30;
/** Without a daily limit a game's own limit still needs a ceiling. */
const NO_DAILY_CEILING = 6 * 60;
const landscape = (appId: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

interface Row { appId: number; name: string; image: string; toggle: () => void }

/** Installed library games and shortcuts, plus any game the child already has that the scan has not listed yet. */
function useRows(draft: Kid): Row[] {
  const { games } = useLibraryScan();
  const shortcuts = useShortcuts();
  const fromLibrary = games.filter((game): game is LibraryGame & { app_id: number } => game.app_id != null && game.installed)
    .map(game => ({ appId: game.app_id, name: game.name, image: landscape(game.app_id), toggle: () => toggleKidGame(game) }));
  const fromShortcuts = shortcuts.map((shortcut: AppShortcut) => ({ appId: -shortcut.id, name: shortcut.name, image: "", toggle: () => toggleKidShortcut(shortcut) }));
  const listed = new Set([...fromLibrary, ...fromShortcuts].map(row => row.appId));
  const onlyChosen = draft.games.filter(game => !listed.has(game.appId))
    .map(game => ({ appId: game.appId, name: game.name, image: game.appId > 0 ? landscape(game.appId) : "", toggle: () => toggleKidGame({ app_id: game.appId, name: game.name, folder: game.folder } as LibraryGame) }));
  return [...fromLibrary, ...fromShortcuts, ...onlyChosen].sort((a, b) => a.name.localeCompare(b.name));
}

function Limit({ appId, name, minutes, ceiling, on }: { appId: number; name: string; minutes: number; ceiling: number; on: boolean }) {
  const { t } = useI18n();
  const specific = minutes > 0;
  const hours = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
  return <div className="ga-kid-limit-cell">
    <select aria-label={t("kidGameLimitAria", { name })} disabled={!on} value={specific ? "specific" : "general"}
      onChange={event => setKidGameMinutes(appId, event.target.value === "specific" ? Math.min(60, ceiling) : 0)}>
      <option value="general">{t("kidLimitGeneral")}</option>
      <option value="specific">{t("kidLimitSpecific")}</option>
    </select>
    {specific && on ? <span className="ga-kid-spinner">
      <button type="button" aria-label={t("kidLimitLess", { name })} title={t("kidLimitLess", { name })} disabled={minutes <= STEP} onClick={() => setKidGameMinutes(appId, minutes - STEP)}><Minus size={14} aria-hidden="true" /></button>
      <output>{hours}</output>
      <button type="button" aria-label={t("kidLimitMore", { name })} title={t("kidLimitMore", { name })} disabled={minutes + STEP > ceiling} onClick={() => setKidGameMinutes(appId, minutes + STEP)}><Plus size={14} aria-hidden="true" /></button>
    </span> : null}
  </div>;
}

export default function KidGamesGrid() {
  const { t } = useI18n();
  const { draft } = useKidState();
  useEffect(() => { void scanLibrary(); void loadShortcuts().catch(() => undefined); }, []);
  const rows = useRows(draft);
  // A game's own limit goes up to the longest day (no ceiling of its own when some day has no limit).
  const longest = Math.max(...kidDays(draft).map(day => day.minutes || NO_DAILY_CEILING));
  const ceiling = longest || NO_DAILY_CEILING;
  if (!rows.length) return <p className="ga-hint">{t("kidGamesEmpty")}</p>;
  const chosen = new Set(draft.games.map(game => game.appId));
  return <div className="ga-stack">
    <div className="ga-actions">
      <GaButton icon={<CheckCheck size={16} aria-hidden="true" />} disabled={rows.every(row => chosen.has(row.appId))} onClick={() => { for (const row of rows) if (!chosen.has(row.appId)) row.toggle(); }}>{t("kidGamesAll")}</GaButton>
      <GaButton icon={<X size={16} aria-hidden="true" />} disabled={!draft.games.length} onClick={() => setKidDraft({ games: [] })}>{t("kidGamesNone")}</GaButton>
    </div>
    <div className="lm-grid-wrap ga-kid-games">
    <table className="lm-grid">
      <thead><tr>
        <th><span className="sr-only">{t("lmColCover")}</span></th>
        <th>{t("kidColName")}</th>
        <th>{t("kidColShow")}</th>
        <th>{t("kidColLimit")}</th>
      </tr></thead>
      <tbody>{rows.map(row => {
        const chosen = draft.games.find(game => game.appId === row.appId);
        return <tr key={row.appId} className={chosen ? "lm-row is-selected" : "lm-row"}>
          <td><span className="lm-thumb">{row.image ? <img src={row.image} alt="" loading="lazy" /> : null}</span></td>
          <td className="lm-cell-name"><div className="lm-name" title={row.name}>{row.name}</div></td>
          <td><button type="button" className="ga-kid-switch" aria-pressed={Boolean(chosen)} aria-label={t("kidShowAria", { name: row.name })} onClick={row.toggle}>
            <span>{chosen ? t("kidYes") : t("kidNo")}</span></button></td>
          <td><Limit appId={row.appId} name={row.name} minutes={Math.min(chosen?.dailyMinutes ?? 0, ceiling)} ceiling={ceiling} on={Boolean(chosen)} /></td>
        </tr>;
      })}</tbody>
    </table>
    </div>
  </div>;
}
