import { useState } from "react";
import AppDialog from "./AppDialog";
import { digitalProcessManager, type FreezeLevel } from "./catalog/DigitalProcessManager";
import { formatBytes } from "./GenericDownloadProgress";
import { useI18n } from "./i18n";
import { scanLibrary } from "./libraryScan";
import type { CatalogGame } from "./types";

export type FreezeMode = FreezeLevel | "thaw";

/** Confirm, then freeze (either level) or thaw one game; the dialog narrates the work and shows the result. */
export default function FreezeDialog({ game, mode, onClose }: { game: CatalogGame; mode: FreezeMode; onClose: () => void }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<{ phase: "working" | "done"; label: string; detail?: string } | null>(null);
  const [failure, setFailure] = useState("");
  const copy = {
    freeze: { title: t("freezeTitle", { name: game.name }), body: t("freezeBody"), confirm: t("freezeMenu") },
    deep: { title: t("deepFreezeTitle", { name: game.name }), body: t("deepFreezeBody"), confirm: t("deepFreezeMenu") },
    thaw: { title: t("thawTitle", { name: game.name }), body: t("thawBody"), confirm: t("thawMenu") },
  }[mode];
  const run = async () => {
    setProgress({ phase: "working", label: t(mode === "thaw" ? "thawWorking" : "freezeWorking"), detail: game.name });
    try {
      const result = mode === "thaw" ? await digitalProcessManager.thaw(game) : await digitalProcessManager.freeze(game, mode);
      const frozen = (result as { frozen?: { stored_bytes?: number; original_bytes?: number } }).frozen;
      await scanLibrary();
      setProgress({ phase: "done", label: copy.title,
        detail: frozen ? t("freezeDone", { stored: formatBytes(frozen.stored_bytes), original: formatBytes(frozen.original_bytes) }) : t("thawDone") });
    } catch (error) {
      setProgress(null);
      setFailure(t("freezeFailed", { error: error instanceof Error ? error.message : String(error) }));
    }
  };
  const working = progress?.phase === "working";
  if (failure) return <AppDialog title={copy.title} message={failure} tone="error" onClose={onClose} />;
  return <AppDialog title={copy.title} message={copy.body} onClose={working ? () => undefined : onClose} progress={progress ?? undefined}
    onConfirm={() => void run()} confirmLabel={copy.confirm} cancelLabel={t("back")} confirmDisabled={working} initialAction="confirm" />;
}
