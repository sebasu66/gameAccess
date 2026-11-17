export const SELECTED_MEDIA_DELAY_MS = 2000;
export function scheduleSelectedMedia(load: () => void, delay = SELECTED_MEDIA_DELAY_MS): () => void {
  const timer = setTimeout(load, delay);
  return () => clearTimeout(timer);
}
