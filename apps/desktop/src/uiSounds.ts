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

/** Quiet two-part bell, synthesized locally; no network or optional asset. */
export function playCatalogBell() {
  try {
    const context = new AudioContext();
    void context.resume().then(() => {
      const now = context.currentTime;
      [1046.5, 1568].forEach((frequency, index) => {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const start = now + index * .08;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(index ? .025 : .045, start + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .75);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start); oscillator.stop(start + .8);
      });
      window.setTimeout(() => void context.close(), 1100);
    }).catch(() => void context.close());
  } catch { /* Notifications remain visible if audio is unavailable. */ }
}
