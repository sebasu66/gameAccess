from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("apps/desktop/src/LibraryRoom.tsx")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    'import { useEffect, useMemo, useRef, useState } from "react";',
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";',
    "react hooks import",
)

text = replace_once(
    text,
    '''function SteamCover({ game }: { game: CatalogGame }) {
  const sources = useMemo(() => artworkCandidates(game), [game.app_id, game.capsule_image, game.header_image]);
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [game.id]);
  const source = sources[sourceIndex];''',
    '''function SteamCover({ game }: { game: CatalogGame }) {
  const sources = artworkCandidates(game);
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];''',
    "cover hook cleanup",
)

text = replace_once(
    text,
    '  const [videoReady, setVideoReady] = useState(false);',
    '  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);',
    "video ready state",
)

text = replace_once(
    text,
    '''  const selectedGame = games[selectedIndex] ?? games[0];
  const accountCount = useMemo(() => new Set(games.flatMap((game) => game.local_account_labels ?? [])).size, [games]);
  const download = selectedGame?.app_id ? downloads[selectedGame.app_id] : undefined;''',
    '''  const selectedGame = games[selectedIndex] ?? games[0];
  const selectedGameId = selectedGame?.id;
  const selectedAppId = selectedGame?.app_id;
  const accountCount = useMemo(() => new Set(games.flatMap((game) => game.local_account_labels ?? [])).size, [games]);
  const download = selectedAppId ? downloads[selectedAppId] : undefined;''',
    "selected game ids",
)

text = replace_once(
    text,
    '''  const markActivity = () => {
    setShowcaseMode(false);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setFocusZone("grid");
      setShowcaseMode(true);
    }, 30_000);
  };''',
    '''  const markActivity = useCallback(() => {
    setShowcaseMode(false);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setFocusZone("grid");
      setShowcaseMode(true);
    }, 30_000);
  }, []);''',
    "activity callback",
)

text = replace_once(text, '  }, []);\n\n  useEffect(() => {\n    if (!showcaseMode)', '  }, [markActivity]);\n\n  useEffect(() => {\n    if (!showcaseMode)', "mount effect dependency")

text = replace_once(
    text,
    '''  useEffect(() => {
    if (!showcaseMode || games.length < 2) return;
    // Give each game time to breathe: video entries stay about 1m50s; still images 1m30s.
    const holdMs = videoSrc ? 110_000 : 90_000;''',
    '''  useEffect(() => {
    if (!showcaseMode || games.length < 2 || selectedGameId == null) return;
    // Give each game time to breathe: video entries stay about 1m50s; still images 1m30s.
    const holdMs = videoSrc ? 110_000 : 90_000;''',
    "showcase guard",
)
text = replace_once(
    text,
    '  }, [showcaseMode, games.length, selectedGame?.id, videoSrc]);',
    '  }, [showcaseMode, games.length, selectedGameId, videoSrc]);',
    "showcase dependencies",
)

text = replace_once(
    text,
    '''

  useEffect(() => {
    setVideoReady(false);
  }, [videoSrc]);

  useEffect(() => {''',
    '''

  useEffect(() => {''',
    "remove video reset effect",
)
text = replace_once(text, '  }, [videoVolume, videoMuted, videoSrc]);', '  }, [videoVolume, videoMuted]);', "volume dependencies")

text = replace_once(
    text,
    '''  useEffect(() => {
    const grid = gridRef.current;''',
    '''  useEffect(() => {
    if (!games.length) return;
    const grid = gridRef.current;''',
    "grid observer dependency capture",
)

text = replace_once(
    text,
    '''  useEffect(() => {
    if (!selectedGame) return;
    let cancelled = false;
    setDetails(null);
    setLoadingDetails(true);
    loadDetails(selectedGame.id)''',
    '''  useEffect(() => {
    if (selectedGameId == null) return;
    let cancelled = false;
    setDetails(null);
    setLoadingDetails(true);
    loadDetails(selectedGameId)''',
    "details selected id",
)
text = replace_once(text, '  }, [selectedGame?.id]);', '  }, [selectedGameId]);', "details dependencies")

text = replace_once(
    text,
    '''  useEffect(() => {
    if (!selectedGame) return;
    if (installed) setActionIndex(0);
    else if (selectedGame.app_id) setActionIndex(1);
    else setActionIndex(2);
  }, [selectedGame?.id, installed]);''',
    '''  useEffect(() => {
    if (selectedGameId == null) return;
    if (installed) setActionIndex(0);
    else if (selectedAppId) setActionIndex(1);
    else setActionIndex(2);
  }, [selectedGameId, selectedAppId, installed]);''',
    "action selection dependencies",
)

text = replace_once(
    text,
    'className={`library-room-video ${videoReady ? "is-ready" : ""}`}',
    'className={`library-room-video ${readyVideoSrc === videoSrc ? "is-ready" : ""}`}',
    "video ready class",
)
text = replace_once(
    text,
    'onCanPlay={(event) => { setVideoReady(true); void event.currentTarget.play().catch(() => undefined); }}',
    'onCanPlay={(event) => { setReadyVideoSrc(videoSrc ?? null); void event.currentTarget.play().catch(() => undefined); }}',
    "video can play state",
)

text = replace_once(
    text,
    '<div className="library-room-actions" aria-label="Acciones del juego seleccionado">',
    '<div className="library-room-actions" role="group" aria-label="Acciones del juego seleccionado">',
    "actions aria role",
)

text = replace_once(
    text,
    '''              <button
                key={action.label}''',
    '''              <button
                type="button"
                key={action.label}''',
    "action button type",
)
text = replace_once(
    text,
    '''            <button
              key={game.id}''',
    '''            <button
              type="button"
              key={game.id}''',
    "card button type",
)

path.write_text(text, encoding="utf-8")
