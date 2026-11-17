import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface GaTab { id: string; label: string; content: ReactNode }

/**
 * Template for any screen that would otherwise grow without limit: one sub-section visible at a
 * time. Look and colours live in tabs.css (`.ga-tabs`); every selector gets its own muted colour.
 */
export default function GaTabs({ tabs, initial, label }: { tabs: GaTab[]; initial?: string; label: string }) {
  const base = useId();
  const [selected, setSelected] = useState(initial && tabs.some(tab => tab.id === initial) ? initial : tabs[0]?.id);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const current = tabs.find(tab => tab.id === selected) ?? tabs[0];
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
    if (target < 0) return;
    event.preventDefault();
    setSelected(tabs[target].id);
    buttons.current[tabs[target].id]?.focus();
  };
  if (!current) return null;
  return <div className="ga-tabs">
    <div className="ga-tabs-list" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => <button key={tab.id} ref={node => { buttons.current[tab.id] = node; }} type="button" role="tab"
        id={`${base}-tab-${tab.id}`} aria-controls={`${base}-panel-${tab.id}`} aria-selected={tab.id === current.id}
        tabIndex={tab.id === current.id ? 0 : -1} className="ga-tab" data-tab-index={index % 6}
        onClick={() => setSelected(tab.id)} onKeyDown={event => move(event, index)}>{tab.label}</button>)}
    </div>
    <div className="ga-tabs-panel" role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`}>{current.content}</div>
  </div>;
}
