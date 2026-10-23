/**
 * Modes that are implemented but not ready to run.
 *
 * A flag lives here instead of a commented-out block so the code stays wired and
 * testable, and switching it back on is one edit. Nothing is deleted while a mode
 * is off, so it does not rot.
 */

/**
 * The featured-game hero rotates through the top games and autoplays its trailer.
 *
 * Turned off because the implementation is not good enough yet: rotating every 18
 * seconds moves the page under the user, and starting a video on launch competes
 * with whatever they came to do.
 *
 * With it off the hero still shows the top game, statically — the layout, its
 * artwork and its controls all remain, only the automatic advance and the
 * automatic playback stop. Set to `true` to bring the rotation back.
 */
export const HERO_AUTOPLAY = false;
