// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LOGO_SETTLED_EVENT, useOpeningSettled } from "./openingSettled";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() { return <span>{useOpeningSettled() ? "ready" : "waiting"}</span>; }

describe("the central dialog waits for the opening", () => {
  it("is held while the logo plays and shown once it has settled; a replay holds it again", async () => {
    document.body.classList.add("ga-splash-active");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<Probe />); });
    expect(host.textContent).toBe("waiting");
    await act(async () => {
      document.body.classList.remove("ga-splash-active");
      window.dispatchEvent(new Event(LOGO_SETTLED_EVENT));
    });
    expect(host.textContent).toBe("ready");
    await act(async () => { document.body.classList.add("ga-splash-active"); });
    expect(host.textContent).toBe("waiting");
    act(() => root.unmount());
  });
});
