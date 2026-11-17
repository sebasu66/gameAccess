/** A torrent source: magnet link or a .torrent file. */
export function isTorrentSource(source: string): boolean {
  const value = source.trim().toLowerCase();
  return value.startsWith("magnet:?") || /\.torrent(?:$|[?#])/.test(value);
}
