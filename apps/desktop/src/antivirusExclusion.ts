import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import { narrate } from "./narrationLog";
import { uiDemo } from "./devDemo/uiDemo";

/**
 * The antivirus and the direct-download folders (Seba, 2026-11-02). A game's fix or crack is sometimes flagged as a
 * threat although it is not one; the antivirus deletes a DLL or an .exe and the game no longer starts. Microsoft
 * Defender can leave the games folder and the temporary downloads folder alone; Steam and linked games live elsewhere
 * and need nothing. Asked at install (windows/hooks.nsh), at the first start and when the games folder changes.
 *
 * `antivirus_probe` (antivirus.rs) reads without administrator rights, so Windows usually hides the exclusions
 * (`exclusions` null); then what is known comes from the organization's policy, the record that
 * `defender-exclusion.ps1` leaves in the registry once it has added and read them back, and the folders the person
 * says they excluded by hand.
 */
export interface AntivirusProbe {
  products: Array<{ name: string; state: number }>;
  /** null: Windows did not show them ("N/A: Must be an administrator to view exclusions"). */
  exclusions: string[] | null;
  policyExclusions: string[];
  /** The organization's policy ignores the exclusions made on this PC. */
  localMergeDisabled: boolean;
  recorded: string[];
  defenderMode?: string;
}

export type AntivirusState =
  /** Every folder is excluded (or Defender is not there to bother them). */
  | { kind: "covered" }
  /** Defender is the antivirus and some folders are not excluded (`known`: read, not guessed). */
  | { kind: "missing"; missing: string[]; known: boolean }
  /** Another antivirus is on: it has its own exclusions, set by hand. */
  | { kind: "other"; product: string; missing: string[] }
  /** The organization manages Defender: only its administrator can exclude folders. */
  | { kind: "managed"; missing: string[] };

export interface AddOutcome { added: string[]; already: string[]; failed: string[]; managed: boolean; error: string }

const DISMISSED_KEY = "gameaccess:antivirus_dismissed";
const MANUAL_KEY = "gameaccess:antivirus_manual";

const normalize = (path: string) => path.trim().replace(/^"|"$/g, "").replace(/\//g, "\\").replace(/\\\*?$/, "").toLowerCase();

/** Whether an exclusion covers the folder: the same folder or one above it (`C:\` covers everything on the disk). */
export function coveredBy(folder: string, exclusions: readonly string[]): boolean {
  const target = normalize(folder);
  return exclusions.some(exclusion => {
    const base = normalize(exclusion);
    if (!base || base.includes("*")) return false;
    return target === base || target.startsWith(base.endsWith("\\") ? base : `${base}\\`);
  });
}

/** Security Center's productState: bit 0x1000 says the antivirus is on. */
const isOn = (state: number) => (state & 0x1000) !== 0;
const isDefender = (name: string) => /defender/i.test(name);

/** What to tell the person about these folders, from what the probe read (pure: tested with simulated answers). */
export function antivirusState(probe: AntivirusProbe, folders: readonly string[], manual: readonly string[] = []): AntivirusState {
  const wanted = [...new Set(folders.map(folder => folder.trim()).filter(Boolean))];
  const known = [...(probe.exclusions ?? []), ...probe.policyExclusions, ...probe.recorded, ...manual];
  const missing = wanted.filter(folder => !coveredBy(folder, known));
  const active = probe.products.filter(product => isOn(product.state));
  const other = active.find(product => !isDefender(product.name));
  if (other) {
    // Defender in passive mode does not delete anything; the other antivirus does. Only the folders it was told about count.
    const told = wanted.filter(folder => !coveredBy(folder, manual));
    return told.length ? { kind: "other", product: other.name, missing: told } : { kind: "covered" };
  }
  const defenderOn = active.some(product => isDefender(product.name)) || (!probe.products.length && Boolean(probe.defenderMode));
  if (!defenderOn) return { kind: "covered" };
  // Exclusions made on this PC are ignored: only the ones the organization sets (or the person was told about) count.
  if (probe.localMergeDisabled) {
    const outside = wanted.filter(folder => !coveredBy(folder, [...probe.policyExclusions, ...manual]));
    return outside.length ? { kind: "managed", missing: outside } : { kind: "covered" };
  }
  return missing.length ? { kind: "missing", missing, known: probe.exclusions !== null } : { kind: "covered" };
}

function readList(key: string): string[] {
  try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.map(String) : []; } catch { return []; }
}
function writeList(key: string, list: string[]) {
  try { localStorage.setItem(key, JSON.stringify([...new Set(list)])); } catch { /* private storage: it asks again next time */ }
}
const setKey = (folders: readonly string[]) => folders.map(normalize).sort().join("|");

/** "No, thanks": not asked again for these folders. A new games folder asks once more. */
export const dismissAntivirus = (folders: readonly string[]) => writeList(DISMISSED_KEY, [...readList(DISMISSED_KEY), setKey(folders)]);
export const antivirusDismissed = (folders: readonly string[]) => readList(DISMISSED_KEY).includes(setKey(folders));
/** "I did it": excluded by hand (Windows does not let the app read it back). */
export const markExcludedByHand = (folders: readonly string[]) => writeList(MANUAL_KEY, [...readList(MANUAL_KEY), ...folders]);
export const excludedByHand = () => readList(MANUAL_KEY);

// `?uiDemo=1&antivirus=missing|other|managed` shows the dialog in the browser preview with a simulated answer.
const demoKind = () => (import.meta.env.DEV && uiDemo() ? new URLSearchParams(window.location.search).get("antivirus") : null);
const demoProbe = (kind: string): AntivirusProbe => ({
  products: kind === "other" ? [{ name: "Windows Defender", state: 393472 }, { name: "Avast Antivirus", state: 266240 }] : [{ name: "Windows Defender", state: 397568 }],
  exclusions: null, policyExclusions: [], localMergeDisabled: kind === "managed", recorded: [], defenderMode: "Normal",
});
let demoAdded: string[] = [];

export async function probeAntivirus(): Promise<AntivirusProbe | null> {
  const demo = demoKind();
  if (demo) return { ...demoProbe(demo), recorded: demoAdded };
  if (!hasTauriRuntime()) return null;
  try { return await invoke<AntivirusProbe>("antivirus_probe"); } catch (error) { void narrate(`The antivirus could not be read: ${String(error)}`, { area: "ANTIVIRUS", level: "WARN" }); return null; }
}

/** One Windows permission question; throws "cancelled" when the person says no to it. */
export async function addExclusions(folders: readonly string[]): Promise<AddOutcome> {
  if (demoKind()) { await new Promise(resolve => setTimeout(resolve, 900)); demoAdded = [...folders]; return { added: [...folders], already: [], failed: [], managed: false, error: "" }; }
  return invoke<AddOutcome>("antivirus_add_exclusions", { paths: folders });
}

export async function openWindowsSecurity(): Promise<void> {
  if (demoKind() || !hasTauriRuntime()) return;
  await invoke("antivirus_open_settings");
}

/** The settings screen asks for a new check after saving the folders (a new games folder may not be excluded). */
export const ANTIVIRUS_CHECK_EVENT = "gameaccess:antivirus-check";
export const requestAntivirusCheck = () => window.dispatchEvent(new CustomEvent(ANTIVIRUS_CHECK_EVENT, { detail: { manual: false } }));
/** The exclusion was added (or done by hand): Settings reads the state again. */
export const ANTIVIRUS_SOLVED_EVENT = "gameaccess:antivirus-solved";
/** From settings, by hand: shows the dialog even after "No, thanks". */
export const openAntivirusDialog = () => window.dispatchEvent(new CustomEvent(ANTIVIRUS_CHECK_EVENT, { detail: { manual: true } }));
