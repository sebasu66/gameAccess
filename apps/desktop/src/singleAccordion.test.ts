// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { startSingleAccordion } from "./singleAccordion";

const toggle = (item: HTMLDetailsElement) => { item.open = !item.open; item.dispatchEvent(new Event("toggle")); };

describe("un acordeón abierto a la vez", () => {
  let stop = () => {};
  afterEach(() => { stop(); document.body.innerHTML = ""; });

  it("al abrir uno se cierran los otros del mismo grupo, no los de otro grupo", () => {
    stop = startSingleAccordion();
    document.body.innerHTML = `<div id="a"><details></details><details></details><details></details></div><div id="b"><details open></details></div>`;
    const [first, second] = document.querySelectorAll<HTMLDetailsElement>("#a details");
    toggle(first);
    toggle(second);
    expect([...document.querySelectorAll<HTMLDetailsElement>("#a details")].map(item => item.open)).toEqual([false, true, false]);
    expect(document.querySelector<HTMLDetailsElement>("#b details")!.open).toBe(true);
  });

  it("un grupo marcado multi deja abrir varios", () => {
    stop = startSingleAccordion();
    document.body.innerHTML = `<div data-accordion="multi"><details></details><details></details></div>`;
    const [first, second] = document.querySelectorAll<HTMLDetailsElement>("details");
    toggle(first); toggle(second);
    expect(first.open && second.open).toBe(true);
  });
});
