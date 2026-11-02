import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// tools/windows/defender-exclusion.ps1 (run by the installer and, elevated, by antivirus.rs) with Defender simulated:
// Get-MpPreference / Add-MpPreference are functions here, which PowerShell prefers to the real cmdlets, and the record
// goes to a throwaway key under HKCU instead of HKLM\Software\gameAccess.
const SCRIPT = resolve(__dirname, "../../../tools/windows/defender-exclusion.ps1");

function run(existing: string[], paths: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "ga-defender-"));
  const key = `Software\\gameAccess-test-${process.pid}-${Date.now()}`;
  const harness = join(dir, "harness.ps1");
  writeFileSync(harness, `
$global:excl = @(${existing.map(path => `'${path}'`).join(", ")})
function Get-MpPreference { [pscustomobject]@{ ExclusionPath = $global:excl } }
function Add-MpPreference { param($ExclusionPath) if ($ExclusionPath -like '*Blocked*') { throw 'Operation blocked by policy' }; $global:excl += $ExclusionPath }
& '${SCRIPT}' -Paths '${paths.join("|")}' -Result '${join(dir, "out.json")}' -RecordHive CurrentUser -RecordKey '${key}'
$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}')
[string]$(if ($k) { $k.GetValue('DefenderExclusions', '') }) | Set-Content -LiteralPath '${join(dir, "record.txt")}'
[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${key}', $false)
`);
  try {
    try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness], { stdio: "pipe" }); } catch { /* exit 1 when a folder failed */ }
    const outcome = JSON.parse(readFileSync(join(dir, "out.json"), "utf8").replace(/^\uFEFF/, ""));
    const record = readFileSync(join(dir, "record.txt"), "utf8").replace(/^\uFEFF/, "").trim();
    return { outcome, record };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe.skipIf(process.platform !== "win32")("defender-exclusion.ps1", () => {
  it("leaves covered folders alone, adds the rest, reads them back and records what is covered", () => {
    const { outcome, record } = run(["C:\\Juegos"], ["C:\\Juegos\\GA", "D:\\Descargas\\GameAccessDownloads"]);
    expect(outcome.already).toEqual(["C:\\Juegos\\GA"]);
    expect(outcome.added).toEqual(["D:\\Descargas\\GameAccessDownloads"]);
    expect(outcome.failed).toEqual([]);
    expect(record.split("|").sort()).toEqual(["C:\\Juegos\\GA", "D:\\Descargas\\GameAccessDownloads"]);
  }, 30_000);

  it("a folder Defender refuses is reported as failed and left out of the record", () => {
    const { outcome, record } = run([], ["C:\\GA_Juegos", "C:\\Blocked"]);
    expect(outcome.added).toEqual(["C:\\GA_Juegos"]);
    expect(outcome.failed).toEqual(["C:\\Blocked"]);
    expect(outcome.error).toContain("blocked");
    expect(record).toBe("C:\\GA_Juegos");
  }, 30_000);
});
