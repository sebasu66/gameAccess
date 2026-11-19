import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";

const images: Record<NavigationModeId, string> = {
  catalog: "catalogo", library: "libreria", gameAccess: "gameaccess", settings: "config",
};

/** Four fixed mode buttons, with the prototype's on/off art and the existing live counts. */
export default function SceneModeDock({ mode, badges, onOpen }: {
  mode: NavigationModeId; badges: Partial<Record<NavigationModeId, number>>; onOpen: (mode: NavigationModeId) => void;
}) {
  const { t } = useI18n();
  return <nav className="ga-scene-dock" aria-label={t("navModesAria")}>
    <svg className="ga-scene-dock-base" viewBox="0 0 400 54" preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0 54 V33 Q0 17 14 24 ${NAVIGATION.map((item, index) => {
        const center = 50 + index * 100;
        const depth = item.id === mode ? 46 : 37;
        return `C ${center - 24} 30 ${center - 21} ${depth} ${center} ${depth} S ${center + 29} 22 ${center + 50} 22`;
      }).join(" ")} V54 Z`} />
    </svg>
    {NAVIGATION.map(item => {
      const active = item.id === mode;
      const count = badges[item.id] ?? 0;
      const name = t(item.label);
      return <button key={item.id} type="button" className="ga-scene-mode" data-target={item.id}
        aria-current={active ? "page" : undefined} aria-label={count ? `${name} · ${count}` : name}
        title={name} onClick={() => { if (!active) onOpen(item.id); }}>
        <span className="ga-scene-mode-motion"><img src={`/styles/escena/btn-${images[item.id]}-${active ? "on" : "off"}.webp`} alt="" /></span>
        {count > 0 && <em aria-hidden="true">{count}</em>}
      </button>;
    })}
  </nav>;
}
