import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import type { LibraryGame, LibrarySummary, LibraryUsage } from "../catalog/DigitalProcessManager";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

const GB = 1024 ** 3;

/** One long bar: what the library takes, recoverable duplicates, unfinished downloads, other files and what is free. */
export function DiskBar({ summary, c }: { summary: LibrarySummary; c: LibraryCopy }) {
  const free = summary.disk_free_bytes ?? 0;
  const reclaim = summary.reclaimable_bytes;
  const games = Math.max(0, summary.used_bytes - reclaim);
  const known = games + reclaim + summary.transfers_bytes + free;
  const total = Math.max(summary.disk_total_bytes ?? 0, known);
  const parts = [
    { key: "games", name: c.libraryGames, value: games, color: "#ff6a00" },
    { key: "duplicates", name: c.duplicates, value: reclaim, color: "#ffb000" },
    { key: "unfinished", name: c.unfinished, value: summary.transfers_bytes, color: "#569cff" },
    { key: "other", name: c.otherUse, value: total - known, color: "#5b6672" },
    { key: "free", name: c.free, value: free, color: "#34c778" },
  ].filter(part => part.value > 0);
  return (
    <div className="grid gap-2">
      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={c.diskChart}>
        {parts.map(part => <span key={part.key} title={`${part.name}: ${formatBytes(part.value)}`} style={{ width: `${(part.value / total) * 100}%`, background: part.color }} />)}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
        {parts.map(part => (
          <li key={part.key} className="flex items-center gap-2 text-xs text-muted-foreground">
            <i className="inline-block size-2.5 rounded-[3px]" style={{ background: part.color }} />{part.name}<b className="tabular-nums text-foreground">{formatBytes(part.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars: the games that take the most space. */
export function SizeChart({ games, c }: { games: LibraryGame[]; c: LibraryCopy }) {
  const data = useMemo(() => [...games].filter(g => (g.size_bytes ?? 0) > 0).sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0)).slice(0, 6)
    .map(g => ({ name: g.name.length > 18 ? `${g.name.slice(0, 17)}…` : g.name, gb: Number(((g.size_bytes ?? 0) / GB).toFixed(1)) })), [games]);
  const config: ChartConfig = { gb: { label: "GB", color: "#ff6a00" } };
  return (
    <Card>
      <CardHeader><CardTitle>{c.sizeChart}</CardTitle></CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-44 w-full justify-start">
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
            <YAxis dataKey="name" type="category" width={104} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <XAxis type="number" hide />
            <ChartTooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} content={<ChartTooltipContent config={config} formatValue={value => `${value} GB`} />} />
            <Bar dataKey="gb" name="GB" fill="var(--color-gb)" radius={3} barSize={12} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const lastDays = (by: Record<string, number>, count: number) => Array.from({ length: count }, (_, i) => {
  const date = new Date(Date.now() - (count - 1 - i) * 86400000).toISOString().slice(0, 10);
  return { label: date.slice(5), value: by[date] ?? 0 };
});
const lastMonths = (by: Record<string, number>, count: number) => Array.from({ length: count }, (_, i) => {
  const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (count - 1 - i));
  const key = date.toISOString().slice(0, 7);
  return { label: key.slice(2), value: by[key] ?? 0 };
});

/** Plays per day or per month. Reusable by the future Library tab (feed it the launcher's usage data). */
export function UsageChart({ usage, c, className }: { usage: LibraryUsage | null; c: LibraryCopy; className?: string }) {
  const [mode, setMode] = useState<"day" | "month">("day");
  const data = useMemo(() => !usage ? [] : mode === "day" ? lastDays(usage.by_day, 14) : lastMonths(usage.by_month, 6), [usage, mode]);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const config: ChartConfig = { value: { label: c.launches, color: "#569cff" } };
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{c.usageChart}</CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "day" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => setMode("day")}>{c.byDay}</Button>
          <Button size="sm" variant={mode === "month" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => setMode("month")}>{c.byMonth}</Button>
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? <p className="m-0 py-6 text-center text-xs text-muted-foreground">{c.noUsage}</p> :
          <ChartContainer config={config} className="aspect-auto h-36 w-full">
            <BarChart data={data} margin={{ left: -24, right: 4, top: 4, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={mode === "day" ? 2 : 0} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={36} />
              <ChartTooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} content={<ChartTooltipContent config={config} />} />
              <Bar dataKey="value" name={c.launches} fill="var(--color-value)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>}
      </CardContent>
    </Card>
  );
}
