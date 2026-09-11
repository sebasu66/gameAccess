import type { SteamMovie } from "./types";

export function steamTrailerSource(movie?: SteamMovie): string | undefined {
  return movie?.mp4 || movie?.webm || movie?.hls_h264;
}

export function selectSteamTrailer(movies?: SteamMovie[]): SteamMovie | undefined {
  const playable = movies?.filter(movie => steamTrailerSource(movie));
  return playable?.find(movie => movie.highlight) ?? playable?.[0];
}

export function isHlsSource(source: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(source);
}
