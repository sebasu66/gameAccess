import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { NAVIGATION, type NavigationModeId } from "./navigationTree";
import { sectionListOrder } from "./navigationSelection";
import { usePlus } from "../kidMode";
import { planLocked } from "./planLocks";
import { SECTION_ART } from "./sectionArt";
import { PanelArt, SectionButton, SubmodeTabs, TitlePlate, useFitText } from "./pieces";
import { useSectionSwap } from "./sectionSwap";

/** The sections panel (vault/Rediseño de navegación.md §4.2): the chosen section as a title that reaches over the content, the others as stepped arrows. */
export default function SectionPanel({ mode, selected, reachable, onOpen, onLocked }: { mode: NavigationModeId; selected: string; reachable: (section: string) => boolean; onOpen: (section: string) => void; onLocked: () => void }) {
  const plus = usePlus();
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const current = NAVIGATION.find(item => item.id === mode)!;
  const ids = current.sections.map(section => section.id as string);
  const chosen = current.sections.find(section => section.id === selected) ?? current.sections[0];
  const [orders, setOrders] = useState<Partial<Record<NavigationModeId, string[]>>>({});
  const order = sectionListOrder(ids, chosen.id, orders[mode]);
  if (orders[mode]?.join() !== order.join()) setOrders(previous => ({ ...previous, [mode]: order }));

  useFitText(ref, [mode, chosen.id, t]);
  // Picking another section plays the prototype's swap: the title and the picked arrow trade places (sectionSwap.ts).
  const pick = useSectionSwap(ref, chosen.id, onOpen);

  return <nav className="ga-nav-sections" ref={ref} aria-label={t("navSectionsAria")}>
    <PanelArt />
    <TitlePlate name={t(chosen.label)} desc={t(chosen.desc)} />
    <div className="ga-nav-panel-flow">
      <SubmodeTabs mode={mode} section={chosen.id} onLocked={onLocked} />
      <ul className="ga-nav-section-list">{order.map(id => {
        const section = current.sections.find(item => item.id === id)!;
        const locked = planLocked(plus, id);
        return <SectionButton key={id} id={id} art={SECTION_ART[id]} label={section.label} desc={section.desc} disabled={!reachable(id)} locked={locked} onClick={button => locked ? onLocked() : pick(id, button)} />;
      })}</ul>
    </div>
  </nav>;
}
