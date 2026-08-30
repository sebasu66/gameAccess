export type UiSoundKind = "move" | "activate";

const SOUND_FILES: Record<UiSoundKind, string> = {
  move: "/sounds/library-move.mp3",
  activate: "/sounds/library-activate.mp3",
};

const VOLUME: Record<UiSoundKind, number> = { move: 0.48, activate: 0.68 };

export function playUiSound(kind: UiSoundKind) {
  if (typeof Audio === "undefined") return;
  try {
    // A new element intentionally retries the path: dropping the file into public/sounds
    // while the dev app is running makes the next interaction pick it up automatically.
    const audio = new Audio(SOUND_FILES[kind]);
    audio.volume = VOLUME[kind];
    audio.preload = "auto";
    void audio.play().catch(() => undefined);
  } catch {
    // Missing optional sound assets must never affect navigation.
  }
}
