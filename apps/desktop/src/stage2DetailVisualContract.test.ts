import { describe, expect, it } from "vitest";

import { afterDetailImage, afterDetailVideo, createDetailMediaSequence } from "./detailMediaSequence";
import { shouldLoadSelectedDetails } from "./useSelectedGameDetails";

describe("Stage 2 desktop detail handoff", () => {
  it("loads the game already displayed on desktop startup", () => {
    expect(shouldLoadSelectedDetails({ surface: "desktop", selectedGameId: 7, detailRequestedGameId: null, tabletDetailsOpen: false })).toBe(true);
  });

  it("cycles trailer to screenshots and back without a maximize condition", () => {
    let state = createDetailMediaSequence({ videoSrc: "movie.mp4", images: ["a.jpg", "b.jpg"] });
    state = afterDetailVideo(state);
    expect(state).toMatchObject({ phase: "image", imageIndex: 0 });
    state = afterDetailImage(afterDetailImage(state));
    expect(state.phase).toBe("video");
  });
});
