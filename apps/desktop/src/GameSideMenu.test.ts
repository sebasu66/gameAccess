import { describe, expect, it } from "vitest";
import { menuHoldArea } from "./GameSideMenu";

describe("the area that keeps a card's menu open", () => {
  it("is the card and the menu beside it, a tenth of the card's height taller each way (Seba's 50 x 100 card)", () => {
    const card = { left: 0, top: 0, right: 50, bottom: 100 };
    const menu = { left: 50, top: 20, right: 100, bottom: 80 };
    expect(menuHoldArea(card, menu)).toEqual({ left: 0, right: 100, top: -10, bottom: 110 });
  });

  it("grows with a menu taller than the card, and works before the menu is measured", () => {
    const card = { left: 100, top: 100, right: 150, bottom: 200 };
    expect(menuHoldArea(card, { left: 40, top: 80, right: 100, bottom: 230 })).toEqual({ left: 40, right: 150, top: 70, bottom: 240 });
    expect(menuHoldArea(card, null)).toEqual({ left: 100, right: 150, top: 90, bottom: 210 });
  });
});
