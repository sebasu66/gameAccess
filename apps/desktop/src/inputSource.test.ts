import { describe, expect, it } from "vitest";
import { GamepadInput } from "./gamepadInput";
import { InputSourceArbiter } from "./inputSource";

const pad = (down: number[] = [], axes: number[] = [0, 0]) => ({
  buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: down.includes(index), touched: false, value: 0 })),
  axes,
}) as unknown as Pick<Gamepad, "buttons" | "axes">;

describe("single input source", () => {
  it("starts on the keyboard and follows the last fresh press", () => {
    const arbiter = new InputSourceArbiter();
    expect(arbiter.allows("keyboard")).toBe(true);
    arbiter.claim("pad");
    expect(arbiter.allows("pad")).toBe(true);
    expect(arbiter.allows("keyboard")).toBe(false);
    arbiter.claim("keyboard");
    expect(arbiter.allows("pad")).toBe(false);
  });

  it("marks only the first read of a held direction as fresh, so repeats cannot take over", () => {
    const input = new GamepadInput();
    input.read(pad([15]), 0);
    expect(input.fresh.has("right")).toBe(true);
    const repeated = input.read(pad([15]), 400);
    expect(repeated).toEqual(["right"]);
    expect(input.fresh.size).toBe(0);
    input.read(pad(), 500);
    input.read(pad([15]), 600);
    expect(input.fresh.has("right")).toBe(true);
  });
});
