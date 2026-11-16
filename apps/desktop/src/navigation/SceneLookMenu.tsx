/**
 * Right-click on Escena (Seba 2026-11-16): on the menu, the colours (a whole palette, or one mode's gradient, chosen or
 * the player's own); on the figure, its image, scale and position. A small panel at the pointer, like the prototype's
 * menu (examples/GA Arbol de Navegacion); it closes with Escape, a click outside or its close button. Everything else
 * of the look is in Settings › Appearance.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GaButton, GaClose } from "../components/ga/Buttons";
import { useI18n } from "../i18n";
import { selectNavigationSection } from "./navigationSelection";
import { FigureControl, GradientControl, ModeChoice, PaletteControl } from "./SceneLookControls";
import type { SceneMode } from "./sceneLook";
import { resetScene } from "./sceneLookActions";

export type SceneMenuRequest = { kind: "colors" | "figure"; x: number; y: number; mode: SceneMode };

export default function SceneLookMenu({ request, onClose }: { request: SceneMenuRequest; onClose: () => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState(request.mode);
  const [place, setPlace] = useState({ left: request.x, top: request.y });
  useEffect(() => setMode(request.mode), [request]);
  // Kept inside the window: moved up or left when it would run past the edge.
  useLayoutEffect(() => {
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    const gap = 8;
    setPlace({ left: Math.max(gap, Math.min(request.x, window.innerWidth - box.width - gap)), top: Math.max(gap, Math.min(request.y, window.innerHeight - box.height - gap)) });
  }, [request, mode]);
  useEffect(() => {
    panel.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside, true);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", outside, true); };
  }, [onClose]);
  const title = request.kind === "colors" ? t("lookMenuColors") : t("lookMenuFigure");
  return createPortal(<div ref={panel} className="ga-scene-look-menu" role="dialog" aria-label={title} tabIndex={-1} style={{ left: place.left, top: place.top }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <header className="ga-scene-look-menu-head"><span className="ga-label">{title}</span><GaClose label={t("close")} onClick={onClose} /></header>
    {request.kind === "colors" && <PaletteControl />}
    <ModeChoice value={mode} onChange={setMode} />
    {request.kind === "colors" ? <GradientControl mode={mode} /> : <FigureControl mode={mode} />}
    {request.kind === "colors" && <p className="ga-hint">{t("lookInkAuto")}</p>}
    <div className="ga-scene-look-actions">
      <GaButton onClick={() => { selectNavigationSection("settings", "appearance"); onClose(); }}>{t("lookMenuMore")}</GaButton>
      <GaButton onClick={resetScene}>{t("lookResetEscena")}</GaButton>
    </div>
  </div>, document.body);
}
