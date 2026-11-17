/**
 * A dialog on the smoke (smokeStage.ts draws it and swaps the content): Esc or a click on the smoke closes it; the focus
 * goes to the element marked data-autofocus and comes back where it was. Stage: prototype.
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./smoke.css";

export function GaSmoke({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    body.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    // First in line, so the screen behind does not take Esc too.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); } };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); before?.focus?.({ preventScroll: true }); };
  }, []);
  const outside = (event: MouseEvent) => { if (!body.current?.contains(event.target as Node)) onClose(); };
  return createPortal(<div className={className ? `ga-smoke ${className}` : "ga-smoke"} role="dialog" aria-modal="true" aria-label={label} onClick={outside}><div ref={body} className="ga-smoke-body">{children}</div></div>, document.body);
}
