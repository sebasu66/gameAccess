import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type Hls from "hls.js";
import { isHlsSource } from "./steamTrailer";
import { narrate } from "./narrationLog";

export function useSteamTrailer(videoRef: RefObject<HTMLVideoElement>, source: string | undefined, active: boolean, appId: number | null | undefined, onFailure: () => void) {
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || !active) return;
    let disposed = false;
    let hls: Hls | undefined;
    let reported = false;
    const progress = () => {
      if (reported || video.currentTime < 1 || !video.videoWidth) return;
      reported = true;
      void narrate(`Steam trailer playing for AppID ${appId}: ${video.videoWidth}x${video.videoHeight}, time=${video.currentTime.toFixed(1)}s.`, { area: "MEDIA" });
    };
    const fail = () => { if (!disposed) failureRef.current(); };
    video.addEventListener("timeupdate", progress);
    if (!isHlsSource(source) || video.canPlayType("application/vnd.apple.mpegurl")) video.src = source;
    else void import("hls.js").then(({ default: HlsPlayer }) => {
      if (disposed) return;
      if (!HlsPlayer.isSupported()) { fail(); return; }
      hls = new HlsPlayer({ enableWorker: true, capLevelToPlayerSize: true });
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          void narrate(`Steam trailer failed for AppID ${appId}: ${data.details}.`, { area: "MEDIA", level: "WARN" });
          fail();
        }
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    }).catch(fail);
    return () => {
      disposed = true;
      video.removeEventListener("timeupdate", progress);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoRef, source, active, appId]);
}
