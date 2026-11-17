import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "../../lib/cn";

/** shadcn-style chart wrapper: series colors come from `config`, exposed to children as CSS variables. */
export type ChartConfig = Record<string, { label: string; color: string }>;

export const ChartContainer = ({ config, className, children, ...props }: React.ComponentProps<"div"> & { config: ChartConfig; children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"] }) => {
  const style = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color])) as React.CSSProperties;
  return (
    <div className={cn("flex aspect-video justify-center font-sans text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-foreground/10 [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none", className)} style={style} {...props}>
      <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
    </div>
  );
};

export const ChartTooltip = RechartsPrimitive.Tooltip;
export const ChartLegend = RechartsPrimitive.Legend;

type TooltipPayload = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };
export const ChartTooltipContent = ({ active, payload, label, config, formatValue }: { active?: boolean; payload?: TooltipPayload[]; label?: string; config?: ChartConfig; formatValue?: (value: number) => string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-32 gap-1 rounded-md border border-border bg-card px-3 py-2 font-sans text-xs text-foreground shadow-lg">
      {label ? <div className="font-bold">{label}</div> : null}
      {payload.map(item => {
        const key = String(item.dataKey ?? item.name);
        const color = item.color || (item.payload?.fill as string | undefined) || config?.[key]?.color;
        return (
          <div key={key + String(item.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground"><i className="inline-block size-2 rounded-[2px]" style={{ background: color }} />{item.name ?? config?.[key]?.label ?? key}</span>
            <span className="font-bold tabular-nums">{typeof item.value === "number" && formatValue ? formatValue(item.value) : String(item.value)}</span>
          </div>
        );
      })}
    </div>
  );
};
