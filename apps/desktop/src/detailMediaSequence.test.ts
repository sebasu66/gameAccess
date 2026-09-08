import { describe, expect, it } from "vitest";

import {
  afterDetailImage,
  afterDetailVideo,
  createDetailMediaSequence,
  disableDetailVideo,
  removeFailedDetailImage,
} from "./detailMediaSequence";

describe("desktop detail media sequence", () => {
  it("runs trailer then screenshots then returns to trailer", () => {
    let state = createDetailMediaSequence({ videoSrc: "trailer.mp4", images: ["one.jpg", "two.jpg"] });
    expect(state.phase).toBe("video");
    state = afterDetailVideo(state);
    expect(state).toMatchObject({ phase: "image", imageIndex: 0 });
    state = afterDetailImage(state);
    expect(state).toMatchObject({ phase: "image", imageIndex: 1 });
    state = afterDetailImage(state);
    expect(state).toMatchObject({ phase: "video", imageIndex: 0 });
  });

  it("loops screenshots when there is no trailer", () => {
    let state = createDetailMediaSequence({ images: ["one.jpg", "two.jpg"] });
    state = afterDetailImage(state);
    state = afterDetailImage(state);
    expect(state).toMatchObject({ phase: "image", imageIndex: 0, videoAvailable: false });
  });

  it("falls back to screenshots after a failed trailer", () => {
    const state = disableDetailVideo(createDetailMediaSequence({ videoSrc: "bad.mp4", images: ["one.jpg"] }));
    expect(state).toMatchObject({ phase: "image", imageIndex: 0, videoAvailable: false });
  });

  it("removes a failed screenshot without leaving an invalid index", () => {
    const state = removeFailedDetailImage(
      { phase: "image", imageIndex: 1, videoAvailable: false, images: ["one.jpg", "bad.jpg"] },
      "bad.jpg",
    );
    expect(state).toEqual({ phase: "image", imageIndex: 0, videoAvailable: false, images: ["one.jpg"] });
  });

  it("starts static when reduced motion is requested", () => {
    const state = createDetailMediaSequence({ videoSrc: "trailer.mp4", images: ["one.jpg"], reducedMotion: true });
    expect(state.phase).toBe("image");
  });
});
