export interface SelectionScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
  itemTop: number;
  itemHeight: number;
  padding?: number;
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
