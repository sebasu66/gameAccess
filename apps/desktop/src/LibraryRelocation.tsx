import { useState } from "react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { Checkbox } from "./components/ui/checkbox";
import { formatDownloadBytes } from "./downloadSize";
import { digitalProcessManager, type RelocationPlan } from "./catalog/DigitalProcessManager";
import { scanLibrary } from "./libraryScan";

/**
 * One games folder: after the player changes it (or when old folders are still listed), the games outside it move
 * to it (checked by default) or stay linked where they are. Moved one by one, with progress; then the old folders
 * leave the list (game_library_manager/relocate.py).
 */
export default function LibraryRelocation({ plan, onDone }: { plan: RelocationPlan; onDone: (message: string) => void }) {
  const { locale, t } = useI18n();
  const [moveAll, setMoveAll] = useState(true);
  const [progress, setProgress] = useState("");
  const size = formatDownloadBytes(plan.games.reduce((sum, game) => sum + game.size_bytes, 0), locale);
  const tooLong = plan.games.filter(game => !game.fits && !game.must_move).length;
  const blocked = moveAll && !plan.room;
  const run = async () => {
    let moved = 0, linked = 0, failed = 0;
    for (const [index, game] of plan.games.entries()) {
      setProgress(t("relocWorking", { index: index + 1, total: plan.games.length, name: game.name }));
      const mode = moveAll && game.fits && !game.taken ? "move" : "link";
      const outcome = (await digitalProcessManager.relocate(game.app_id, plan.target, mode).catch(() => undefined))?.relocated;
      if (!outcome?.ok) failed += 1;
      else if (outcome.mode === "link") linked += 1;
      else moved += 1;
    }
    await digitalProcessManager.relocateFinish().catch(() => undefined);
    await scanLibrary();
    onDone([t("relocDone", { moved, linked }), failed ? t("relocFailedSome", { count: failed }) : ""].filter(Boolean).join(" "));
  };
  return (
    <section className="ga-relocation grid gap-3 rounded-lg border border-border bg-card/50 p-4" aria-live="polite">
      <h4 className="m-0 text-sm font-bold">{t("relocTitle", { count: plan.games.length, size })}</h4>
      <p className="m-0 text-sm text-muted-foreground">{t("relocBody")}</p>
      <div className="flex items-start gap-3">
        <Checkbox id="ga-relocate-all" className="mt-0.5" disabled={Boolean(progress)} checked={moveAll} onCheckedChange={value => setMoveAll(value === true)} />
        <div className="grid gap-1">
          <label htmlFor="ga-relocate-all" className="text-sm font-semibold">{t("relocMoveAll")}</label>
          <p className="m-0 text-sm text-muted-foreground">{moveAll ? t("relocMoveHint") : t("relocLinkHint")}</p>
        </div>
      </div>
      {blocked ? <p role="alert" className="m-0 text-sm text-amber-300">{t("relocNoRoomPlan", { needed: formatDownloadBytes(plan.copy_bytes, locale), free: formatDownloadBytes(plan.free_bytes, locale) })}</p> : null}
      {moveAll && tooLong ? <p className="m-0 text-sm text-amber-300">{t("relocTooLongPlan", { count: tooLong })}</p> : null}
      {progress ? <p role="status" className="m-0 text-sm">{progress}</p> : (
        <div className="flex gap-3">
          <GaButton variant="primary" disabled={blocked} onClick={() => void run()}>{t("relocGo")}</GaButton>
          <GaButton onClick={() => onDone("")}>{t("relocLater")}</GaButton>
        </div>
      )}
    </section>
  );
}
