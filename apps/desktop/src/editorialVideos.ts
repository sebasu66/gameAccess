export type EditorialLocale = "es" | "en";

export interface EditorialVideo {
  youtubeId: string;
  title: string;
  publishedAt: string;
}

export type EditorialVideoCatalog = Readonly<Record<string, Partial<Record<EditorialLocale, EditorialVideo>>>>;

/** Register only reviewed, published videos belonging to GameAccess. Key: Steam AppID. */
export const editorialVideos: EditorialVideoCatalog = {};

export function availableEditorialVideos(appId: number | null | undefined, catalog: EditorialVideoCatalog = editorialVideos) {
  const row = appId == null ? undefined : catalog[String(appId)];
  return (["es", "en"] as const).flatMap(locale => {
    const video = row?.[locale];
    return video && /^[A-Za-z0-9_-]{11}$/.test(video.youtubeId) ? [{ locale, video }] : [];
  });
}

export function selectEditorialVideo(appId: number | null | undefined, locale: string, catalog: EditorialVideoCatalog = editorialVideos) {
  const available = availableEditorialVideos(appId, catalog);
  return available.find(item => item.locale === locale)
    ?? available.find(item => item.locale === "es")
    ?? available[0];
}

export function editorialEmbedUrl(video: EditorialVideo, locale: EditorialLocale) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.youtubeId)) throw new Error("Invalid YouTube video ID");
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?playsinline=1&rel=0&hl=${locale}&cc_lang_pref=${locale}`;
}
