/**
 * A card drawn from art in three slices (Seba, 2026-11-17; docs/GUI_DESIGN.md §4.41): a header and a footer that keep
 * their proportion and a body that stretches to its content, so the card grows without bending its ends. The header
 * art may carry its own words (the plan's name): `title` says them to screen readers. Sizes in templates/base.css.
 */
import type { ReactNode } from "react";
import "./slice-card.css";

export interface SliceArt { head: string; body: string; foot: string }

export function GaSliceCard({ art, title, titleId, children, footer, className }: {
  art: SliceArt; title: string; titleId?: string; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  return (
    <section className={["ga-slice-card", className].filter(Boolean).join(" ")} aria-labelledby={titleId}>
      <img className="ga-slice-head" src={art.head} alt="" draggable={false} />
      <h3 id={titleId} className="ga-visually-hidden">{title}</h3>
      <div className="ga-slice-body" style={{ backgroundImage: `url("${art.body}")` }}>{children}</div>
      <div className="ga-slice-foot">
        <img src={art.foot} alt="" draggable={false} />
        {footer ? <div className="ga-slice-foot-content">{footer}</div> : null}
      </div>
    </section>
  );
}
