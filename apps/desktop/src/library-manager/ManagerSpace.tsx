/**
 * Manager › Space (Seba, 2026-11-17; rebuilt 2026-11-18, docs/GUI_DESIGN.md §4.38). Three parts:
 *   - the actions on top: rescan the disks (kind and read speed, also finding a disk plugged in later), free a disk
 *     (move all its games to one disk or spread them evenly), and how new games are placed (the policy and the reserve);
 *   - one grid of the games Game Access downloaded and manages (not Steam's or other accounts'), each with the disk it
 *     is on; with more than one disk for installing, that disk is a dropdown that moves the game;
 *   - the moves going on, under the grid (this is where a move belongs; Activity links here);
 *   - beside them, the disks one above the other, each with what it may be used for (install, downloads).
 * The whole section scrolls with the app's round scrollbar (`scrollRef`).
 */
import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, RefreshCw, Snowflake } from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import { scanLibrary, useLibraryScan } from "../libraryScan";
import type { DriveRole, LibraryDrive, LibraryGame } from "../catalog/DigitalProcessManager";
import type { CatalogGame } from "../types";
import { GaButton } from "../components/ga/Buttons";
import { GaSwitch } from "../components/ga/Switch";
import { notify } from "../toasts";
import { cancelFreezeJob, hostFreezeJob, useFreezeConsole, type FreezeJob } from "../freezeJobs";
import { isSteamOwned } from "../steamLibrary";
import DiskCard, { type DiskActivity } from "./DiskCard";
import DiskRack, { RACK_SHELVES } from "./DiskRack";
import AutoCompressSheet from "./AutoCompressSheet";
import FreezeDialog, { type FreezeMode } from "../FreezeDialog";
import { idleDays } from "./GameLibraryManager";
import { copy } from "./copy";
import { formatBytes } from "./format";
import { askMoveToDrive, driveColor, driveOf, ledColor, loadDrives, rescanDrives, movableToDrive, policyOrder, setDriveRole, useDiskBatch, useLibraryDrives } from "./libraryDrives";
import FreeDiskWizard from "./FreeDiskWizard";
import "./manager.css";
import "./space.css";

const KIND_KEYS: Record<NonNullable<LibraryDrive["kind"]>, TranslationKey> = { nvme: "spaceKindNvme", ssd: "spaceKindSsd", hdd: "spaceKindHdd", unknown: "spaceKindUnknown" };
/** What the disk is, written on its own panel: what Windows calls it, the same word in every language. */
const KIND_TAG: Record<NonNullable<LibraryDrive["kind"]>, string> = { nvme: "NVMe", ssd: "SSD", hdd: "HDD", unknown: "" };
const BUS_USB = "USB";
const failText = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

/** The disk a game is on, with its colour. */
function DriveMark({ letter, title }: { letter: string; title?: string }) {
  return <span className="lm-drive-mark" title={title} style={{ "--lm-drive": driveColor(letter) } as CSSProperties}><i aria-hidden="true" />{letter}</span>;
}

/** The column of words: how it works, the policy as it stands, and the two actions at the foot. */
function SpaceAside({ drives }: { drives: LibraryDrive[] }) {
  const { t } = useI18n();
  const { rescanning } = useLibraryDrives();
  const [freeing, setFreeing] = useState(false);
  const [autoZip, setAutoZip] = useState(false);
  const job = useDiskBatch();
  const rescan = async () => {
    try { await rescanDrives(false); notify(t("spaceRescanDone"), { tone: "success" }); }
    catch (failure) { notify(t("spaceRescanFailed", { error: failText(failure) }), { tone: "error" }); }
  };
  const order = (role: DriveRole) => policyOrder(drives, role).map(drive => drive.letter);

  return <aside className="lm-space-aside">
    <section className="lm-space-part">
      <h3 className="ga-heading">{t("spaceAsideTitle")}</h3>
      <p className="lm-space-lead">{t("spaceDrivesLead")} {t("spacePolicyHint")} {t("spaceReserveHint")}</p>
    </section>
    <section className="lm-space-part">
      <span className="ga-label">{t("spacePolicyNow")}</span>
      <dl className="lm-space-order">
        <dt>{t("spaceRoleInstall")}</dt><dd>{order("install").length ? order("install").map(letter => <DriveMark key={letter} letter={letter} />) : "—"}</dd>
        <dt>{t("spaceRoleDownload")}</dt><dd>{order("download").length ? order("download").map(letter => <DriveMark key={letter} letter={letter} />) : "—"}</dd>
      </dl>
    </section>
    <section className="lm-space-part lm-space-actions" role="group" aria-label={t("spaceActionsLabel")}>
      <GaButton icon={<RefreshCw size={16} aria-hidden="true" className={rescanning ? "spin" : undefined} />} disabled={rescanning} onClick={() => void rescan()}>
        {rescanning ? t("spaceRescanBusy") : t("spaceRescan")}
      </GaButton>
      <GaButton disabled={Boolean(job && !job.finished)} onClick={() => setFreeing(true)}>{t("spaceFreeOpen")}</GaButton>
      <GaButton onClick={() => setAutoZip(true)}>{t("autoZipOpen")}</GaButton>
    </section>
    {/* Freeing a disk takes the whole window: while it moves games nothing else can be done (§4.45). */}
    {freeing || (job && !job.finished) ? <FreeDiskWizard drives={drives} onClose={() => setFreeing(false)} /> : null}
    {autoZip ? <AutoCompressSheet onClose={() => setAutoZip(false)} /> : null}
  </aside>;
}

type SortKey = "name" | "size" | "drive" | "played";

/** The game as the rest of the app passes it around (the freeze question, the jobs). */
const asCatalogGame = (game: LibraryGame): CatalogGame => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);
/** A game Game Access can compress or uncompress on its own: ours, installed and whole. */
const zippable = (game: LibraryGame) => game.app_id != null && !game.linked && !isSteamOwned(game) && !game.partial && !game.unfinished && game.installed !== false;
/** When it was last played, in words. */
/** Short in the cell —«67 d», a dash when it was never played (Seba, 2026-11-19)— with the whole thing in its tooltip. */
const playedText = (game: LibraryGame, t: (key: TranslationKey, values?: Record<string, string | number>) => string) => {
  const days = game.last_played ? idleDays(game) : null;
  return days == null ? t("spacePlayedNone") : days <= 0 ? t("spacePlayedToday") : t("spacePlayedDays", { days });
};
const playedTip = (game: LibraryGame, t: (key: TranslationKey, values?: Record<string, string | number>) => string) => {
  const days = game.last_played ? idleDays(game) : null;
  return days == null ? t("spacePlayedNever") : days <= 0 ? t("spacePlayedToday") : t("spacePlayedAgo", { days });
};

/** One grid of Game Access's own games with the disk each is on; the disk moves it (with more than one install disk). */
function SpaceGames({ games, drives, moving, onZip }: { games: LibraryGame[]; drives: LibraryDrive[]; moving: boolean; onZip: (game: LibraryGame, mode: FreezeMode) => void }) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "size", dir: -1 });
  const installs = drives.filter(drive => drive.roles?.install);
  const rows = useMemo(() => [...games].sort((a, b) => {
    const by = sort.key === "name" ? a.name.localeCompare(b.name) : sort.key === "size" ? (a.size_bytes ?? 0) - (b.size_bytes ?? 0)
      : sort.key === "played" ? (idleDays(b) ?? Number.MAX_SAFE_INTEGER) - (idleDays(a) ?? Number.MAX_SAFE_INTEGER) : driveOf(a.folder).localeCompare(driveOf(b.folder));
    return by * sort.dir || a.name.localeCompare(b.name);
  }), [games, sort]);
  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className={`lm-sort${active ? " is-active" : ""}`} onClick={() => setSort(active ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "size" ? -1 : 1 })}>
        {label}<Icon size={14} aria-hidden="true" /></button></th>;
  };
  if (!games.length) return <p className="ga-hint">{t("spaceGamesNone")}</p>;
  return <div className="lm-grid-wrap lm-space-grid">
    <table className="lm-grid">
      <thead><tr>{header("name", t("lmColName"))}{header("size", t("lmColSize"))}{header("played", t("spaceColPlayed"))}{header("drive", t("spaceColDrive"))}<th aria-label={t("lmColActions")} /></tr></thead>
      <tbody>{rows.map(game => {
        const letter = driveOf(game.folder);
        const choices = movableToDrive(game) ? installs.filter(drive => drive.letter !== letter) : [];
        return <tr key={`${game.app_id}|${game.folder}`} className="lm-row">
          <td className="lm-cell-name"><div className="lm-name" title={game.name}>{game.name}</div></td>
          <td className="lm-cell-num">{formatBytes(game.size_bytes ?? 0)}</td>
          <td className="lm-cell-num" title={playedTip(game, t)}>{playedText(game, t)}</td>
          <td className="lm-space-drive" style={{ "--lm-drive": driveColor(letter) } as CSSProperties}>
            {choices.length ? <select className="ga-settings-select lm-drive-select" aria-label={t("spaceMoveTo", { name: game.name })} value={letter} disabled={moving}
              title={moving ? t("spaceMoveWait") : t("spaceMoveHint")}
              onChange={event => { const drive = installs.find(item => item.letter === event.target.value); event.target.value = letter; if (drive) void askMoveToDrive(game, drive); }}>
              <option value={letter}>{letter}</option>
              {choices.map(drive => <option key={drive.letter} value={drive.letter} disabled={(game.size_bytes ?? 0) >= drive.free_bytes}>{t("spaceMoveOption", { drive: drive.letter, free: formatBytes(drive.free_bytes) })}</option>)}
            </select> : <DriveMark letter={letter} title={game.frozen ? t("spaceMoveFrozen") : game.unfinished ? t("spaceMoveUnfinished") : t("spaceMoveOnlyDisk")} />}
          </td>
          {/* Compressing a game is freezing it: the same question and the same job as the Library Manager's menu. */}
          <td className="lm-space-zip">
            {game.frozen === "deep" ? <span className="lm-space-zip-state" role="img" aria-label={t("spaceDeepFrozen")} title={t("spaceZipDeep")}><Snowflake aria-hidden="true" /></span>
              : zippable(game) ? <GaButton className={game.frozen ? "is-frozen" : undefined} aria-label={game.frozen ? t("spaceUnzip") : t("spaceZip")}
                title={game.frozen ? t("spaceUnzipTip") : t("spaceZipTip")} disabled={moving} onClick={() => onZip(game, game.frozen ? "thaw" : "freeze")}
                icon={game.frozen ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />} /> : null}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

/** The moves going on (and the one just ended), with their bar and cancel; while shown here they are not repeated in
 *  the floating console (hostFreezeJob). */
function SpaceTransfers({ jobs, games }: { jobs: FreezeJob[]; games: LibraryGame[] }) {
  const { t } = useI18n();
  const moves = jobs.filter(item => item.mode === "move" && item.drive);
  useEffect(() => {
    const releases = moves.map(item => hostFreezeJob(item.appId));
    return () => releases.forEach(release => release());
  }, [moves.map(item => item.appId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!moves.length) return null;
  return <section className="lm-space-transfers" aria-label={t("spaceTransfersTitle")}>
    <h3 className="ga-label">{t("spaceTransfersTitle")}</h3>
    <ul className="lm-space-moves">{moves.map(item => {
      const from = driveOf(games.find(game => game.app_id === item.appId)?.folder ?? "");
      const percent = item.outcome ? (item.outcome.ok ? 100 : 0) : Math.round(item.progress?.percent ?? 0);
      return <li key={item.appId} className={item.outcome ? (item.outcome.ok ? "is-done" : "is-failed") : item.queued ? "is-queued" : undefined}>
        <span className="lm-space-move-name" title={item.name}>{item.name}</span>
        <span className="lm-space-move-path">{from !== ":" ? <DriveMark letter={from} /> : null}<ArrowRight size={14} aria-hidden="true" /><DriveMark letter={item.drive!.letter} /></span>
        <span className="lm-space-move-state">{item.outcome ? t(item.outcome.ok ? "spaceMoveDone" : item.outcome.cancelled ? "spaceMoveCancelled" : "spaceMoveFailed")
          : item.queued ? t("spaceMoveQueued") : item.progress?.total_bytes ? t("spaceMoveBytes", { done: formatBytes(item.progress.done_bytes), total: formatBytes(item.progress.total_bytes) }) : `${percent} %`}</span>
        <span className="lm-space-move-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
        {!item.outcome ? <GaButton disabled={item.cancelling} onClick={() => cancelFreezeJob(item.appId)}>{item.cancelling ? t("freezeCancelling") : t("moveCancel")}</GaButton> : null}
      </li>;
    })}</ul>
  </section>;
}

/** One disk: its drawing, what it is, and the two roles. Turning off a role it cannot leave says why at the switch. */
function SpaceDisk({ drive, activity }: { drive: LibraryDrive; activity: DiskActivity }) {
  const { t } = useI18n();
  const [changing, setChanging] = useState<DriveRole | null>(null);
  const [tip, setTip] = useState("");
  useEffect(() => { if (!tip) return undefined; const timer = window.setTimeout(() => setTip(""), 6000); return () => window.clearTimeout(timer); }, [tip]);
  const roles = drive.roles ?? { install: drive.enabled, download: drive.temporary };
  const flip = async (role: DriveRole) => {
    const on = !roles[role];
    // A disk with games keeps installing: the switch stays usable so the player can try, and hears what to do.
    if (!on && role === "install" && drive.games > 0) { setTip(t("spaceRoleHasGames")); return; }
    setChanging(role); setTip("");
    try { await setDriveRole(drive, role, on); }
    catch (failure) { setTip(failText(failure)); }
    finally { setChanging(null); }
  };
  // What the disk is, as Windows says it: the short word goes on the disk's own panel, the model in its tooltip, and
  // a disk over a USB port says so beside it (§4.45). The letter is not repeated: it is written on the disk's body.
  const kind = drive.known === false ? "" : KIND_TAG[drive.kind ?? "unknown"];
  return <article className={`lm-bay${roles.install || roles.download ? "" : " is-off"}`} data-letter={drive.letter}
    style={{ "--lm-drive": driveColor(drive.letter), "--lm-led": ledColor(drive.letter) } as CSSProperties}>
    <div className="lm-bay-disk"><DiskCard letter={drive.letter} label={drive.name || t("hddNoName")} activity={activity}
      caption={roles.install && roles.download ? t("spaceUseBoth") : roles.install ? t("spaceUseInstall") : roles.download ? t("spaceUseDownload") : t("spaceDriveUnused")}
      kind={drive.external && kind ? `${kind} ${BUS_USB}` : kind}
      kindTip={[drive.known === false ? t("spaceKindReading") : t(KIND_KEYS[drive.kind ?? "unknown"]), drive.model, drive.external ? t("spaceBusUsbTip") : ""].filter(Boolean).join(" · ")}
      totalBytes={drive.total_bytes} usedBytes={drive.total_bytes - drive.free_bytes} /></div>
    {/* The disk's colour, lit in the window of the column. */}
    <span className="lm-bay-led" aria-hidden="true" />
    {/* The tray's first band: the two switches. */}
    <div className="lm-bay-shelf">
      {(["install", "download"] as DriveRole[]).map(role => {
        // How well the disk suits that use, as a score of three lights: all three when it is the recommended one.
        const lit = drive.recommended?.includes(role) ? 3 : 1;
        return <div key={role} className="lm-bay-role">
          <GaSwitch checked={roles[role]} label={t(role === "install" ? "spaceRoleInstall" : "spaceRoleDownload")} busy={changing === role} disabled={changing != null && changing !== role}
            title={t(role === "install" ? "spaceRoleInstallTip" : "spaceRoleDownloadTip")} onChange={() => void flip(role)} />
          <span className="lm-bay-score" role="img" aria-label={t(lit === 3 ? "spaceRecommended" : "spaceNotRecommended")}
            title={lit === 3 ? t(role === "install" ? "spaceRecommendInstallTip" : "spaceRecommendDownloadTip") : t("spaceNotRecommended")}>
            {[0, 1, 2].map(light => <i key={light} className={light < lit ? "is-on" : undefined} />)}
          </span>
        </div>;
      })}
    </div>
    {/* The second band: what the disk holds, and the warning when it is under its reserve. */}
    <div className="lm-bay-count">
      <span>{t("spaceDriveGames", { count: drive.games })}</span>
      {drive.too_full ? <span className="lm-disk-tag is-warn" title={t("spaceTooFullTip", { size: formatBytes(drive.reserve_bytes ?? 0) })}>{t("spaceTooFull")}</span> : null}
    </div>
    {tip ? <p role="status" className="ga-status is-warn lm-bay-tip">{tip}</p> : null}
  </article>;
}

export default function ManagerSpace({ scrollRef }: { scrollRef?: RefObject<HTMLDivElement> }) {
  const { locale, t } = useI18n(); const c = copy[locale] ?? copy.es;
  const { games, summary, scanning } = useLibraryScan();
  const { drives, loading } = useLibraryDrives();
  const { jobs } = useFreezeConsole();
  // Compressing or uncompressing one game: asked in the app's notice, like everywhere else (FreezeDialog).
  const [zipping, setZipping] = useState<{ game: LibraryGame; mode: FreezeMode } | null>(null);
  useEffect(() => {
    if (!summary) void scanLibrary();
    // What a disk is is asked of Windows once, the first time Space opens after it appeared (then "Rescan disks").
    void loadDrives().then(list => { if (list.some(drive => drive.known === false)) return rescanDrives(true); }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A move going on: its source disk reads, its target disk writes.
  const busy = jobs.find(job => job.drive && !job.outcome && !job.queued);
  const busyFrom = busy ? driveOf(games.find(game => game.app_id === busy.appId)?.folder ?? "") : "";
  const activity = (drive: LibraryDrive): DiskActivity => !busy ? "idle" : drive.letter === busy.drive?.letter ? "writing" : drive.letter === busyFrom ? "reading" : "idle";
  // Only the games Game Access downloaded and manages: not linked folders, not Steam's or other accounts', whole.
  const ours = games.filter(game => game.app_id != null && !game.linked && !isSteamOwned(game) && !game.library && !game.partial && game.folder && (game.size_bytes ?? 0) > 0);

  return <section ref={scrollRef} className="lm-space">
    {!drives ? <p role="status" className="ga-hint">{loading || scanning ? c.scanning : t("spaceDrivesNone")}</p> : <>
      <div className="lm-space-cols">
        {/* Wide enough, the words are a column of their own beside the games and the rack; narrow, they go on top. */}
        <SpaceAside drives={drives} />
        <div className="lm-space-main">
          <SpaceGames games={ours} drives={drives} moving={Boolean(busy)} onZip={(game, mode) => setZipping({ game, mode })} />
          <SpaceTransfers jobs={jobs} games={games} />
        </div>
        <DiskRack letters={drives.map(drive => drive.letter)} transfer={busy?.drive && busyFrom ? { from: busyFrom, to: busy.drive.letter } : null}
          ghosts={Math.max(0, RACK_SHELVES - drives.length)}>
          {drives.map(drive => <SpaceDisk key={drive.letter} drive={drive} activity={activity(drive)} />)}
        </DiskRack>
      </div>
      {zipping ? <FreezeDialog game={asCatalogGame(zipping.game)} mode={zipping.mode} onClose={() => setZipping(null)} /> : null}
    </>}
  </section>;
}
