/**
 * One disk drawn as a hard drive (Seba, 2026-11-17; from examples/game-access-hdd): three layers of art (the body, the
 * platter and the head, `hdd/*.webp`) and the data drawn in SVG on its right: letter, name, how full it is, used, free,
 * capacity and what it is doing. Reading or writing, the platter spins and the head swings (GSAP; still with reduced
 * motion). Under 75 % full it is blue, under 90 % yellow, then red. Colours and fonts are tokens (hdd.css).
 */
import { useEffect, useRef } from "react";
import { gsap, motionOk } from "../motion/gsap";
import { useI18n } from "../i18n";
import { formatBytes } from "./format";
import body from "./hdd/hdd-body.webp";
import platter from "./hdd/hdd-platter.webp";
import head from "./hdd/hdd-head.webp";
import "./hdd.css";

export type DiskActivity = "idle" | "reading" | "writing";

const BAR_X = 212, BAR_W = 836;
/** The box around what the disk is, as wide as the word it holds ("NVMe", "HDD USB"). */
const KIND_W = (kind: string) => Math.max(110, kind.length * 24 + 44);
const TICKS = Array.from({ length: 29 }, (_, i) => BAR_X + i * 29);

export default function DiskCard({ letter, label, caption, totalBytes, usedBytes, activity = "idle", kind = "", kindTip = "" }: {
  letter: string; label: string; caption: string; totalBytes: number; usedBytes: number; activity?: DiskActivity;
  /** What the disk is, in its own corner of the panel: NVMe, SSD, HDD, and USB when it hangs off a USB port. */
  kind?: string; kindTip?: string;
}) {
  const { t } = useI18n();
  const platterRef = useRef<HTMLImageElement>(null);
  const headRef = useRef<HTMLImageElement>(null);
  const ledRef = useRef<SVGCircleElement>(null);
  const barRef = useRef<SVGRectElement>(null);
  const percentRef = useRef<SVGTextElement>(null);
  const shown = useRef<number | null>(null);
  const used = Math.min(totalBytes, Math.max(0, usedBytes));
  const free = Math.max(0, totalBytes - used);
  const percent = totalBytes > 0 ? used / totalBytes * 100 : 0;
  const level = percent >= 90 ? "critical" : percent >= 75 ? "warning" : "normal";
  const name = label.length > 24 ? `${label.slice(0, 23)}…` : label;

  // The bar and the percentage go to the new value (at once the first time, or with reduced motion).
  useEffect(() => {
    const bar = barRef.current, text = percentRef.current;
    if (!bar || !text) return;
    const width = BAR_W * percent / 100;
    if (shown.current === null || !motionOk()) {
      bar.setAttribute("width", String(width)); text.textContent = `${Math.round(percent)}%`; shown.current = percent; return;
    }
    const count = { value: shown.current };
    const tweens = [
      gsap.to(bar, { attr: { width }, duration: .75, ease: "power2.out" }),
      gsap.to(count, { value: percent, duration: .75, ease: "power2.out", onUpdate: () => { text.textContent = `${Math.round(count.value)}%`; } }),
    ];
    shown.current = percent;
    return () => tweens.forEach(tween => tween.kill());
  }, [percent]);

  // Reading or writing: the platter spins (faster writing) and the head swings around its bearing.
  useEffect(() => {
    const disk = platterRef.current, arm = headRef.current, led = ledRef.current;
    if (!disk || !arm || !led) return;
    gsap.set(arm, { transformOrigin: "35% 61%" });
    gsap.set(disk, { transformOrigin: "50% 50%" });
    if (activity === "idle" || !motionOk()) {
      const rest = [gsap.to(arm, { rotation: 0, duration: .45, ease: "power2.out" }), gsap.to(led, { opacity: .43, duration: .3 })];
      return () => rest.forEach(tween => tween.kill());
    }
    const writing = activity === "writing";
    const from = Number(gsap.getProperty(disk, "rotation")) || 0;
    const tweens = [
      gsap.fromTo(disk, { rotation: from }, { rotation: from + 360, duration: writing ? .72 : 1.15, ease: "none", repeat: -1 }),
      gsap.fromTo(arm, { rotation: -3.3 }, { rotation: 4.5, duration: writing ? .27 : .58, repeat: -1, yoyo: true, ease: "sine.inOut" }),
      gsap.fromTo(led, { opacity: 1 }, { opacity: .3, duration: .26, repeat: -1, yoyo: true, ease: "sine.inOut" }),
    ];
    return () => tweens.forEach(tween => tween.kill());
  }, [activity]);

  const doing = activity === "reading" ? t("hddReading") : activity === "writing" ? t("hddWriting") : t("hddIdle");
  return (
    <div className={`ga-hdd is-${level}`} role="img"
      aria-label={t("hddAria", { letter, label, percent: Math.round(percent), free: formatBytes(free), total: formatBytes(totalBytes) })}>
      <img className="ga-hdd-body" src={body} alt="" draggable={false} />
      <img ref={platterRef} className="ga-hdd-platter" src={platter} alt="" draggable={false} />
      <img ref={headRef} className="ga-hdd-head" src={head} alt="" draggable={false} />
      <div className="ga-hdd-accent" />
      <svg className="ga-hdd-panel" viewBox="0 0 1100 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect className="ga-hdd-box" x="4" y="50" width="174" height="222" rx="18" />
        <path className="ga-hdd-corner" d="M 18 64 h 45 M 165 251 h -45" />
        <text className="ga-hdd-unit" x="88" y="196" textAnchor="middle">{letter}</text>
        <text className="ga-hdd-micro" x="213" y="77">{t("hddVolume")}</text>
        {kind ? <g className="ga-hdd-kind-mark">
          {kindTip ? <title>{kindTip}</title> : null}
          <rect className="ga-hdd-kind-box" x={1056 - KIND_W(kind)} y="38" width={KIND_W(kind)} height="56" rx="14" />
          <text className="ga-hdd-kind" x="1036" y="78" textAnchor="end">{kind}</text>
        </g> : null}
        <text className="ga-hdd-label" x="209" y="151" {...(name.length > 14 ? { textLength: 515, lengthAdjust: "spacingAndGlyphs" } : {})}
          style={{ fontSize: name.length > 19 ? 45 : name.length > 15 ? 53 : 62 }}>{name}</text>
        <text className="ga-hdd-micro" x="213" y="197">{caption}</text>
        <text ref={percentRef} className="ga-hdd-percent" x="1050" y="233" textAnchor="end">0%</text>
        <path className="ga-hdd-rule" d="M 213 224 h 835" />
        <text className="ga-hdd-caption" x="213" y="285">{t("hddUsed")}</text>
        <text className="ga-hdd-value" x="213" y="338">{formatBytes(used)}</text>
        <text className="ga-hdd-caption" x="680" y="285">{t("hddFree")}</text>
        <text className="ga-hdd-value" x="680" y="338">{formatBytes(free)}</text>
        <rect className="ga-hdd-track" x={BAR_X} y="365" width={BAR_W} height="48" rx="12" />
        <clipPath id={`ga-hdd-bar-${letter}`}><rect x={BAR_X} y="365" width={BAR_W} height="48" rx="12" /></clipPath>
        <g clipPath={`url(#ga-hdd-bar-${letter})`}>
          <rect ref={barRef} className="ga-hdd-fill" x={BAR_X} y="365" width="0" height="48" />
          <rect className="ga-hdd-gloss" x={BAR_X} y="365" width={BAR_W} height="24" />
          {TICKS.map(x => <path key={x} className="ga-hdd-tick" d={`M ${x} 365 v 48`} />)}
        </g>
        <text className="ga-hdd-capacity" x="213" y="481">{t("hddCapacity", { size: formatBytes(totalBytes) })}</text>
        <circle ref={ledRef} className="ga-hdd-led" cx="876" cy="469" r="9" opacity=".43" />
        <text className="ga-hdd-activity" x="901" y="478">{doing}</text>
      </svg>
    </div>
  );
}
