import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import type { LibraryGame, LibrarySummary, LibraryUsage } from "../catalog/DigitalProcessManager";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

const GB = 1024 ** 3;

/** Donut: what the library takes, what could be recovered, unfinished downloads and what is still free. */
export function DiskChart({ summary, c }: { summary: LibrarySummary; c: LibraryCopy }) {
  const data = useMemo(() => {
    const reclaim = summary.reclaimable_bytes;
    return [
      { key: "games", name: c.libraryGames, value: Math.max(0, summary.used_bytes - reclaim) },
      { key: "duplicates", name: c.duplicates, value: reclaim },
      { key: "unfinished", name: c.unfinished, value: summary.transfers_bytes },
      { key: "free", name: c.free, value: summary.disk_free_bytes ?? 0 },
    ].filter(item => item.value > 0);
  }, [summary, c]);
  const config: ChartConfig = { games: { label: c.libraryGames, color: "#ff6a00" }, duplicates: { label: c.duplicates, color: "#ffb000" }, unfinished: { label: c.unfinished, color: "#569cff" }, free: { label: c.free, color: "#34c778" } };
  return (
    <Card>
      <CardHeader><CardTitle>{c.diskChart}</CardTitle></CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-square max-h-48 w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent config={config} formatValue={formatBytes} />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" stroke="none" paddingAngle={2}>
              {data.map(item => <Cell key={item.key} fill={config[item.key].color} />)}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="m-0 mt-2 grid list-none gap-1 p-0">
          {data.map(item => (
            <li key={item.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: config[item.key].color }} />{item.name}</span>
              <b className="tabular-nums">{formatBytes(item.value)}</b>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
