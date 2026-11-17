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
    {NAVIGATION.map(item => {
      const active = item.id === mode;
      const count = badges[item.id] ?? 0;
      const name = t(item.label);
      return <button key={item.id} type="button" className="ga-scene-mode" data-target={item.id}
        aria-current={active ? "page" : undefined} aria-label={count ? `${name} · ${count}` : name}
        title={name} onClick={() => { if (!active) onOpen(item.id); }}>
        <img src={`/styles/escena/btn-${images[item.id]}-${active ? "on" : "off"}.webp`} alt="" />
        {count > 0 && <em aria-hidden="true">{count}</em>}
      </button>;
    })}
  </nav>;
}
