import { describe, expect, it } from "vitest";

import { afterDetailImage, afterDetailVideo, createDetailMediaSequence } from "./detailMediaSequence";

describe("Stage 2 desktop detail handoff", () => {
  it("cycles trailer to screenshots and back without a maximize condition", () => {
    let state = createDetailMediaSequence({ videoSrc: "movie.mp4", images: ["a.jpg", "b.jpg"] });
    state = afterDetailVideo(state);
    expect(state).toMatchObject({ phase: "image", imageIndex: 0 });
    state = afterDetailImage(afterDetailImage(state));
    expect(state.phase).toBe("video");
  });
});
