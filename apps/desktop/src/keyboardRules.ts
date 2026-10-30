/**
 * Keyboard rules for the whole app (Seba, 2026-10-30; docs/GUI_DESIGN.md §4.13):
 * - When a screen, a step or a dialog shows a text field, that field takes the focus.
 * - Enter in a text field goes to the next logical place: the next field of the same screen or dialog, or else its
 *   primary button (Next, Accept...), which takes the focus (Enter again presses it).
 * - The frame's buttons are out of the Tab cycle; the digits 1–9 press them, in order from left to right, when the
 *   focus is not in a text field and no dialog is open.
 * Installed once (App.tsx). Components keep the last word: a key they handle themselves (defaultPrevented) is left alone.
 */

/** Where a field belongs: the open dialog (or gate) or the screen. The catalog's search is in neither and is left alone. */
const REGION = '[role="dialog"], .ga-screen';
const FRAME_BUTTONS = ".ga-dock button, .ga-footer-left button";
const TEXT_TYPES = new Set(["", "text", "search", "password", "email", "number", "tel", "url"]);

const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  return TEXT_TYPES.has(el.getAttribute("type")?.toLowerCase() ?? "") && !el.readOnly && !el.disabled;
}

const editing = (el: Element | null) => isTextField(el) || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

/** The text fields of a region, in order, that can take the focus now. */
export function regionFields(region: Element): (HTMLInputElement | HTMLTextAreaElement)[] {
  return Array.from(region.querySelectorAll("input, textarea")).filter(isTextField).filter(field => !field.closest("[data-no-autofocus]") && visible(field));
}

/** The region on top: the last open modal dialog, or else the screen. */
function topRegion(): Element | null {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(visible);
  return dialogs[dialogs.length - 1] ?? document.querySelector(".ga-screen");
}

const offered = new WeakSet<Element>();

/** Gives the focus to the first text field that just appeared in the region on top (each field only once). */
export function focusNewField(): void {
  const region = topRegion();
  if (!region) return;
  const fields = regionFields(region);
  const fresh = fields.filter(field => !offered.has(field));
  for (const field of fresh) offered.add(field);
  if (!fresh.length || (isTextField(document.activeElement) && region.contains(document.activeElement))) return;
  fresh[0].focus({ preventScroll: true });
}

/** Enter in a field: the next field of its region, or its primary button. True when it moved the focus. */
export function advanceFromField(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  const region = field.closest(REGION);
  if (!region) return false;
  const fields = regionFields(region);
  const next = fields[fields.indexOf(field) + 1];
  if (next) { next.focus({ preventScroll: true }); next.select?.(); return true; }
  const primary = Array.from(region.querySelectorAll<HTMLButtonElement>("button.ga-btn-primary, button[data-primary]"))
    .find(button => !button.disabled && button.getAttribute("aria-disabled") !== "true" && visible(button));
  if (!primary) return false;
  primary.focus({ preventScroll: true });
  return true;
}

/** The frame's buttons, left to right, as the digits 1–9 press them. */
export function frameButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".ga-dock button")).filter(button => visible(button) && !button.disabled)
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
}

/** Takes the frame's buttons out of the Tab cycle and tells each its digit. */
function markFrameButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(FRAME_BUTTONS)) if (button.tabIndex !== -1) button.tabIndex = -1;
  frameButtons().forEach((button, index) => {
    const key = index < 9 ? String(index + 1) : "";
    if ((button.getAttribute("aria-keyshortcuts") ?? "") !== key) { if (key) button.setAttribute("aria-keyshortcuts", key); else button.removeAttribute("aria-keyshortcuts"); }
  });
}

export function installKeyboardRules(): () => void {
  let frame = 0;
  // After each change of the page, once per frame: new fields take the focus and new frame buttons leave the Tab cycle.
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; markFrameButtons(); focusNewField(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  markFrameButtons();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const target = document.activeElement;
    if (event.key === "Enter" && !event.shiftKey && isTextField(target) && !(target instanceof HTMLTextAreaElement)) {
      if (advanceFromField(target)) event.preventDefault();
      return;
    }
    if (!/^[1-9]$/.test(event.key) || editing(target) || topRegion()?.matches('[role="dialog"]')) return;
    const button = frameButtons()[Number(event.key) - 1];
    if (!button) return;
    event.preventDefault();
    button.click();
  };
  document.addEventListener("keydown", onKeyDown);
  return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener("keydown", onKeyDown); };
}
