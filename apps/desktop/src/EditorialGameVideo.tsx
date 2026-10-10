import { useState } from "react";
import { useI18n } from "./i18n";
import { availableEditorialVideos, editorialEmbedUrl, selectEditorialVideo, type EditorialLocale } from "./editorialVideos";
import "./editorial-video.css";

export default function EditorialGameVideo({ appId }: { appId: number | null | undefined }) {
  const { locale } = useI18n();
  const [chosen, setChosen] = useState<EditorialLocale | null>(null);
  const available = availableEditorialVideos(appId);
  const selected = selectEditorialVideo(appId, chosen ?? locale);
  if (!selected) return null;
  const english = locale === "en";
  const title = selected.video.title || (english ? "GameAccess game guide" : "Guía del juego · GameAccess");
  return <section className="ga-editorial-video" aria-label={english ? "GameAccess video" : "Video de GameAccess"}>
    <header><strong>{title}</strong>{available.length > 1 ? <select
      aria-label={english ? "Video language" : "Idioma del video"} value={selected.locale}
      onChange={event => setChosen(event.target.value as EditorialLocale)}>
      {available.map(item => <option key={item.locale} value={item.locale}>{item.locale === "es" ? "Español" : "English"}</option>)}
    </select> : <span>{selected.locale === "es" ? "Español" : "English"}</span>}</header>
    <iframe key={selected.video.youtubeId} title={title} src={editorialEmbedUrl(selected.video, selected.locale)}
      loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen />
    <a href={`https://www.youtube.com/watch?v=${selected.video.youtubeId}`} target="_blank" rel="noreferrer">
      {english ? "Watch on YouTube" : "Ver en YouTube"}
    </a>
  </section>;
}
