export type OpeningStage = "intro" | "holding" | "validation" | "docking" | "ready";
export function openingStage(input: { introReady: boolean; verificationReady: boolean; approved: boolean; docked: boolean }): OpeningStage {
 if (!input.introReady) return "intro";
 if (!input.verificationReady) return "holding";
 if (!input.approved) return "validation";
 return input.docked ? "ready" : "docking";
}
