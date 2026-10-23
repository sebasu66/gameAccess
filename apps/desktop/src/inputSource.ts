export type InputSource = "keyboard" | "pad";

/** Only one input source drives the interface at a time. The last source that
 * produced a fresh input owns it; the other is ignored until it is used again,
 * so a drifting stick or a held phantom button cannot fight the keyboard. */
export class InputSourceArbiter {
  private current: InputSource = "keyboard";
  get active(): InputSource { return this.current; }
  /** A fresh press (not an auto-repeat) hands the interface to `source`. */
  claim(source: InputSource): void { this.current = source; }
  /** Auto-repeats and held state only count for the owner. */
  allows(source: InputSource): boolean { return this.current === source; }
}
