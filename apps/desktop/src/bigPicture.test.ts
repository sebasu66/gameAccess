import { describe, expect, it, vi } from "vitest";
import { bigPictureActive, bigPictureView, controllerConnected, cycleBigPictureOrder, matchesSearch, searchAppliesNow, setBigPictureActive, setBigPictureOrder, setBigPictureQuery } from "./bigPicture";
import { bigPictureGroups, nameGroup } from "./bentoLayout";
import { closeAllPanels, deskOpen, openPanel } from "./desk/desk";

const pad = { connected: true } as Gamepad;

describe("big picture mode", () => {
  it("sees a controller (it starts in controller mode): the webview's list first, then Windows in the app", async () => {
    expect(await controllerConnected({ native: false, ask: async () => 1, pads: () => [] })).toBe(false);
    expect(await controllerConnected({ native: false, ask: async () => 0, pads: () => [null, pad] })).toBe(true);
    const ask = vi.fn(async () => 1);
    expect(await controllerConnected({ native: true, ask, pads: () => [] })).toBe(true);
    expect(await controllerConnected({ native: true, ask: async () => 0, pads: () => [] })).toBe(false);
    expect(await controllerConnected({ native: true, ask: async () => { throw new Error("no command"); }, pads: () => [] })).toBe(false);
  });

  it("keeps the side panels closed while it is on", () => {
    closeAllPanels();
    setBigPictureActive(true);
    openPanel("downloads");
    expect(deskOpen()).toEqual([]);
    setBigPictureActive(false);
    expect(bigPictureActive()).toBe(false);
    openPanel("downloads");
    expect(deskOpen()).toEqual(["downloads"]);
    closeAllPanels();
  });

  it("searches by every word, without accents, case or symbols", () => {
    expect(matchesSearch("Pokémon: Edición Oro", "pokemon oro")).toBe(true);
    expect(matchesSearch("Hollow Knight", "knight hol")).toBe(true);
    expect(matchesSearch("Hades", "hx")).toBe(false);
    expect(matchesSearch("Hades", "  ")).toBe(true);
  });

  it("filters as typed from two characters; with one, it waits", () => {
    expect(searchAppliesNow("h")).toBe(false);
    expect(searchAppliesNow("ha")).toBe(true);
    expect(searchAppliesNow("")).toBe(true);
  });

  it("cycles the orders and forgets the search when the mode ends", () => {
    setBigPictureOrder("recent");
    cycleBigPictureOrder(1);
    expect(bigPictureView().order).toBe("name");
    cycleBigPictureOrder(-1);
    cycleBigPictureOrder(-1);
    expect(bigPictureView().order).toBe("genre");
    setBigPictureActive(true);
    setBigPictureQuery("zelda");
    setBigPictureActive(false);
    expect(bigPictureView().query).toBe("");
    setBigPictureOrder("recent");
  });

  it("groups by letter and lays each group under its title", () => {
    expect(["Ábzu", "7 Days", "hades"].map(nameGroup)).toEqual(["A", "#", "H"]);
    const { placements, tracks, marks } = bigPictureGroups([{ title: "A", values: [1, 2, 3] }, { title: "B", values: [] }, { title: "C", values: [4] }], 2);
    expect(marks).toEqual([{ title: "A", row: 1, count: 3 }, { title: "C", row: 8, count: 1 }]);
    expect(placements.map(item => [item.value, item.column, item.row])).toEqual([[1, 1, 2], [2, 2, 2], [3, 1, 5], [4, 1, 9]]);
    expect(tracks.filter(track => track === "label")).toHaveLength(2);
    expect(tracks).toHaveLength(11);
  });
});
