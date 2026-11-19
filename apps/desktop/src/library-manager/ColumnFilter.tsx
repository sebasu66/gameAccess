/**
 * The filter of one column of the library manager's grid (Seba, 2026-11-17), on TanStack Table: a right click on the
 * column's header, or its funnel, opens it under the header. What it offers comes from the table itself:
 * - "list": a word looked for in the column, and its values ticked one by one, each with how many rows have it
 *   (TanStack's faceted unique values, which already count only the rows the other columns' filters leave).
 * - "range": from and to, for numbers (size, plays, days), with the range the rows have (faceted min and max).
 * - "text": only the word (the name: one value per row, no list worth ticking).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { Column, FilterFn, Row } from "@tanstack/react-table";
import { useI18n } from "../i18n";
import { normalizeSearchText } from "../libraryText";
import { GaButton } from "../components/ga/Buttons";
import "./column-filter.css";

export type FilterKind = "text" | "list" | "range";
export interface ListFilter { text: string; values: string[] }
export interface RangeFilter { min?: number; max?: number }
export type ColumnFilterValue = ListFilter | RangeFilter;

const isList = (value: unknown): value is ListFilter => Boolean(value) && typeof value === "object" && "values" in (value as object);
export const filterActive = (value: unknown): boolean => isList(value) ? Boolean(value.text.trim() || value.values.length)
  : Boolean(value) && typeof value === "object" && ((value as RangeFilter).min != null || (value as RangeFilter).max != null);
/** An empty cell's value in a list: "" (a row with no folder, say). */
export const valueKey = (value: unknown) => value == null ? "" : String(value);

/** Word and ticked values. A column may search more than it shows (the source kind also searches its provider):
 *  `search` gives that text. */
/** The text a row is searched in. */
type Searcher<T> = (row: T) => string;
export function listFilter<T>(search?: Searcher<T>): FilterFn<T> {
  const fn: FilterFn<T> = (row: Row<T>, id: string, filter: ListFilter) => {
    const value = valueKey(row.getValue(id));
    const haystack = normalizeSearchText(search ? search(row.original) : value);
    const words = normalizeSearchText(filter.text.trim()).split(/\s+/).filter(Boolean);
    if (words.length && !words.every(word => haystack.includes(word))) return false;
    return !filter.values.length || filter.values.includes(value);
  };
  fn.autoRemove = value => !filterActive(value);
  return fn;
}

/** From and to, both included; a row with no number is out once a limit is set. */
export function rangeFilter<T>(): FilterFn<T> {
  const fn: FilterFn<T> = (row: Row<T>, id: string, filter: RangeFilter) => {
    const value = row.getValue(id);
    if (typeof value !== "number") return false;
    return (filter.min == null || value >= filter.min) && (filter.max == null || value <= filter.max);
  };
  fn.autoRemove = value => !filterActive(value);
  return fn;
}

/** How a number of the column is read and typed: size in GB, the rest as is. */
export interface RangeUnit { scale: number; format: (value: number) => string; from: string; to: string }

/** The filter said in a few words, for its chip over the grid. */
export function describeFilter(value: unknown, t: ReturnType<typeof useI18n>["t"], unit?: RangeUnit, emptyLabel = ""): string {
  if (isList(value)) return [value.text.trim() ? `“${value.text.trim()}”` : "", ...value.values.map(item => item || emptyLabel)].filter(Boolean).join(", ");
  const range = value as RangeFilter;
  const say = (n: number) => unit ? unit.format(n) : String(n);
  if (range.min != null && range.max != null) return t("lmFilterRange", { min: say(range.min), max: say(range.max) });
  return range.min != null ? t("lmFilterAtLeast", { min: say(range.min) }) : t("lmFilterAtMost", { max: say(range.max ?? 0) });
}

export default function ColumnFilter<T>({ column, kind, label, anchor, unit, onClose }: {
  column: Column<T, unknown>; kind: FilterKind; label: string; anchor: DOMRect; unit?: RangeUnit; onClose: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom });
  const current = column.getFilterValue();

  useLayoutEffect(() => {
    const width = box.current?.offsetWidth ?? 0, height = box.current?.offsetHeight ?? 0;
    setPlace({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - height - 8)) });
    field.current?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", key, true); };
  }, [onClose]);

  return createPortal(
    <div ref={box} className="lm-colfilter" role="dialog" aria-label={t("lmFilterTitle", { column: label })} style={{ left: place.left, top: place.top }}
      onContextMenu={event => event.preventDefault()}>
      <span className="ga-label">{t("lmFilterTitle", { column: label })}</span>
      {kind === "range"
        ? <RangeFields column={column} value={(current as RangeFilter | undefined) ?? {}} unit={unit} field={field} />
        : <ListFields column={column} value={isList(current) ? current : { text: "", values: [] }} withList={kind === "list"} field={field} />}
      <div className="lm-colfilter-actions">
        <GaButton disabled={!filterActive(current)} onClick={() => column.setFilterValue(undefined)}>{t("lmFilterClear")}</GaButton>
        <GaButton variant="primary" onClick={onClose}>{t("lmFilterDone")}</GaButton>
      </div>
    </div>,
    document.body,
  );
}

function ListFields<T>({ column, value, withList, field }: { column: Column<T, unknown>; value: ListFilter; withList: boolean; field: React.RefObject<HTMLInputElement> }) {
  const { t } = useI18n();
  const set = (next: ListFilter) => column.setFilterValue(filterActive(next) ? next : undefined);
  const facets = column.getFacetedUniqueValues();
  const words = normalizeSearchText(value.text.trim());
  const options = useMemo(() => [...facets.entries()].map(([raw, count]) => ({ value: valueKey(raw), count }))
    .reduce<Array<{ value: string; count: number }>>((all, option) => {
      const same = all.find(item => item.value === option.value);
      if (same) same.count += option.count; else all.push({ ...option });
      return all;
    }, [])
    .sort((a, b) => !a.value ? 1 : !b.value ? -1 : a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: "base" })), [facets]);
  // The ticked ones stay in the list even when a word or another column leaves them without rows.
  const shown = options.filter(option => !words || normalizeSearchText(option.value).includes(words));
  for (const ticked of value.values) if (!shown.some(option => option.value === ticked)) shown.push({ value: ticked, count: 0 });
  const toggle = (item: string) => set({ ...value, values: value.values.includes(item) ? value.values.filter(other => other !== item) : [...value.values, item] });
  return <>
    <label className="lm-colfilter-search">
      <Search aria-hidden="true" />
      <input ref={field} type="search" value={value.text} placeholder={t("lmFilterSearch")} aria-label={t("lmFilterSearch")} onChange={event => set({ ...value, text: event.target.value })} />
    </label>
    {withList ? <div className="lm-colfilter-list" role="group">
      {shown.length ? shown.map(option => <label key={option.value} className="lm-colfilter-option">
        <input type="checkbox" tabIndex={-1} checked={value.values.includes(option.value)} onChange={() => toggle(option.value)} />
        <span className="lm-colfilter-value" title={option.value || t("lmFilterEmpty")}>{option.value || t("lmFilterEmpty")}</span>
        <span className="lm-colfilter-count">{option.count}</span>
      </label>) : <p className="ga-hint">{t("lmFilterNone")}</p>}
    </div> : null}
  </>;
}

function RangeFields<T>({ column, value, unit, field }: { column: Column<T, unknown>; value: RangeFilter; unit?: RangeUnit; field: React.RefObject<HTMLInputElement> }) {
  const { t } = useI18n();
  const scale = unit?.scale ?? 1;
  const bounds = column.getFacetedMinMaxValues();
  const shown = (n?: number) => n == null ? "" : String(Math.round(n / scale * 10) / 10);
  // What is typed stays as typed ("1," while writing); the filter takes it once it is a number.
  const [draft, setDraft] = useState({ min: shown(value.min), max: shown(value.max) });
  const read = (text: string) => { const n = Number(text.replace(",", ".")); return text.trim() && Number.isFinite(n) ? n * scale : undefined; };
  const change = (side: "min" | "max", text: string) => {
    const next = { ...draft, [side]: text };
    setDraft(next);
    const range = { min: read(next.min), max: read(next.max) };
    column.setFilterValue(filterActive(range) ? range : undefined);
  };
  useEffect(() => { if (!filterActive(column.getFilterValue())) setDraft({ min: "", max: "" }); }, [column.getFilterValue()]); // eslint-disable-line react-hooks/exhaustive-deps
  const say = (n: number) => unit ? unit.format(n) : String(n);
  return <>
    <div className="lm-colfilter-range">
      <label><span className="ga-label">{unit?.from ?? t("lmFilterFrom")}</span>
        <input ref={field} type="text" inputMode="decimal" value={draft.min} placeholder={bounds ? shown(bounds[0]) : ""} onChange={event => change("min", event.target.value)} /></label>
      <label><span className="ga-label">{unit?.to ?? t("lmFilterTo")}</span>
        <input type="text" inputMode="decimal" value={draft.max} placeholder={bounds ? shown(bounds[1]) : ""} onChange={event => change("max", event.target.value)} /></label>
    </div>
    {bounds ? <p className="ga-hint">{t("lmFilterRangeHint", { min: say(bounds[0]), max: say(bounds[1]) })}</p> : null}
  </>;
}
