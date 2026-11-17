/**
 * One smoke for the whole app (Seba, 2026-11-06; docs/GUI_DESIGN.md §4.34). Every large central dialog sits on the same
 * layer: the smoke stays still and only the content changes. When a dialog calls another, the new one pushes the old
 * one up, each fading as it moves; if the old one is still open, it comes back the same way when the new one closes.
 * The dialogs do not know: this watches the page for them, so each family (AppDialog, Radix, central dialog...) keeps
 * its own code. Stage: prototype.
 */
import "./smoke.css";

/** The content of each dialog: what stops being a box and what is swapped. Small cards over a game's art are not here. */
export const SMOKE_SURFACES = ".ga-smoke-body, .ga-dialog, .ga-overlay-dialog, .central-dialog-card, .ga-premium-dialog, .ga-filter-dialog, .ga-settings-backdrop > .ga-settings-panel, .download-complete-dialog";
/** A dialog that closes may be calling the next one: the smoke waits this long before leaving. */
const WAIT_FOR_NEXT_MS = 220;
const GHOST_MS = 1200;
/** Clear space between the two while they move. */
const PUSH_GAP = 32;

export interface SmokeTurn<T> { open: T[]; top: T | null; arrived: boolean; returned: boolean; left: T | null }

/** Who is on top after a change: the newest. `open` keeps the order they came in. */
export function smokeTurn<T>(before: T[], now: T[]): SmokeTurn<T> {
  const open = [...before.filter(item => now.includes(item)), ...now.filter(item => !before.includes(item))];
  const previous = before[before.length - 1] ?? null, top = open[open.length - 1] ?? null;
  const changed = top !== previous;
  return { open, top, arrived: changed && top !== null && !before.includes(top), returned: changed && top !== null && before.includes(top), left: previous !== null && !now.includes(previous) ? previous : null };
}

let stage: HTMLElement | null = null;
let open: HTMLElement[] = [];
let frame = 0, leaving = 0;
let ghost: HTMLElement | null = null;
const places = new WeakMap<HTMLElement, DOMRect>();

function currentSurfaces(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SMOKE_SURFACES)).filter(element => element.getClientRects().length > 0 && !stage?.contains(element) && !element.parentElement?.closest(SMOKE_SURFACES));
}

/** Its copy keeps going where it was: the dialog itself is already gone from the page. */
function leaveAGhost(element: HTMLElement) {
  const place = places.get(element);
  if (!stage || !place) return;
  ghost?.remove();
  const copy = element.cloneNode(true) as HTMLElement;
  copy.classList.remove("is-smoke-in", "is-smoke-back");
  copy.classList.add("ga-smoke-ghost");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  Object.assign(copy.style, { position: "fixed", margin: "0", left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px`, height: `${place.height}px` });
  stage.append(copy);
  ghost = copy;
  // Nobody came: it fades with the smoke. Otherwise it is pushed (sync) and goes when that ends.
  window.setTimeout(() => { if (!copy.classList.contains("is-smoke-up") && !copy.classList.contains("is-smoke-down")) copy.classList.add("is-smoke-fade"); }, WAIT_FOR_NEXT_MS);
  const gone = () => { copy.remove(); if (ghost === copy) ghost = null; };
  copy.addEventListener("animationend", event => { if (event.target === copy) gone(); });
  window.setTimeout(gone, GHOST_MS);
}

/** The smoke goes right under the dialog on top, whatever layer that family uses. */
function layerOf(element: HTMLElement): number {
  let layer = NaN;
  for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
    const value = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(value)) layer = value;
  }
  return Number.isFinite(layer) ? layer : 1100;
}

/** How far both move: half of each plus the gap, so at every moment there is clear space between them. */
function push(top: HTMLElement, other: HTMLElement | null, otherHeight: number) {
  const distance = Math.round((top.getBoundingClientRect().height + otherHeight) / 2 + PUSH_GAP);
  for (const element of [top, other]) element?.style.setProperty("--ga-smoke-push", `${distance}px`);
}

function sync() {
  frame = 0;
  if (!stage) return;
  const turn = smokeTurn(open, currentSurfaces());
  open = turn.open;
  if (turn.left) leaveAGhost(turn.left);
  // Measured before anything moves: the one that stays behind may be on its way out already.
  const below = turn.arrived ? open[open.length - 2] ?? null : null;
  const otherHeight = ghost?.getBoundingClientRect().height ?? (below ? places.get(below)?.height ?? 0 : 0);
  for (const element of open) {
    const away = element !== turn.top;
    if (!element.classList.contains("is-smoke-away")) places.set(element, element.getBoundingClientRect());
    element.classList.toggle("is-smoke-away", away);
    if (away) element.classList.remove("is-smoke-in", "is-smoke-back");
    else element.classList.remove("is-smoke-away");
    element.inert = away;
  }
  if (turn.top) {
    window.clearTimeout(leaving); leaving = 0;
    // Only a change of hands moves: the first dialog just appears with the smoke.
    if (turn.arrived && (ghost || open.length > 1)) { push(turn.top, ghost ?? below, otherHeight); turn.top.classList.add("is-smoke-in"); ghost?.classList.add("is-smoke-up"); }
    if (turn.returned) { push(turn.top, ghost, otherHeight); turn.top.classList.add("is-smoke-back"); ghost?.classList.add("is-smoke-down"); }
    stage.style.zIndex = String(layerOf(turn.top) - 1);
    stage.classList.add("is-on");
  } else if (!leaving) {
    leaving = window.setTimeout(() => { leaving = 0; stage?.classList.remove("is-on"); }, WAIT_FOR_NEXT_MS);
  }
}

const later = () => { if (!frame) frame = requestAnimationFrame(sync); };

/** Once, when the app starts. */
export function startSmokeStage(): void {
  if (stage || typeof MutationObserver === "undefined") return;
  stage = document.createElement("div");
  stage.className = "ga-smoke-stage";
  stage.setAttribute("aria-hidden", "true");
  document.body.append(stage);
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", later);
  // A dialog's own entrance ends: measure it where it really rests, so its ghost starts there.
  document.addEventListener("animationend", later, true);
  later();
}
