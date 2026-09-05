import { useEffect, useRef } from "react";

export function focusableDialogElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export function nextDialogFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  const safe = current >= 0 ? current : 0;
  return (safe + (backwards ? -1 : 1) + count) % count;
}

export function useDialogFocus(onEscape: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const initial = dialog.querySelector<HTMLElement>("[data-dialog-initial]") ?? focusableDialogElements(dialog)[0];
    initial?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableDialogElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const current = elements.indexOf(document.activeElement as HTMLElement);
      const next = nextDialogFocusIndex(current, elements.length, event.shiftKey);
      event.preventDefault();
      elements[next]?.focus({ preventScroll: true });
    };
    dialog.addEventListener("keydown", onKeyDown, true);
    return () => dialog.removeEventListener("keydown", onKeyDown, true);
  }, [onEscape]);
  return dialogRef;
}
