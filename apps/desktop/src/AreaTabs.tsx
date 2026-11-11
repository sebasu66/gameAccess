import { createPortal } from "react-dom";
import { Gamepad2, LayoutGrid } from "lucide-react";
import { useAppScreen } from "./appScreen";
import { GaIconButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { AREA_SECTIONS, openArea, openSection, useGameSection, type GameArea, type GameSection } from "./gameArea";
import { useActiveDownloadCount } from "./downloads/useActiveDownloadCount";
import "./area-tabs.css";

const SECTION_KEYS = { catalog: "sectionBrowse", downloads: "downloadsTitle", play: "sectionPlay", manager: "libraryManagerButton" } as const satisfies Record<GameSection, string>;

/**
 * The sections of the area on screen (gameArea.ts): Catalog › Explore, Library › Play | Downloads | Manager. Drawn with
 * the tabs template (tabs.css, `.ga-tabs-list` and `.ga-tab`) as links between sections, not as a tab panel.
 */
export default function AreaTabs({ area }: { area?: GameArea }) {
  const { t } = useI18n();
  const current = useGameSection();
  const shown = area ?? current?.area;
  const downloads = useActiveDownloadCount();
  const screen = useAppScreen();
  // Without an area of its own it is the games' top bar copy, shown only over the grid (a screen draws its own).
  if (!shown || (!area && screen !== "games")) return null;
  return <nav className="ga-tabs ga-area-tabs" aria-label={t("areaSectionsAria", { area: t(shown === "catalog" ? "areaCatalog" : "areaLibrary") })}>
    <div className="ga-tabs-list">
      {AREA_SECTIONS[shown].map((section, index) => {
        const on = current?.section === section;
        return <button key={section} type="button" className="ga-tab" data-tab-index={index} aria-current={on ? "page" : undefined} aria-selected={on}
          onClick={() => { if (!on) openSection(section); }}>
          {t(SECTION_KEYS[section])}{section === "downloads" && downloads ? ` · ${downloads}` : ""}
        </button>;
      })}
    </div>
  </nav>;
}

/** The frame's Catalog and Library buttons (they took the place of Games and Library Manager): each opens its area. */
export function AreaButtons({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
  const { t } = useI18n();
  const current = useGameSection();
  const downloads = useActiveDownloadCount();
  const buttons = <>
    <GaIconButton className="ga-catalog-fab" icon={<LayoutGrid size={20} aria-hidden="true" />} label={t("areaCatalog")}
      pressed={current?.area === "catalog"} onClick={() => openArea("catalog")} />
    <GaIconButton className="ga-library-fab" icon={<Gamepad2 size={20} aria-hidden="true" />} label={t("areaLibrary")} badge={downloads || undefined}
      pressed={current?.area === "library"} onClick={() => openArea("library")} />
  </>;
  return dockTarget ? createPortal(buttons, dockTarget) : buttons;
}
