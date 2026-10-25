import { Profiler, type ReactNode } from "react";

const totals = new Map<string, { count: number; ms: number }>();

/** Development-only render counter: React ignores Profiler in production builds. */
export default function RenderProbe({ id, children }: { id: string; children: ReactNode }) {
 return <Profiler id={id} onRender={(_id, _phase, actual) => {
  const entry = totals.get(id) ?? { count: 0, ms: 0 };
  entry.count++; entry.ms += actual; totals.set(id, entry);
 }}>{children}</Profiler>;
}

/** Heaviest components since the last call, as "Name×renders ms". Clears the counters. */
export function takeRenderSummary(top = 3): string[] {
 const lines = [...totals.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, top)
  .filter(([, v]) => v.count > 0).map(([name, v]) => `${name}×${v.count} ${Math.round(v.ms)}ms`);
 totals.clear();
 return lines;
}
