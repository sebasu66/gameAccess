export type DetailMediaPhase = "video" | "image";

export interface DetailMediaSequenceInput {
  videoSrc?: string;
  images: string[];
  reducedMotion?: boolean;
}

export interface DetailMediaSequenceState {
  phase: DetailMediaPhase;
  imageIndex: number;
  videoAvailable: boolean;
  images: string[];
}

export function normalizeDetailImages(images: Array<string | null | undefined>): string[] {
  return [...new Set(images.filter((value): value is string => Boolean(value)))];
}

export function createDetailMediaSequence(input: DetailMediaSequenceInput): DetailMediaSequenceState {
  const images = normalizeDetailImages(input.images);
  const videoAvailable = Boolean(input.videoSrc);
  return {
    phase: input.reducedMotion || !videoAvailable ? "image" : "video",
    imageIndex: 0,
    videoAvailable,
    images,
  };
}

export function afterDetailVideo(state: DetailMediaSequenceState): DetailMediaSequenceState {
  if (state.images.length) return { ...state, phase: "image", imageIndex: 0 };
  return { ...state, phase: "video" };
}

export function afterDetailImage(state: DetailMediaSequenceState): DetailMediaSequenceState {
  if (!state.images.length) return state.videoAvailable ? { ...state, phase: "video" } : state;
  const nextIndex = state.imageIndex + 1;
  if (nextIndex < state.images.length) return { ...state, phase: "image", imageIndex: nextIndex };
  if (state.videoAvailable) return { ...state, phase: "video", imageIndex: 0 };
  return { ...state, phase: "image", imageIndex: 0 };
}

export function disableDetailVideo(state: DetailMediaSequenceState): DetailMediaSequenceState {
  return {
    ...state,
    videoAvailable: false,
    phase: "image",
    imageIndex: Math.min(state.imageIndex, Math.max(0, state.images.length - 1)),
  };
}

export function removeFailedDetailImage(state: DetailMediaSequenceState, failedUrl: string): DetailMediaSequenceState {
  const images = state.images.filter((image) => image !== failedUrl);
  if (!images.length) {
    return {
      ...state,
      images,
      imageIndex: 0,
      phase: state.videoAvailable ? "video" : "image",
    };
  }
  return {
    ...state,
    images,
    imageIndex: Math.min(state.imageIndex, images.length - 1),
  };
}
