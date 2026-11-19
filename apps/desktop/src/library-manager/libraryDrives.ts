/**
 * The library on several disks (Seba, 2026-11-17; roles, speed and freeing a disk 2026-11-18): the fixed disks from the
 * launcher (game_library_manager/drives.py) with what each may be used for (installing games, holding downloads), what
 * it is and how fast it reads. Game Access picks the disk for each new game itself (storage.py, the fastest allowed disk
 * with room that keeps its reserve free). Manager › Space draws them; a game moves to another disk from its row. One
 * shared list, read again after every change.
 */
import { useSyncExternalStore } from "react";
import { digitalProcessManager, type DriveEvacuation, type DriveRole, type LibraryDrive, type LibraryGame } from "../catalog/DigitalProcessManager";
import type { CatalogGame } from "../types";
import { translate } from "../i18n";
import { confirmNotice, hideNotice } from "../notice/notice";
import { cancelFreezeJob, startFreezeJob } from "../freezeJobs";
import { isSteamOwned } from "../steamLibrary";
import { formatBytes } from "./format";
import { libraryDemo, libraryScanState } from "../libraryScan";
import { uiDemo } from "../devDemo/uiDemo";

const TB = 1000 ** 4, GB = 1000 ** 3;
const demo = () => (libraryDemo() || uiDemo()) && !(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
const demoDisk = (letter: string, name: string, total: number, free: number, games: number, roles: { install: boolean; download: boolean }, kind: LibraryDrive["kind"], external = false): LibraryDrive => ({
  path: `${letter}\\`, label: letter, letter, name, total_bytes: total, free_bytes: free, primary: letter === "C:", enabled: roles.install || roles.download,
  folder: `${letter}\\GA_Juegos`, download_folder: `${letter}\\GameAccessDownloads`, games, temporary: false, install: false, roles, kind, known: true,
  bus: external ? "USB" : kind === "nvme" ? "NVMe" : "SATA", external,
  model: { nvme: "XPG GAMMIX S70 BLADE", ssd: "CT500BX500SSD1", hdd: "ST33000651AS", unknown: "" }[kind ?? "unknown"],
  recommended: kind === "hdd" || external ? ["download"] : ["install"],
});
let demoDrives: LibraryDrive[] = [
  demoDisk("C:", "Sistema", 3.7 * TB, 117 * GB, 16, { install: true, download: true }, "nvme"),
  demoDisk("E:", "Windows 10", 466 * GB, 63 * GB, 0, { install: true, download: false }, "nvme"),
  demoDisk("F:", "W10", 2.7 * TB, 852 * GB, 0, { install: false, download: false }, "hdd"),
  demoDisk("G:", "SSD_500", 466 * GB, 191 * GB, 0, { install: false, download: false }, "ssd"),
];

let drives: LibraryDrive[] | null = null;
let loading = false;
let rescanning = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

/** The reserve each disk keeps free (storage.keep_free), as the launcher does it. */
const reserveOf = (drive: LibraryDrive, percent = 5, gb = 30) => Math.min(drive.total_bytes * percent / 100, gb * 1024 ** 3);
/** The same order the launcher uses (disk_profile.rank_of): what the disk is, and one over USB after its kind. */
const TYPICAL_MBPS = { nvme: 2500, ssd: 450, hdd: 130, unknown: 100 };
const rank = (drive: LibraryDrive) => {
  const kind = drive.kind ?? "unknown";
  const speed = TYPICAL_MBPS[kind] * (drive.external ? 0.35 : 1);
  return (drive.external ? 0 : { nvme: 3, ssd: 2, hdd: 1, unknown: 0 }[kind]) * 1e6 + speed;
};
/** The disks allowed for a role, best first (what the launcher tries first for a new game). */
export const policyOrder = (list: LibraryDrive[], role: DriveRole) => list.filter(drive => drive.roles?.[role]).sort((a, b) => rank(b) - rank(a));

/** In the browser demo, where the next download and install go, as storage.pick does it. */
const placeDemo = (list: LibraryDrive[]) => {
  const first = (role: DriveRole) => policyOrder(list, role).find(drive => drive.free_bytes - 1024 ** 3 >= reserveOf(drive))?.letter;
  const install = first("install"), download = first("download");
  return list.map(drive => ({ ...drive, enabled: Boolean(drive.roles?.install || drive.roles?.download), install: drive.letter === install, temporary: drive.letter === download }));
};

export async function loadDrives(): Promise<LibraryDrive[]> {
  loading = true; emit();
  try {
    drives = demo() ? placeDemo(demoDrives) : (await digitalProcessManager.libraryDrives()).drives ?? [];
    return drives;
  } finally { loading = false; emit(); }
}

/** What each disk is, asked of Windows: the ones not looked at yet (`onlyMissing`, when Space opens) or all of them
 *  ("Rescan disks", also finding a disk plugged in later). One PowerShell call for every disk, a moment; nothing is
 *  written to or read from the disks (Seba, 2026-11-18: the read-speed test froze Space while it ran). */
export async function rescanDrives(onlyMissing: boolean): Promise<void> {
  if (rescanning) return;
  rescanning = true; emit();
  try {
    if (demo()) { await new Promise(done => setTimeout(done, 400)); drives = placeDemo(demoDrives); return; }
    const result = await digitalProcessManager.libraryDrives({ profile: true, only_missing: onlyMissing }) as { drives?: LibraryDrive[]; error?: string };
    if (result.error) throw new Error(result.error);
    drives = result.drives ?? drives;
  } finally { rescanning = false; emit(); }
}

/** A disk allowed or not to install games or to hold downloads. Throws the launcher's reason (games still there, a
 *  download under way, the last disk for that role). */
export async function setDriveRole(drive: LibraryDrive, role: DriveRole, on: boolean): Promise<void> {
  if (demo()) {
    if (!on && role === "install" && drive.games) throw new Error(translate("spaceDriveHasGames"));
    if (!on && policyOrder(demoDrives, role).length <= 1) throw new Error(translate(role === "install" ? "spaceRoleLastInstall" : "spaceRoleLastDownload"));
    demoDrives = demoDrives.map(item => item.letter === drive.letter ? { ...item, roles: { ...(item.roles ?? { install: false, download: false }), [role]: on } } : item);
    drives = placeDemo(demoDrives); emit(); return;
  }
  const result = await digitalProcessManager.libraryDrives({ drive: drive.path, on, role }) as { drives?: LibraryDrive[]; ok?: boolean; error?: string };
  if (result.error) throw new Error(result.error);
  drives = result.drives ?? drives; emit();
}

/** The older single switch: a disk used or not for installing games. */
export const setDrive = (drive: LibraryDrive, on: boolean) => setDriveRole(drive, "install", on);

export function useLibraryDrives(): { drives: LibraryDrive[] | null; loading: boolean; rescanning: boolean } {
  const list = useSyncExternalStore(subscribe, () => drives);
  const busy = useSyncExternalStore(subscribe, () => loading);
  const rescan = useSyncExternalStore(subscribe, () => rescanning);
  return { drives: list, loading: busy, rescanning: rescan };
}

/** One colour per disk, the same in Space, the Library Manager's Disk column and the footer: by its letter, so a
 *  disk keeps its colour whatever others are plugged in (`--ga-drive-1` … `--ga-drive-6`, in the flavor). */
export const driveColor = (letter: string) => `var(--ga-drive-${driveSlot(letter)})`;
const driveSlot = (letter: string) => (Math.max(0, letter.toUpperCase().charCodeAt(0) - 67) % 6) + 1;
/** The same disk, as a lit LED: the saturated colour of a real indicator, not the softer one of the screens. */
export const ledColor = (letter: string) => `var(--ga-led-${driveSlot(letter)})`;

/** A game of the library that can change disk: ours (not linked, not only owned on Steam), whole and not frozen. */
export const movableToDrive = (game: LibraryGame) => game.app_id != null && !game.linked && !isSteamOwned(game) && !game.frozen && !game.partial && !game.unfinished;

/** The other disks allowed to install games a game can go to, with room for it. */
export const drivesFor = (game: LibraryGame, list: LibraryDrive[] | null) =>
  (list ?? []).filter(drive => (drive.roles?.install ?? drive.enabled) && drive.letter !== driveOf(game.folder ?? "") && (game.size_bytes ?? 0) < drive.free_bytes);

const asGame = (game: { app_id: number; name: string }) => ({ id: game.app_id, app_id: game.app_id, name: game.name } as CatalogGame);

/** Asks, then moves the game to that disk as a job with its bar (freezeJobs, the launcher's drives.py). */
export async function askMoveToDrive(game: LibraryGame, drive: LibraryDrive): Promise<void> {
  const ok = await confirmNotice({ title: translate("spaceMoveTitle", { name: game.name, drive: drive.letter }),
    text: translate("spaceMoveText", { size: formatBytes(game.size_bytes ?? 0), free: formatBytes(drive.free_bytes), drive: drive.letter }),
    confirmLabel: translate("spaceMoveYes", { drive: drive.letter }), cancelLabel: translate("noticeCancel") });
  if (!ok) return;
  hideNotice();
  void startFreezeJob(asGame({ app_id: game.app_id!, name: game.name }), "move", { drive: { folder: drive.folder, letter: drive.letter } }).done.then(() => { void loadDrives().catch(() => undefined); });
}

/** The disk a folder is on ("D:"), as the launcher writes drive letters. */
export const driveOf = (folder: string) => (/^([a-z]):/i.exec(folder)?.[1] ?? "").toUpperCase() + ":";

// -- free a disk (Seba, 2026-11-18) ---------------------------------------------------------------------------------
/** Freeing a disk: its plan and how far it got. One at a time. */
export interface DiskBatch { source: string; target: string; moves: NonNullable<DriveEvacuation["moves"]>; done: number; current: number | null; cancelled: boolean; finished: boolean }
let batch: DiskBatch | null = null;
const setBatch = (next: DiskBatch | null) => { batch = next; emit(); };
export const useDiskBatch = () => useSyncExternalStore(subscribe, () => batch);

/** What freeing `source` would move and where (`target` "auto": spread evenly by room), and whether it fits. */
export async function planFreeDisk(source: string, target: string): Promise<DriveEvacuation> {
  if (!demo()) {
    const result = await digitalProcessManager.libraryDriveEvacuate(source, target, true);
    return result.evacuate ?? { ok: false, error: "" };
  }
  const list = drives ?? [];
  const targets = target === "auto" ? list.filter(drive => drive.roles?.install && drive.letter !== source) : list.filter(drive => drive.letter === target);
  if (!targets.length) return { ok: false, error: translate("spaceFreeNoTarget") };
  const room = new Map(targets.map(drive => [drive.letter, drive.free_bytes - reserveOf(drive) - 1024 ** 3]));
  const games = libraryScanState().games.filter(game => movableToDrive(game) && driveOf(game.folder ?? "") === source).sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0));
  const moves = games.map(game => {
    const best = [...room.entries()].sort((a, b) => b[1] - a[1])[0][0];
    room.set(best, room.get(best)! - (game.size_bytes ?? 0));
    return { app_id: game.app_id!, name: game.name, bytes: game.size_bytes ?? 0, target: best, folder: list.find(drive => drive.letter === best)!.folder };
  });
  const short = [...room.entries()].filter(([, left]) => left < 0).map(([drive, left]) => ({ drive, missing_bytes: -left }));
  return { ok: !short.length, source, moves, short, skipped: [], bytes: moves.reduce((sum, move) => sum + move.bytes, 0) };
}

/** Frees a disk: checked first (nothing starts when something does not fit), then each game moves on its own and whole,
 *  one after the other, as the move jobs of Activity. Cancelling stops the game being copied (it stays where it was)
 *  and the rest; the games already moved stay moved. */
export async function startFreeDisk(source: string, target: string): Promise<DriveEvacuation> {
  if (batch && !batch.finished) throw new Error(translate("spaceFreeBusy"));
  const plan = await planFreeDisk(source, target);
  if (!plan.ok || !plan.moves?.length) return plan;
  setBatch({ source, target, moves: plan.moves, done: 0, current: null, cancelled: false, finished: false });
  void (async () => {
    for (const move of plan.moves!) {
      if (!batch || batch.cancelled) break;
      setBatch({ ...batch, current: move.app_id });
      const outcome = await startFreezeJob(asGame(move), "move", { drive: { folder: move.folder, letter: move.target } }).done;
      if (!batch) break;
      if (outcome.cancelled) { setBatch({ ...batch, cancelled: true }); break; }
      setBatch({ ...batch, done: batch.done + (outcome.ok ? 1 : 0) });
    }
    if (batch) setBatch({ ...batch, current: null, finished: true });
    void loadDrives().catch(() => undefined);
  })();
  return plan;
}

export function cancelFreeDisk(): void {
  if (!batch || batch.finished) return;
  const current = batch.current;
  setBatch({ ...batch, cancelled: true });
  if (current != null) cancelFreezeJob(current);
}

export const dismissFreeDisk = () => { if (batch?.finished) setBatch(null); };
