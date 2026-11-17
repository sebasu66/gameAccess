import { describe, expect, it } from "vitest";
import { queueTransition, transitionsBusy } from "./transitions";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("cola de transiciones", () => {
  it("corre una transición después de la otra, nunca encimadas, en el orden en que se pidieron", async () => {
    const events: string[] = [];
    const step = (name: string, ms: number) => async () => { events.push(`${name}:start`); await wait(ms); events.push(`${name}:end`); };
    const all = [queueTransition(step("a", 30)), queueTransition(step("b", 5)), queueTransition(step("c", 10))];
    expect(transitionsBusy()).toBe(true);
    await Promise.all(all);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
    expect(transitionsBusy()).toBe(false);
  });

  it("un paso que falla o no anima nada no frena la cola", async () => {
    const events: string[] = [];
    await Promise.all([
      queueTransition(() => { throw new Error("roto"); }),
      queueTransition(() => { events.push("nada"); }),
      queueTransition(async () => { events.push("sigue"); }),
    ]);
    expect(events).toEqual(["nada", "sigue"]);
  });
});
