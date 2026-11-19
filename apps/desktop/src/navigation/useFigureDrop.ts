/**
 * Dropping an image on the character (Seba, 2026-11-19): the player drags a file from their computer onto the figure
 * —on the scene itself, or onto its thumbnail in Appearance— and it becomes that mode's figure, **placed by itself**
 * (sceneLookActions.setSceneFigureImage with `fit`): the drawing's top right corner at the art's corner and always
 * the same height, so it lands where the eye expects it however much transparent room the file carries around it.
 * From there the sliders move and scale it by hand as before.
 *
 * The same checks as the file picker (an image, under 12 MB, the original's proportion, a transparent background);
 * what went wrong is said in a toast, in the player's language.
 */
import { useCallback, useState, type DragEvent } from "react";
import { useI18n } from "../i18n";
import { notify } from "../toasts";
import type { FigureCheck, SceneMode } from "./sceneLook";
import { setSceneFigureImage } from "./sceneLookActions";

/** True while a file is being dragged over, and the three handlers to spread on the element that takes it. */
export function useFigureDrop(mode: SceneMode, done?: (check: FigureCheck) => void) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const carriesFile = (event: DragEvent) => Array.from(event.dataTransfer?.items ?? []).some(item => item.kind === "file");
  const onDragOver = useCallback((event: DragEvent) => {
    if (!carriesFile(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  }, []);
  const onDragLeave = useCallback((event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOver(false);
  }, []);
  const onDrop = useCallback((event: DragEvent) => {
    if (!carriesFile(event)) return;
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    void setSceneFigureImage(mode, file, true).then(check => {
      notify(check.ok ? t("lookFigureDropped") : t(check.reason), { tone: check.ok ? "success" : "error" });
      done?.(check);
    });
  }, [mode, t, done]);
  return { over, handlers: { onDragOver, onDragLeave, onDrop } };
}
