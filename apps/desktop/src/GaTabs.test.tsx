// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import GaTabs from "./GaTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<GaTabs label="Demo" tabs={[
      { id: "a", label: "Uno", content: <p>contenido uno</p> },
      { id: "b", label: "Dos", content: <p>contenido dos</p> },
      { id: "c", label: "Tres", content: <p>contenido tres</p> },
    ]} />);
  });
  return host;
}

afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); root = null; host = null; });

describe("GaTabs", () => {
  it("shows one section at a time and starts on the first tab", () => {
    const view = mount();
    const tabs = [...view.querySelectorAll<HTMLElement>("[role=tab]")];
    expect(tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(view.querySelector("[role=tabpanel]")!.textContent).toBe("contenido uno");
  });

  it("switches on click and gives each selector its own colour slot", () => {
    const view = mount();
    const tabs = [...view.querySelectorAll<HTMLElement>("[role=tab]")];
    act(() => { tabs[1].click(); });
    expect(view.querySelector("[role=tabpanel]")!.textContent).toBe("contenido dos");
    expect(tabs.map(tab => tab.dataset.tabIndex)).toEqual(["0", "1", "2"]);
  });

  it("moves with the arrow keys and wraps around", () => {
    const view = mount();
    const tabs = () => [...view.querySelectorAll<HTMLElement>("[role=tab]")];
    act(() => { tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(view.querySelector("[role=tabpanel]")!.textContent).toBe("contenido tres");
    act(() => { tabs()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(view.querySelector("[role=tabpanel]")!.textContent).toBe("contenido uno");
  });
});
