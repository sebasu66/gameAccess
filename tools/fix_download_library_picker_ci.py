from pathlib import Path

root = Path(__file__).resolve().parents[1]


def replace_once(path_rel: str, old: str, new: str) -> None:
    path = root / path_rel
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path_rel}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


test_path = root / "apps/launcher/tests/test_pool_sync_libraries.py"
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace(
    '    legacy_vdf = root / "steamapps" / "libraryfolders.vdf"\n',
    "",
    1,
)
test_path.write_text(test_text, encoding="utf-8", newline="\n")

replace_once(
    "apps/desktop/src/InstallLocationDialog.tsx",
    "  game: CatalogGame;\n",
    "  game: CatalogGame | null;\n",
)
replace_once(
    "apps/desktop/src/InstallLocationDialog.tsx",
    "}) {\n  const preferred = Number(localStorage.getItem(\"gameaccess:steam-library-index\"));\n",
    "}) {\n  if (!game) return null;\n\n  const preferred = Number(localStorage.getItem(\"gameaccess:steam-library-index\"));\n",
)

old_app = '''      {installLocationRequest ? (
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
'''
new_app = '''      <InstallLocationDialog
        game={installLocationRequest?.game ?? null}
        libraries={installLocationRequest?.libraries ?? []}
        onCancel={() => setInstallLocationRequest(null)}
        onConfirm={(libraryIndex) => {
          const request = installLocationRequest;
          if (!request) return;
          setInstallLocationRequest(null);
          void startDownloadToLibrary(request.game, libraryIndex, true);
        }}
      />
'''
replace_once("apps/desktop/src/App.tsx", old_app, new_app)

old_blob = '''function blobSha(relative) {
  try {
    return execFileSync("git", ["hash-object", relative], { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
'''
new_blob = '''function blobSha(relative) {
  try {
    const entry = execFileSync("git", ["ls-files", "-s", "--", relative], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    return entry.split(/\\s+/)[1] ?? "";
  } catch {
    return "";
  }
}
'''
replace_once("apps/desktop/scripts/quality-gate.mjs", old_blob, new_blob)

print("CI_FIX_PATCH_OK")
Path(__file__).unlink()
