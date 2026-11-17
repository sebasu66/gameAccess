/**
 * One accordion open at a time, in the whole app (Seba, 2026-11-02): opening a <details> closes the other open ones that
 * share its parent, so a help or a settings group never grows the dialog with two sections at once. No component needs
 * to know about this; a group that must allow several open adds data-accordion="multi" to the parent.
 */
export function closeSiblingAccordions(opened: HTMLDetailsElement) {
  const parent = opened.parentElement;
  if (!opened.open || !parent || parent.dataset.accordion === "multi") return;
  for (const sibling of parent.children) if (sibling !== opened && sibling instanceof HTMLDetailsElement && sibling.open) sibling.open = false;
}

export function startSingleAccordion(): () => void {
  // "toggle" does not bubble: listen in the capture phase to see every <details> in the page.
  const onToggle = (event: Event) => { if (event.target instanceof HTMLDetailsElement) closeSiblingAccordions(event.target); };
  document.addEventListener("toggle", onToggle, true);
  return () => document.removeEventListener("toggle", onToggle, true);
}
