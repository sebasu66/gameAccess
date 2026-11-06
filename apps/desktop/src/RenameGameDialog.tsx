import { useState } from "react";
import AppDialog from "./AppDialog";
import { digitalProcessManager } from "./catalog/DigitalProcessManager";
import { useI18n } from "./i18n";
import { scanLibrary } from "./libraryScan";
import { notify } from "./toasts";
import type { CatalogGame } from "./types";

/** The player's own name for a game, shown only in their library (kept in the game's install record). */
export default function RenameGameDialog({ game, current, onClose }: { game: CatalogGame; current: string; onClose: () => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState(current);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await digitalProcessManager.setLabel(game, label.trim());
      await scanLibrary();
      onClose();
    } catch (error) {
      notify(t("renameFailed", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" });
      setSaving(false);
    }
  };
  return <AppDialog title={t("renameTitle")} message={t("renameMessage", { name: game.name })} confirmLabel={t("renameSave")}
    cancelLabel={t("back")} initialAction="confirm" confirmDisabled={saving} onConfirm={() => void save()} onClose={onClose}>
    <label className="ga-field">
      <span>{t("renameField")}</span>
      <input type="text" value={label} maxLength={120} autoFocus disabled={saving} placeholder={game.name}
        onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
    </label>
  </AppDialog>;
}
