from pathlib import Path

root = Path(__file__).resolve().parents[1]

def replace_once(path_rel: str, old: str, new: str) -> None:
    path = root / path_rel
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path_rel}: {old[:100]!r}")
    text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8", newline="\n")

replace_once(
    "apps/launcher/pool_sync.py",
    "import json\nfrom datetime import datetime, timezone\n",
    "import json\nimport shutil\nfrom datetime import datetime, timezone\n",
)

old_lib_fn = '''def _steam_library_folders(root: Path | None) -> list[dict[str, Any]]:
    if not root:
        return []
    path = root / "steamapps" / "libraryfolders.vdf"
    try:
        parsed = _read_vdf(path)
    except (OSError, ValueError):
        return [{"index": 0, "path": str(root), "label": str(root)}]

    folders = _ci_get(parsed, "libraryfolders")
    if not isinstance(folders, dict):
        return [{"index": 0, "path": str(root), "label": str(root)}]

    result: list[dict[str, Any]] = []
    for raw_index, fields in folders.items():
        if not str(raw_index).isdigit() or not isinstance(fields, dict):
            continue
        folder_path = str(_ci_get(fields, "path") or "").strip()
        if folder_path:
            result.append({"index": int(raw_index), "path": folder_path, "label": folder_path})
    if not result:
        result.append({"index": 0, "path": str(root), "label": str(root)})
    return sorted(result, key=lambda item: item["index"])
'''

new_lib_fn = '''def _library_space(path: Path) -> tuple[int | None, int | None]:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None, None
    return int(usage.free), int(usage.total)


def _library_row(index: int, folder_path: str) -> dict[str, Any]:
    free_bytes, total_bytes = _library_space(Path(folder_path))
    return {
        "index": index,
        "path": folder_path,
        "label": folder_path,
        "free_bytes": free_bytes,
        "total_bytes": total_bytes,
    }


def _steam_library_folders(root: Path | None) -> list[dict[str, Any]]:
    if not root:
        return []

    # Current Steam clients keep libraryfolders.vdf under config/. Older
    # installations/tools may still expose the steamapps/ copy, so keep it as
    # an explicit fallback without renumbering Steam's volume indices.
    folders: dict[str, Any] | None = None
    for path in (
        root / "config" / "libraryfolders.vdf",
        root / "steamapps" / "libraryfolders.vdf",
    ):
        try:
            parsed = _read_vdf(path)
        except (OSError, ValueError):
            continue
        candidate = _ci_get(parsed, "libraryfolders")
        if isinstance(candidate, dict):
            folders = candidate
            break

    if folders is None:
        return [_library_row(0, str(root))]

    result: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for raw_index, fields in folders.items():
        if not str(raw_index).isdigit() or not isinstance(fields, dict):
            continue
        folder_path = str(_ci_get(fields, "path") or "").strip()
        if not folder_path:
            continue
        dedupe_key = folder_path.rstrip("\\/").casefold()
        if dedupe_key in seen_paths:
            continue
        seen_paths.add(dedupe_key)
        result.append(_library_row(int(raw_index), folder_path))

    if not result:
        result.append(_library_row(0, str(root)))
    return sorted(result, key=lambda item: item["index"])
'''
replace_once("apps/launcher/pool_sync.py", old_lib_fn, new_lib_fn)

test_pool = '''from pathlib import Path

import pool_sync


def test_library_discovery_prefers_config_vdf_and_preserves_indices(monkeypatch, tmp_path: Path):
    root = tmp_path / "Steam"
    config_vdf = root / "config" / "libraryfolders.vdf"
    legacy_vdf = root / "steamapps" / "libraryfolders.vdf"
    calls: list[Path] = []

    def fake_read(path: Path):
        calls.append(path)
        if path == config_vdf:
            return {
                "libraryfolders": {
                    "0": {"path": str(root)},
                    "3": {"path": str(tmp_path / "Games")},
                }
            }
        raise AssertionError(f"legacy VDF should not be read after config succeeds: {path}")

    monkeypatch.setattr(pool_sync, "_read_vdf", fake_read)
    monkeypatch.setattr(pool_sync, "_library_space", lambda _path: (123, 456))

    folders = pool_sync._steam_library_folders(root)

    assert calls == [config_vdf]
    assert [folder["index"] for folder in folders] == [0, 3]
    assert folders[1]["free_bytes"] == 123
    assert folders[1]["total_bytes"] == 456


def test_library_discovery_falls_back_to_steamapps_vdf(monkeypatch, tmp_path: Path):
    root = tmp_path / "Steam"
    config_vdf = root / "config" / "libraryfolders.vdf"
    legacy_vdf = root / "steamapps" / "libraryfolders.vdf"
    calls: list[Path] = []

    def fake_read(path: Path):
        calls.append(path)
        if path == config_vdf:
            raise OSError("not present")
        if path == legacy_vdf:
            return {"libraryfolders": {"2": {"path": str(tmp_path / "LegacyGames")}}}
        raise AssertionError(path)

    monkeypatch.setattr(pool_sync, "_read_vdf", fake_read)
    monkeypatch.setattr(pool_sync, "_library_space", lambda _path: (None, None))

    folders = pool_sync._steam_library_folders(root)

    assert calls == [config_vdf, legacy_vdf]
    assert folders == [{
        "index": 2,
        "path": str(tmp_path / "LegacyGames"),
        "label": str(tmp_path / "LegacyGames"),
        "free_bytes": None,
        "total_bytes": None,
    }]


def test_library_discovery_deduplicates_paths_without_renumbering(monkeypatch, tmp_path: Path):
    root = tmp_path / "Steam"

    monkeypatch.setattr(
        pool_sync,
        "_read_vdf",
        lambda _path: {
            "libraryfolders": {
                "0": {"path": str(root)},
                "1": {"path": str(root) + "/"},
                "4": {"path": str(tmp_path / "Other")},
            }
        },
    )
    monkeypatch.setattr(pool_sync, "_library_space", lambda _path: (10, 20))

    folders = pool_sync._steam_library_folders(root)

    assert [folder["index"] for folder in folders] == [0, 4]
'''
(root / "apps/launcher/tests/test_pool_sync_libraries.py").write_text(test_pool, encoding="utf-8", newline="\n")

replace_once(
    "apps/desktop/src/native.ts",
    "  prepared_target?: string | null;\n  error?: string | null;\n",
    "  prepared_target?: string | null;\n  library_index?: number | null;\n  error?: string | null;\n",
)
replace_once(
    "apps/desktop/src/native.ts",
    '''export interface SteamLibraryFolder {
  index: number;
  path: string;
  label: string;
}
''',
    '''export interface SteamLibraryFolder {
  index: number;
  path: string;
  label: string;
  free_bytes?: number | null;
  total_bytes?: number | null;
}
''',
)
replace_once(
    "apps/desktop/src/native.ts",
    "  library_folders?: SteamLibraryFolder[];\n}\n",
    "  library_folders?: SteamLibraryFolder[];\n  library_folder_count?: number;\n}\n",
)

needle = '''export async function getLocalSteamPool(): Promise<LocalSteamPool | null> {
  await narrate("Native layer: reading Steam remembered accounts and their local library/access data.", { area: "LOCAL STEAM" });
  try {
    const pool = hasTauriRuntime()
      ? await invoke<LocalSteamPool>("local_steam_pool")
      : await bridgeRequest<LocalSteamPool>("/local-steam-pool");
    await narrate(
      `Native Steam scan completed: ${pool.accounts.length} remembered account(s), ${pool.games.length} game record(s), source='${pool.source}'.`,
      { area: "LOCAL STEAM" },
    );
    return pool;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await narrate(`Native Steam scan failed: ${message}.`, { area: "LOCAL STEAM", level: "ERROR" });
    return null;
  }
}
'''
replace_once(
    "apps/desktop/src/native.ts",
    needle,
    needle + '''
export async function getSteamLibraryFolders(): Promise<SteamLibraryFolder[]> {
  if (getCatalogMode() !== "gameaccess") return [];
  const pool = await getLocalSteamPool();
  return [...(pool?.library_folders ?? [])].sort((left, right) => left.index - right.index);
}
''',
)
replace_once(
    "apps/desktop/src/native.ts",
    "export async function openSteamInstall(appId: number): Promise<void> {\n",
    "export async function openSteamInstall(appId: number, libraryIndex: number | null = null): Promise<void> {\n",
)
replace_once(
    "apps/desktop/src/native.ts",
    '''      await bridgeRequest("/open-steam-install", { method: "POST", body: JSON.stringify({ appId }) });
''',
    '''      await bridgeRequest("/open-steam-install", { method: "POST", body: JSON.stringify({ appId, libraryIndex }) });
''',
)
replace_once(
    "apps/desktop/src/native.ts",
    '''      const status = await invoke<SteamDownloadStatus>("start_provider_download", { appId, jobId: lifecycle?.job_id ?? null });
''',
    '''      const status = await invoke<SteamDownloadStatus>("start_provider_download", {
        appId,
        jobId: lifecycle?.job_id ?? null,
        libraryIndex,
      });
''',
)

replace_once(
    "apps/desktop/src/nativeDownloadRouting.test.ts",
    '''    expect(invokeMock).toHaveBeenCalledWith("start_provider_download", { appId: 222, jobId: "job-222" });
''',
    '''    expect(invokeMock).toHaveBeenCalledWith("start_provider_download", { appId: 222, jobId: "job-222", libraryIndex: null });
''',
)

insert_after = '''  it("registers one durable job and uses the provider downloader for the GameAccess catalog", async () => {
    installRuntime("gameaccess");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "register_download_job") return lifecycle(222);
      if (command === "start_provider_download") return status(222, "preparing");
      if (command === "provider_download_status") return status(222, "preparing");
      if (command === "steam_download_status") return { ...status(222, "preparing"), state: "not-installed" };
      throw new Error(`unexpected command: ${command}`);
    });

    await openSteamInstall(222);

    expect(invokeMock).toHaveBeenCalledWith("register_download_job", { appId: 222, jobId: expect.stringMatching(/^ui-222-/) });
    expect(invokeMock).toHaveBeenCalledWith("start_provider_download", { appId: 222, jobId: "job-222", libraryIndex: null });
    expect(invokeMock).not.toHaveBeenCalledWith("local_steam_pool");
    expect(invokeMock).not.toHaveBeenCalledWith("open_steam_install", expect.anything());
  });
'''
replace_once(
    "apps/desktop/src/nativeDownloadRouting.test.ts",
    insert_after,
    insert_after + '''
  it("passes the selected Steam library index to the provider downloader", async () => {
    installRuntime("gameaccess");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "register_download_job") return lifecycle(222);
      if (command === "start_provider_download") return status(222, "preparing");
      if (command === "provider_download_status") return status(222, "preparing");
      if (command === "steam_download_status") return { ...status(222, "preparing"), state: "not-installed" };
      throw new Error(`unexpected command: ${command}`);
    });

    await openSteamInstall(222, 3);

    expect(invokeMock).toHaveBeenCalledWith("start_provider_download", {
      appId: 222,
      jobId: "job-222",
      libraryIndex: 3,
    });
  });
''',
)

dialog = '''import { useMemo, useState } from "react";
import { Check, HardDrive, X } from "lucide-react";

import type { SteamLibraryFolder } from "./native";
import type { CatalogGame } from "./types";

export function InstallLocationDialog({
  game,
  libraries,
  onConfirm,
  onCancel,
}: {
  game: CatalogGame;
  libraries: SteamLibraryFolder[];
  onConfirm: (libraryIndex: number) => void;
  onCancel: () => void;
}) {
  const preferred = Number(localStorage.getItem("gameaccess:steam-library-index"));
  const initial = useMemo(
    () => libraries.some((library) => library.index === preferred) ? preferred : libraries[0]?.index ?? 0,
    [libraries, preferred],
  );
  const [selectedIndex, setSelectedIndex] = useState(initial);

  const confirm = () => {
    localStorage.setItem("gameaccess:steam-library-index", String(selectedIndex));
    onConfirm(selectedIndex);
  };

  return (
    <div role="presentation" className="modal-backdrop" onPointerDown={onCancel}>
      <section
        className="game-options-dialog"
        style={{ width: "min(580px, 92vw)" }}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Elegir ubicación de instalación para ${game.name}`}
      >
        <span className="eyebrow">UBICACIÓN DE INSTALACIÓN</span>
        <h2>{game.name}</h2>
        <p>Elegí en qué biblioteca de Steam querés guardar el juego. GameAccess usará esta ubicación sin abrir el selector de Steam.</p>

        <div style={{ display: "grid", gap: 10 }}>
          {libraries.map((library) => {
            const selected = library.index === selectedIndex;
            return (
              <button
                type="button"
                key={`${library.index}:${library.path}`}
                className="secondary-button"
                aria-pressed={selected}
                onClick={() => setSelectedIndex(library.index)}
                style={{
                  minHeight: 68,
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  borderColor: selected ? "rgba(89, 178, 255, .8)" : undefined,
                  boxShadow: selected ? "0 0 0 1px rgba(89, 178, 255, .24) inset" : undefined,
                }}
              >
                <HardDrive size={22} />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{library.label || library.path}</strong>
                  <small style={{ display: "block", opacity: .72, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {library.free_bytes == null ? "Espacio libre no disponible" : `${formatBytes(library.free_bytes)} libres`}
                  </small>
                </span>
                {selected ? <Check size={20} /> : null}
              </button>
            );
          })}
        </div>

        <div className="glass-actions-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="secondary-button" onClick={onCancel}><X size={16} /> Cancelar</button>
          <button type="button" className="primary-button" onClick={confirm}><HardDrive size={17} /> Descargar aquí</button>
        </div>
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 3 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
'''
(root / "apps/desktop/src/InstallLocationDialog.tsx").write_text(dialog, encoding="utf-8", newline="\n")

replace_once(
    "apps/desktop/src/App.tsx",
    'import { getMachineProfile, getVisualDebugConfig, captureVisualDebug, finishVisualDebug, openSteamInstall, openSteamClientInstall, openSteamRun, steamDownloadStatus, steamInstalled, steamInstalledAppIds, switchSteamAccount, setVisualDebugViewport, type MachineProfile } from "./native";\n',
    'import { getMachineProfile, getVisualDebugConfig, captureVisualDebug, finishVisualDebug, getSteamLibraryFolders, openSteamInstall, openSteamClientInstall, openSteamRun, steamDownloadStatus, steamInstalled, steamInstalledAppIds, switchSteamAccount, setVisualDebugViewport, type MachineProfile, type SteamLibraryFolder } from "./native";\n',
)
replace_once(
    "apps/desktop/src/App.tsx",
    'import { DetailPanel } from "./AppDetailPanel";\n',
    'import { DetailPanel } from "./AppDetailPanel";\nimport { InstallLocationDialog } from "./InstallLocationDialog";\n',
)
replace_once(
    "apps/desktop/src/App.tsx",
    '  const [downloads, setDownloads] = useState<DownloadMap>({});\n',
    '  const [downloads, setDownloads] = useState<DownloadMap>({});\n  const [installLocationRequest, setInstallLocationRequest] = useState<{ game: CatalogGame; libraries: SteamLibraryFolder[] } | null>(null);\n',
)

old_start = '''  const startDownload = async (game: CatalogGame) => {
    if (!game.app_id) return;
    const markRequested = () => {
      setDownloads((current) => ({ ...current, [game.app_id!]: { app_id: game.app_id!, state: "requested", progress: null, bytes_downloaded: null, bytes_total: null, installed: false } }));
      rememberRecent(game);
    };
    try {
      await openSteamInstall(game.app_id);
      rememberRecent(game);
      const status = await steamDownloadStatus(game.app_id);
      setDownloads((current) => ({ ...current, [game.app_id!]: status }));
      setToast(status.error ?? "Solicitud aceptada. gameAccess mostrará la preparación y el progreso real.");
    } catch (directError) {
      try {
        const fallbackLease = await leaseGame(game.id, 5);
        try {
          await openSteamClientInstall(game.app_id);
        } finally {
          await releaseDownloadFallbackLease(fallbackLease);
        }
        markRequested();
        setToast("No se pudo usar la descarga directa. gameAccess inició una cuenta proveedora y dejó la descarga a cargo de Steam.");
      } catch (fallbackError) {
        const directMessage = directError instanceof Error ? directError.message : String(directError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setToast(`Descarga directa: ${directMessage} · Fallback Steam: ${fallbackMessage}`);
      }
    }
  };
'''
new_start = '''  const startDownloadToLibrary = async (
    game: CatalogGame,
    libraryIndex: number | null,
    requireSelectedLibrary = false,
  ) => {
    if (!game.app_id) return;
    const markRequested = () => {
      setDownloads((current) => ({ ...current, [game.app_id!]: { app_id: game.app_id!, state: "requested", progress: null, bytes_downloaded: null, bytes_total: null, installed: false, library_index: libraryIndex } }));
      rememberRecent(game);
    };
    try {
      await openSteamInstall(game.app_id, libraryIndex);
      rememberRecent(game);
      const status = await steamDownloadStatus(game.app_id);
      setDownloads((current) => ({ ...current, [game.app_id!]: status }));
      setToast(status.error ?? "Solicitud aceptada. gameAccess mostrará la preparación y el progreso real.");
    } catch (directError) {
      const directMessage = directError instanceof Error ? directError.message : String(directError);
      if (requireSelectedLibrary) {
        setToast(`No se pudo iniciar la descarga en la biblioteca elegida: ${directMessage}`);
        return;
      }
      try {
        const fallbackLease = await leaseGame(game.id, 5);
        try {
          await openSteamClientInstall(game.app_id);
        } finally {
          await releaseDownloadFallbackLease(fallbackLease);
        }
        markRequested();
        setToast("No se pudo usar la descarga directa. gameAccess inició una cuenta proveedora y dejó la descarga a cargo de Steam.");
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        setToast(`Descarga directa: ${directMessage} · Fallback Steam: ${fallbackMessage}`);
      }
    }
  };

  const startDownload = async (game: CatalogGame) => {
    if (!game.app_id) return;
    try {
      const libraries = await getSteamLibraryFolders();
      if (libraries.length > 1) {
        setInstallLocationRequest({ game, libraries });
        return;
      }
      await startDownloadToLibrary(game, libraries[0]?.index ?? null);
    } catch {
      await startDownloadToLibrary(game, null);
    }
  };
'''
replace_once("apps/desktop/src/App.tsx", old_start, new_start)

replace_once(
    "apps/desktop/src/App.tsx",
    '      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}\n      {toast ? <div className="toast">{toast}</div> : null}\n',
    '''      {session ? <SessionOverlay session={session} onClose={() => setSession(null)} /> : null}
      {installLocationRequest ? (
        <InstallLocationDialog
          game={installLocationRequest.game}
          libraries={installLocationRequest.libraries}
          onCancel={() => setInstallLocationRequest(null)}
          onConfirm={(libraryIndex) => {
            const request = installLocationRequest;
            setInstallLocationRequest(null);
            void startDownloadToLibrary(request.game, libraryIndex, true);
          }}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
''',
)

print("PATCH_OK")

Path(__file__).unlink()
