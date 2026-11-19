/**
 * What BASE does not include (Seba, 2026-11-19; docs/GUI_DESIGN.md §4.48): **only a padlock**, as the main navigation
 * does it (`navigation/pieces.tsx` `PlanLock`). The lock itself says nothing on screen: the cursor over it opens a
 * tooltip saying that this is part of PLUS, and a click on whatever holds it opens Game Access › Subscription.
 *
 * It is a mark, not a button, so it can live inside another button (a section's head, a row, a tab) without nesting
 * controls; that control decides what a click does and calls `openPlusScreen`.
 */
import { Lock } from "lucide-react";
import { useI18n } from "../../i18n";
import { OPEN_PREMIUM_EVENT } from "../../PremiumEntry";
import "./plus-lock.css";

/** Takes the player to the subscription screen, the same place the frame's PLUS button opens. */
export function openPlusScreen(): void {
  window.dispatchEvent(new Event(OPEN_PREMIUM_EVENT));
}

export default function PlusLock({ reason }: {
  /** One short sentence for the tooltip; by default, "Available on PLUS". */ reason?: string;
}) {
  const { t } = useI18n();
  const tip = reason ?? t("navPlusOnly");
  return <span className="ga-plus-lock" data-tip={tip} role="img" aria-label={tip}><Lock aria-hidden="true" /></span>;
}
