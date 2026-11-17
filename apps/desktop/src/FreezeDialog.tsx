import { useEffect, useRef } from "react";
import type { FreezeLevel } from "./catalog/DigitalProcessManager";
import { freezeJob, freezeTitle, openFreezeConsole, startFreezeJob } from "./freezeJobs";
import { translate } from "./i18n";
import { confirmNotice, hideNotice } from "./notice/notice";
import { noticeGame } from "./notice/noticeGame";
import type { CatalogGame } from "./types";

export type FreezeMode = FreezeLevel | "thaw";

/** Asks, in the app's notice (bottom right, like every confirmation), whether to freeze (either level) or thaw one
 *  game; on yes the work starts as a job of the app, shown in the game's row of the Library Manager or in the freeze
 *  console, and its result comes back as a notice too. Opened while that game is already being frozen, it only
 *  brings the console up on that job. Draws nothing itself; `onClose` runs once it is answered. */
export default function FreezeDialog({ game, mode, onClose }: { game: CatalogGame; mode: FreezeMode; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const appId = game.app_id ?? game.id;
    if (freezeJob(appId)) { openFreezeConsole(appId); close.current(); return; }
    const copy = { freeze: ["freezeBody", "freezeMenu"], deep: ["deepFreezeBody", "deepFreezeMenu"], thaw: ["thawBody", "thawMenu"] } as const;
    void confirmNotice({
      game: noticeGame(game), title: freezeTitle(mode, game.name), text: translate(copy[mode][0]),
      confirmLabel: translate(copy[mode][1]), cancelLabel: translate("noticeCancel"), kind: "frost",
    }).then(ok => {
      // The answer counts even when what opened the question is gone (the game menu closed meanwhile).
      if (ok) { hideNotice(); startFreezeJob(game, mode); }
      close.current();
    });
  }, [game.app_id, game.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
