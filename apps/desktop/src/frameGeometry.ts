/**
 * Geometry of the device frame (DeviceFrame.tsx): the app as the screen of a device. A thin band runs around the
 * window between an outer line and an inner line; the inner line steps inward into tabs wherever something lives on
 * the edge (the banner drawer at the top, the logo on the right, the footer controls at the bottom). Corners and tab
 * corners are cut at 45°, the way a machined bezel would be. Everything is in CSS pixels of the window.
 */
export type FrameEdge = "top" | "right" | "bottom";
export interface FrameTab { edge: FrameEdge; from: number; to: number; depth: number }
export interface FrameMetrics { width: number; height: number; inset: number; corner: number; cut: number }

export const FRAME: Omit<FrameMetrics, "width" | "height"> = { inset: 13, corner: 22, cut: 12 };

const n = (value: number) => Math.round(value * 10) / 10;

/** Concave cut where a tab leaves its edge (the inside corner between the band and the tab), also at 45°. */
export const JOIN_CUT = 8;

/**
 * Whether a bottom tab reaches a corner of the frame: then it takes the corner in (the corner cut sits inside its
 * metal) instead of stepping back to the edge right before the cut.
 */
export function tabMerge(m: FrameMetrics, tab: FrameTab): { left: boolean; right: boolean } {
  if (tab.edge !== "bottom") return { left: false, right: false };
  const reach = m.corner + m.cut + JOIN_CUT;
  return { left: tab.from < m.inset + reach, right: tab.to > m.width - m.inset - reach };
}

/** The inner line, clockwise from the top-left corner, stepping into each tab. */
export function frameInnerPath(m: FrameMetrics, tabs: FrameTab[]): string {
  const { width: W, height: H, inset: I, corner: K } = m;
  const points: Array<[number, number]> = [[I, I + K], [I + K, I]];
  // Outside the corners a tab is clamped to the straight part of its edge.
  const span = (edge: FrameEdge) => (edge === "right" ? H : W) - I - K;
  const along = (edge: FrameEdge) => tabs
    .filter(tab => tab.edge === edge)
    .map(tab => {
      const merge = tabMerge(m, tab);
      return { ...tab, merge, from: merge.left ? tab.from : Math.max(tab.from, I + K + JOIN_CUT), to: merge.right ? tab.to : Math.min(tab.to, span(tab.edge) - JOIN_CUT) };
    })
    .filter(tab => tab.to - tab.from > 2 * m.cut);
  // Depth, cut of the tab's own corners and the concave cut where it leaves the edge (never deeper than the tab).
  const shape = (tab: FrameTab) => { const d = Math.max(0, tab.depth), c = Math.min(m.cut, d); return { d, c, j: Math.max(0, Math.min(JOIN_CUT, d - c)) }; };
  for (const tab of along("top").sort((a, b) => a.from - b.from)) {
    const { d, c, j } = shape(tab);
    points.push([tab.from - j, I], [tab.from, I + j], [tab.from, I + d - c], [tab.from + c, I + d], [tab.to - c, I + d], [tab.to, I + d - c], [tab.to, I + j], [tab.to + j, I]);
  }
  points.push([W - I - K, I], [W - I, I + K]);
  for (const tab of along("right").sort((a, b) => a.from - b.from)) {
    const { d, c, j } = shape(tab);
    points.push([W - I, tab.from - j], [W - I - j, tab.from], [W - I - d + c, tab.from], [W - I - d, tab.from + c], [W - I - d, tab.to - c], [W - I - d + c, tab.to], [W - I - j, tab.to], [W - I, tab.to + j]);
  }
  const bottom = along("bottom").sort((a, b) => b.from - a.from);
  const rightCorner = bottom.find(tab => tab.merge.right), leftCorner = bottom.find(tab => tab.merge.left);
  // The bottom-right corner, or the tab that takes it in: the right edge comes down onto the tab's top.
  if (rightCorner) {
    const { d, j } = shape(rightCorner);
    points.push([W - I, H - I - d - j], [W - I - j, H - I - d]);
  } else points.push([W - I, H - I - K], [W - I - K, H - I]);
  for (const tab of bottom) {
    const { d, c, j } = shape(tab);
    if (!tab.merge.right) points.push([tab.to + j, H - I], [tab.to, H - I - j], [tab.to, H - I - d + c], [tab.to - c, H - I - d]);
    if (!tab.merge.left) points.push([tab.from + c, H - I - d], [tab.from, H - I - d + c], [tab.from, H - I - j], [tab.from - j, H - I]);
  }
  // The bottom-left corner, or the tab that takes it in: the tab's top runs into the left edge.
  if (leftCorner) {
    const { d, j } = shape(leftCorner);
    points.push([I + j, H - I - d], [I, H - I - d - j]);
  } else points.push([I + K, H - I], [I, H - I - K]);
  return `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L")} Z`;
}

/** The outer line: the bezel's edge, a plain cut rectangle a few pixels in from the window. */
export function frameOuterPath(m: FrameMetrics, gap = 5): string {
  const { width: W, height: H } = m, I = m.inset - gap, K = m.corner + gap * .4;
  return `M${I} ${I + K} L${I + K} ${I} L${W - I - K} ${I} L${W - I} ${I + K} L${W - I} ${H - I - K} L${W - I - K} ${H - I} L${I + K} ${H - I} L${I} ${H - I - K} Z`;
}

/** The band and the tabs as one filled shape: the window minus what the inner line encloses (even-odd). */
export function frameFillPath(m: FrameMetrics, tabs: FrameTab[]): string {
  return `M0 0 H${m.width} V${m.height} H0 Z ${frameInnerPath(m, tabs)}`;
}

/** A tab that wraps an element on an edge, with `pad` pixels of room around it (null when there is no element). */
export function tabAround(edge: FrameEdge, rect: { left: number; top: number; right: number; bottom: number } | null, m: FrameMetrics, pad = 8): FrameTab | null {
  if (!rect) return null;
  if (edge === "top") return { edge, from: rect.left - pad, to: rect.right + pad, depth: rect.bottom + pad - m.inset };
  if (edge === "bottom") return { edge, from: rect.left - pad, to: rect.right + pad, depth: m.height - m.inset - (rect.top - pad) };
  return { edge, from: rect.top - pad, to: rect.bottom + pad, depth: m.width - m.inset - (rect.left - pad) };
}
