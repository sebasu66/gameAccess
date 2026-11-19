/**
 * Sections that open one at a time (Seba, 2026-11-19; docs/GUI_DESIGN.md §4.50).
 *
 * **There is always exactly one open**, the first one when it opens: a click on a closed section opens it and closes
 * the one that was open; a click on the open one leaves it open, so the panel never ends up empty and never grows into
 * a wall of fields. It is for a column of properties read one group at a time (Manager's detail, §4.49), not for what
 * has to be compared side by side.
 *
 * Each head is a `button` with `aria-expanded` and `aria-controls`; its body is a region named by the head.
 */
import { useId, useState, type ReactNode } from "react";
import PlusLock, { openPlusScreen } from "./PlusLock";
import "./accordion.css";

export interface GaAccordionItem { id: string; label: string; content: ReactNode;
  /** The section's icon, as the game sheet's panels have one (§4.43): same size, same place. */ icon?: ReactNode;
  /** Part of PLUS and not included: the head shows a padlock instead of the chevron and does not open; a click on it
   *  takes the player to the subscription screen (§4.48). */ locked?: boolean;
  /** What the padlock's tooltip says, when it is not the usual "Available on PLUS". */ lockReason?: string }

export default function GaAccordion({ items, initial, label }: {
  items: GaAccordionItem[];
  /** The one that starts open; by default the first. */ initial?: string;
  /** What the set of sections is, for screen readers. */ label?: string;
}) {
  const key = useId();
  const [open, setOpen] = useState<string | undefined>(initial);
  // The groups change while the game's options load (a linked game has others), so the open one may no longer be there.
  const reachable = items.filter(item => !item.locked);
  const current = reachable.some(item => item.id === open) ? open : reachable[0]?.id;
  return <div className="ga-accordion" role="group" aria-label={label}>
    {items.map(item => {
      const shown = !item.locked && item.id === current;
      return <section key={item.id} className={`ga-accordion-item${shown ? " is-open" : ""}`} data-locked={item.locked || undefined}>
        <h4 className="ga-accordion-title">
          <button type="button" className="ga-accordion-head" id={`${key}-${item.id}-head`} aria-expanded={item.locked ? undefined : shown}
            aria-controls={item.locked ? undefined : `${key}-${item.id}-body`} onClick={() => item.locked ? openPlusScreen() : setOpen(item.id)}>
            {item.icon ? <span className="ga-accordion-icon" aria-hidden="true">{item.icon}</span> : null}
            <span className="ga-accordion-label">{item.label}</span>
            {item.locked ? <PlusLock reason={item.lockReason} /> : <span className="ga-accordion-mark" aria-hidden="true" />}
          </button>
        </h4>
        {shown ? <div className="ga-accordion-body" id={`${key}-${item.id}-body`} role="region" aria-labelledby={`${key}-${item.id}-head`}>{item.content}</div> : null}
      </section>;
    })}
  </div>;
}
