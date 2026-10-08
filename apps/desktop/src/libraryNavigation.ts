export interface SelectionScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
  itemTop: number;
  itemHeight: number;
  padding?: number;
}

/** CSS resolves repeat() to one pixel track per rendered column. Free space
 * around a centered grid is not an extra column. */
export function renderedGridColumns(template: string): number {
  return Math.max(1, template.trim().split(/\s+/).filter(track => /^\d+(?:\.\d+)?px$/.test(track)).length);
}

/** Interruptible ease-out tween. Caller owns cancellation on navigation or
 * manual scrolling; reduced-motion users receive the same final position. */
export function tweenSelectionScroll(root: HTMLElement, target: number): () => void {
  const from = root.scrollTop;
  if (Math.abs(target-from) < 1 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    root.scrollTop = target;
    return () => {};
  }
  const duration = Math.min(380, Math.max(220, Math.abs(target-from)*.28));
  let frame = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, Math.max(0, (now-start)/duration));
    root.scrollTop = from+(target-from)*(1-Math.pow(1-progress,3));
    if(progress < 1) frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

export interface SelectionRelativeTopMetrics {
  scrollTop: number;
  viewportTop: number;
  itemTop: number;
}

export function selectionItemTopInScrollContainer(metrics: SelectionRelativeTopMetrics) {
  return Math.max(0, metrics.scrollTop + metrics.itemTop - metrics.viewportTop);
}

export function calculateSelectionScrollTop(metrics: SelectionScrollMetrics) {
  const padding = Math.max(0, metrics.padding ?? 8);
  const visibleTop = metrics.scrollTop + padding;
  const visibleBottom = metrics.scrollTop + metrics.viewportHeight - padding;
  const itemBottom = metrics.itemTop + metrics.itemHeight;
  if (metrics.itemTop < visibleTop) return Math.max(0, metrics.itemTop - padding);
  if (itemBottom > visibleBottom) return Math.max(0, itemBottom - metrics.viewportHeight + padding);
  return metrics.scrollTop;
}
