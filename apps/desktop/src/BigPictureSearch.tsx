/**
 * Big picture's search (Seba, 2026-11-10): Ctrl+F or / on the keyboard, X on the controller, or the side rail's
 * button. A bar over the top of the games, so they stay in view and filter as it is typed: at once from two characters
 * (searchAppliesNow), and whatever is written after two seconds without a key (SEARCH_IDLE_MS). With the controller
 * (bigPictureView().input) it brings an on-screen keyboard; with keyboard and mouse it does not. Enter or Done goes
 * back to the games with the search applied; Esc or B closes it too; Clear empties it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Delete, Search, X } from "lucide-react";
import { GaButton, GaIconButton } from "./components/ga/Buttons";
import { useI18n } from "./i18n";
import { SEARCH_IDLE_MS, searchAppliesNow, setBigPictureQuery, useBigPictureView } from "./bigPicture";
import "./big-picture-browse.css";

const ROWS = ["1234567890", "qwertyuiop", "asdfghjklñ", "zxcvbnm-:"];

export default function BigPictureSearch({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { query, input } = useBigPictureView();
  const pad = input === "pad";
  const [text, setText] = useState(query);
  const latest = useRef(text);
  const timer = useRef(0);
  const field = useRef<HTMLInputElement>(null);
  const firstKey = useRef<HTMLButtonElement>(null);
  const change = (next: string) => {
    latest.current = next;
    setText(next);
    window.clearTimeout(timer.current);
    if (searchAppliesNow(next)) setBigPictureQuery(next);
    else timer.current = window.setTimeout(() => setBigPictureQuery(latest.current), SEARCH_IDLE_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // The games start below the bar (and the on-screen keyboard), so the results it filters stay in view.
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = root.current;
    if (!bar) return;
    const measure = () => {
      const grid = document.querySelector(".ga-bento-wrap")?.closest<HTMLElement>(".library-section-scroll");
      const clear = Math.max(0, bar.getBoundingClientRect().bottom - (grid?.getBoundingClientRect().top ?? 0));
      document.body.style.setProperty("--ga-big-search-clear", `${Math.round(clear)}px`);
    };
    measure();
    document.body.classList.add("ga-big-searching");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => { observer?.disconnect(); document.body.classList.remove("ga-big-searching"); document.body.style.removeProperty("--ga-big-search-clear"); };
  }, []);
  // With the keyboard the field has the focus; with the controller, the on-screen keyboard's first letter.
  useEffect(() => { (pad ? firstKey.current : field.current)?.focus({ preventScroll: true }); }, [pad]);
  const done = () => { window.clearTimeout(timer.current); setBigPictureQuery(latest.current); onClose(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); done(); }
  };
  return createPortal(<div ref={root} className="ga-big-search" role="search" aria-label={t("bigPictureSearch")}>
    <div className="ga-big-search-bar">
      <Search className="ga-big-search-icon" size={24} aria-hidden="true" />
      <input ref={field} className="ga-big-search-field" type="text" enterKeyHint="search" value={text} placeholder={t("bigPictureSearchPlaceholder")} aria-label={t("bigPictureSearch")}
        data-no-autofocus autoComplete="off" spellCheck={false} onChange={event => change(event.target.value)} onKeyDown={onKeyDown} />
      <div className="ga-actions">
        {text ? <GaButton onClick={() => { change(""); (pad ? firstKey.current : field.current)?.focus(); }}>{t("bigPictureClearSearch")}</GaButton> : null}
        <GaButton variant="primary" data-primary onClick={done}>{t("bigPictureSearchDone")}</GaButton>
        <GaIconButton icon={<X size={20} aria-hidden="true" />} label={t("bigPictureSearchClose")} onClick={done} />
      </div>
    </div>
    <p className="ga-hint ga-big-keys">{pad
      ? <><span className="ga-pad-key is-a">A</span> {t("bigPictureKeyType")} <span className="ga-pad-key">X</span> {t("bigPictureKeyDelete")} <span className="ga-pad-key">B</span> {t("bigPictureSearchClose")}</>
      : <><kbd className="ga-pad-key">{t("bigKeyEnter")}</kbd> {t("bigPictureSearchDone")} <kbd className="ga-pad-key">{t("bigKeyEsc")}</kbd> {t("bigPictureSearchClose")}</>}
      <span className="ga-big-search-rule">{t("bigPictureSearchRule")}</span></p>
    {pad ? <div className="ga-big-osk" role="group" aria-label={t("bigPictureKeyboard")}>
      {ROWS.map((row, r) => <div key={row} className="ga-big-osk-row">
        {[...row].map((char, c) => <button key={char} ref={r === 1 && c === 0 ? firstKey : undefined} type="button" className="ga-big-osk-key" onClick={() => change(latest.current + char)}>{char}</button>)}
      </div>)}
      <div className="ga-big-osk-row">
        <button type="button" className="ga-big-osk-key is-wide" onClick={() => change(`${latest.current} `)}>{t("bigPictureKeySpace")}</button>
        <button type="button" className="ga-big-osk-key is-wide" data-key="backspace" aria-label={t("bigPictureKeyDelete")} onClick={() => change(latest.current.slice(0, -1))}><Delete size={22} aria-hidden="true" /></button>
      </div>
    </div> : null}
  </div>, document.body);
}
