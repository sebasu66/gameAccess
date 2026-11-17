/**
 * Choosing another section in the sections panel, in one sequence (vault/Rediseño de navegación.md §4.2; the
 * prototype's swap() in examples/GA Arbol de Navegacion):
 *   1 · the chosen section's submodes close upwards, onto their title
 *   2 · the title (chevrons, then text, then its arrow) hides to the left, behind column 1
 *   3 · the picked section rises straight from its row to the first one, grows to the title's size and becomes the title
 *   4 · its name grows into the title's, the old section slides back into the list where the picked one was, and the
 *       new section's submodes unfold (Seba, 2026-11-12: the picked item travels up, so the change reads at a glance)
 * It runs through the transition queue; with "reduce motion" the section simply changes.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { gsap, motionOk } from "../motion/gsap";
import { queueTransition } from "../motion/transitions";
import { currentCssValue } from "./shellLook";

const HIDE_PAST_EDGE = 40;   // px beyond the panel's left edge, so the arrow's tip is gone too
const STILL_SAME_MS = 160;   // the pick opened nothing in this panel (another screen): come back anyway

const seconds = () => parseFloat(currentCssValue("--ga-nav-transition-time")) || .6;
/** A length variable in pixels: the variable may be a calc(), so a probe element resolves it. */
function px(name: string, el: HTMLElement): number {
  const probe = document.createElement("i");
  probe.style.cssText = `position:absolute;visibility:hidden;inline-size:var(${name})`;
  el.appendChild(probe);
  const value = probe.getBoundingClientRect().width / ((el.getBoundingClientRect().width / (el.offsetWidth || 1)) || 1);
  probe.remove();
  return value || 0;
}

/** The title's arrow in pixels: GSAP cannot interpolate the CSS shape (calc()), so both ends use the same numbers. */
function arrowShapes(plate: HTMLElement) {
  const w = plate.offsetWidth, a = px("--ga-nav-hero-tip", plate);
  return {
    open: `polygon(0px 0%, ${w - a}px 0%, ${w}px 50%, ${w - a}px 100%, 0px 100%)`,
    closed: `polygon(0px 0%, ${-a}px 0%, 0px 50%, ${-a}px 100%, 0px 100%)`,
  };
}

interface Parts { plate: HTMLElement; text: HTMLElement[]; chevrons: HTMLElement[]; tabs: HTMLElement | null; away: (el: HTMLElement) => number }

function parts(root: HTMLElement): Parts | null {
  const plate = root.querySelector<HTMLElement>(".ga-nav-hero-plate");
  const flow = root.querySelector<HTMLElement>(".ga-nav-panel-flow");
  if (!plate || !flow) return null;
  const edge = flow.getBoundingClientRect().left;
  const scale = flow.getBoundingClientRect().width / (flow.offsetWidth || 1) || 1;
  return {
    plate,
    text: [...root.querySelectorAll<HTMLElement>(".ga-nav-hero-name, .ga-nav-hero-desc")],
    chevrons: [...root.querySelectorAll<HTMLElement>(".ga-nav-hero .ga-nav-chevrons-big > i")],
    tabs: root.querySelector<HTMLElement>(".ga-nav-tabs"),
    away: el => -((el.getBoundingClientRect().right - edge) / scale + HIDE_PAST_EDGE),
  };
}

/**
 * `pick(id, button)` plays the swap and opens the section halfway (`open`); the panel calls it from a section's click.
 * `chosen` is the section on show: when it changes to the picked one, the second half plays on the new layout.
 */
export function useSectionSwap(root: RefObject<HTMLElement | null>, chosen: string, open: (id: string) => void) {
  const flight = useRef<{ from: string; to: string; enter: () => void } | null>(null);
  const busy = useRef(false);

  useLayoutEffect(() => {
    const now = flight.current;
    if (now && now.to === chosen) now.enter();
  }, [chosen]);

  const pick = (id: string, button: HTMLElement) => {
    if (busy.current) return;                            // one swap at a time, as in the prototype
    const el = root.current;
    if (!el || !motionOk() || id === chosen) { open(id); return; }
    busy.current = true;
    const from = chosen;
    void queueTransition(() => new Promise<void>(resolve => {
      const p = parts(el);
      if (!p) { busy.current = false; open(id); resolve(); return; }
      const d = seconds();
      const shapes = arrowShapes(p.plate);
      const tabItems = p.tabs ? [...p.tabs.children] as HTMLElement[] : [];
      // How much bigger the title's name is than the button's: the new title's name grows from the button's size.
      const buttonName = button.querySelector<HTMLElement>(".ga-nav-section-name");
      const heroName = el.querySelector<HTMLElement>(".ga-nav-hero-name");
      const nameFrom = buttonName && heroName ? (parseFloat(getComputedStyle(buttonName).fontSize) / (parseFloat(getComputedStyle(heroName).fontSize) || 1)) || 1 : 1;
      gsap.set(p.plate, { clipPath: shapes.open });

      // 1 · the chosen section leaves to the left: its submodes close upwards, then chevrons, text and arrow.
      const leave = gsap.timeline();
      if (tabItems.length && p.tabs) leave.to(tabItems.slice().reverse(), { y: -10, opacity: 0, duration: d * .22, stagger: d * .04, ease: "power2.in" })
        .to(p.tabs, { height: 0, marginBottom: 0, duration: d * .28, ease: "power2.inOut" }, "-=0.08");
      leave.addLabel("hide")
        .to(p.chevrons, { opacity: 0, x: -16, duration: d * .32, stagger: { each: .06, from: "end" }, ease: "power3.in" }, "hide")
        .to(p.text.slice().reverse(), { opacity: 0, x: -16, duration: d * .4, stagger: .06, ease: "power3.in" }, "hide+=0.1")
        .to(p.plate, { clipPath: shapes.closed, duration: d * .6, ease: "power3.in" }, "hide+=0.3");

      // 2 · the picked section rises from where it is to the first row, 3 · grows to the title's size and becomes it.
      const rise = () => {
        const start = button.getBoundingClientRect(), to = p.plate.getBoundingClientRect();
        const scale = start.width / (button.offsetWidth || 1) || 1;
        const climb = gsap.timeline();
        climb.to(button, { x: (to.left - start.left) / scale, y: (to.top - start.top) / scale, duration: d * .55, ease: "power3.inOut" })
          .to(button, { scaleX: to.width / start.width, scaleY: to.height / start.height, transformOrigin: "0% 0%", duration: d * .3, ease: "power2.out" })
          // The title's arrow, still empty, lights up over the grown button: the picked section is now the title.
          .set(p.plate, { opacity: 0, clipPath: shapes.open })
          .to(p.plate, { opacity: 1, duration: d * .25, ease: "power1.out" }, ">-0.05")
          .call(handOver);
      };
      leave.call(rise);

      const enter = () => {
        flight.current = null;
        window.clearTimeout(fallback);
        const n = parts(el);
        if (!n) { busy.current = false; resolve(); return; }
        const back = el.querySelector<HTMLElement>(`.ga-nav-section[data-section="${CSS.escape(from)}"]`);
        const items = n.tabs ? [...n.tabs.children] as HTMLElement[] : [];
        gsap.set(button, { clearProps: "transform,transformOrigin" });   // still drawn when the pick opened another screen
        if (n.tabs) gsap.set(n.tabs, { clearProps: "height,marginBottom" });
        const tabsHeight = n.tabs?.offsetHeight ?? 0;
        const tabsGap = n.tabs ? getComputedStyle(n.tabs).marginBottom : "0px";
        gsap.set(n.plate, { clipPath: arrowShapes(n.plate).open, opacity: 1 });
        const [name, ...rest] = n.text;
        if (name) gsap.set(name, { opacity: 0, x: 0, scale: nameFrom, transformOrigin: "0% 50%" });
        gsap.set([...rest, ...n.chevrons], { opacity: 0, x: -16 });
        if (back) gsap.set(back, { x: n.away(back) });
        if (n.tabs && items.length) { gsap.set(items, { opacity: 0, y: -10 }); gsap.set(n.tabs, { height: 0, marginBottom: 0 }); }
        // 4 · the name grows into the title, the old section slides back into the list, the submodes unfold.
        const inn = gsap.timeline();
        inn.addLabel("show");
        if (name) inn.to(name, { opacity: 1, scale: 1, duration: d * .45, ease: "power3.out" }, "show");
        inn.to(rest, { opacity: 1, x: 0, duration: d * .35, stagger: .06, ease: "power3.out" }, "show+=0.12")
          .to(n.chevrons, { opacity: 1, x: 0, duration: d * .32, stagger: .06, ease: "power3.out" }, "show+=0.2");
        if (back) inn.to(back, { x: 0, duration: d * .5, ease: "power3.out" }, "show+=0.1");
        if (n.tabs && items.length) inn.to(n.tabs, { height: tabsHeight, marginBottom: tabsGap, duration: d * .32, ease: "power2.out" }, "show+=0.25")
          .to(items, { opacity: 1, y: 0, duration: d * .3, stagger: d * .04, ease: "power3.out" }, "-=0.16");
        inn.call(() => {
          gsap.set(n.plate, { clearProps: "clipPath,opacity" });
          if (n.tabs) gsap.set(n.tabs, { clearProps: "height,marginBottom" });
          gsap.set([...items, ...n.text, ...n.chevrons, ...(back ? [back] : [])], { clearProps: "transform,opacity,transformOrigin" });
          busy.current = false;
          resolve();
        });
      };
      let fallback = 0;
      const handOver = () => {
        flight.current = { from, to: id, enter };
        open(id);
        // When the pick does not show here (it opened another screen), the panel comes back as it was.
        fallback = window.setTimeout(() => { if (flight.current?.enter === enter) enter(); }, STILL_SAME_MS);
      };
    }), "section-swap");
  };

  return pick;
}
