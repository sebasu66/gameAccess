import { useLayoutEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { SubmodeTabs } from "./pieces";

/** The real section and its existing tabs, above the original screen content. */
export default function SceneContentTitle({ mode, section, onLocked }: { mode: NavigationModeId; section: string; onLocked: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const current = NAVIGATION.find(item => item.id === mode)!;
  const chosen = current.sections.find(item => item.id === section) ?? current.sections[0];
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty("--ga-scene-content-top", `${Math.ceil(el.getBoundingClientRect().bottom)}px`);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--ga-scene-content-top"); };
  }, [mode, section]);
  return <div className="ga-scene-content-title" ref={ref}>
    <div className="ga-scene-content-heading"><span>{t(current.label)}</span><h1 className="ga-scene-title">{t(chosen.label)}</h1></div>
    <SubmodeTabs mode={mode} section={chosen.id} onLocked={onLocked} />
  </div>;
}
