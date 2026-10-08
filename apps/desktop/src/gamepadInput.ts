export type PadAction = "left" | "right" | "up" | "down" | "accept" | "back" | "search" | "filters" | "library" | "catalog" | "toggle" | "pageup" | "pagedown";
/** Standard Gamepad API layout; dead zone rejects stick drift. Buttons fire on
 * press edges; directions repeat after 350ms, then every 150ms. */
export class GamepadInput {
  private previous = new Set<PadAction>();
  private repeatAt = new Map<PadAction, number>();
  reset() { this.previous.clear(); this.repeatAt.clear(); }
  read(pad: Pick<Gamepad, "buttons" | "axes">, now: number): PadAction[] {
    const held = new Set<PadAction>();
    const mappings: [number, PadAction][] = [[0,"accept"],[1,"back"],[2,"search"],[3,"filters"],[4,"library"],[5,"catalog"],[6,"pageup"],[7,"pagedown"],[9,"toggle"],[12,"up"],[13,"down"],[14,"left"],[15,"right"]];
    for (const [index, action] of mappings) if (pad.buttons[index]?.pressed) held.add(action);
    const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) > .55) held.add(Math.abs(x) >= Math.abs(y) ? x < 0 ? "left" : "right" : y < 0 ? "up" : "down");
    const actions: PadAction[] = [];
    for (const action of held) {
      if (!this.previous.has(action)) { actions.push(action); this.repeatAt.set(action, now + 350); }
      else if (["left","right","up","down","pageup","pagedown"].includes(action) && now >= (this.repeatAt.get(action) ?? Infinity)) { actions.push(action); this.repeatAt.set(action, now + 150); }
    }
    for (const action of this.previous) if (!held.has(action)) this.repeatAt.delete(action);
    this.previous = held;
    return actions;
  }
}
