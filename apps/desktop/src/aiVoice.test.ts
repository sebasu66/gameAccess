import { describe, expect, it } from "vitest";
import { pickVoice } from "./aiVoice";

const voice = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;

describe("Gemma's voice", () => {
  it("prefers an online natural voice of the app's language, then the country", () => {
    const voices = [voice("Microsoft Helena - Spanish (Spain)", "es-ES"), voice("Microsoft Elena Online (Natural) - Spanish (Argentina)", "es-AR"), voice("Microsoft Zira", "en-US")];
    expect(pickVoice(voices, "es")?.lang).toBe("es-AR");
    expect(pickVoice(voices.slice(0, 1), "es")?.lang).toBe("es-ES");
    expect(pickVoice(voices, "en")?.name).toBe("Microsoft Zira");
    expect(pickVoice([voice("Zira", "en-US")], "es")).toBeNull();
  });
});
