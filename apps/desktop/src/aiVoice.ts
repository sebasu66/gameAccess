import { useEffect, useState } from "react";
import { getAppLocale } from "./i18n";

/**
 * Gemma's voice (Seba, 2026-11-04): the AI panels read their text aloud with the WebView's own speech
 * (speechSynthesis), so no library and almost no work for the PC. It prefers Edge's online natural voices when the
 * WebView offers them, then a voice of the app's language and country (es-AR first), then any of the language.
 * A cloud voice (edge-tts style) can replace `pickVoice` later without touching the panels.
 */
export const voiceAvailable = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function pickVoice(voices: SpeechSynthesisVoice[], locale = getAppLocale()): SpeechSynthesisVoice | null {
  const lang = locale === "es" ? "es" : "en";
  const country = locale === "es" ? ["es-AR", "es-MX", "es-US", "es-ES"] : ["en-US", "en-GB"];
  const ofLang = voices.filter(voice => voice.lang.toLowerCase().startsWith(lang));
  const rank = (voice: SpeechSynthesisVoice) => {
    const natural = /natural|online/i.test(voice.name) ? 0 : 10;
    const place = country.findIndex(code => voice.lang.toLowerCase() === code.toLowerCase());
    const female = /female|mujer|elena|helena|sabina|paloma|dalia|tomas|aria|jenny|zira/i.test(voice.name) ? 0 : 1;
    return natural + (place < 0 ? country.length : place) + female * .5;
  };
  return [...ofLang].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

let speaking: string | null = null;
const listeners = new Set<() => void>();
const publish = (value: string | null) => { speaking = value; listeners.forEach(listener => listener()); };

export function speak(text: string): void {
  if (!voiceAvailable() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(synth.getVoices());
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else utterance.lang = getAppLocale() === "es" ? "es-AR" : "en-US";
  utterance.rate = 1.02;
  utterance.onend = utterance.onerror = () => { if (speaking === text) publish(null); };
  publish(text);
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (voiceAvailable()) window.speechSynthesis.cancel();
  publish(null);
}

/** Whether this text is being read now; reading stops when the panel goes away. */
export function useSpeaking(text: string): boolean {
  const [now, setNow] = useState(speaking === text);
  useEffect(() => {
    const update = () => setNow(speaking === text);
    listeners.add(update);
    update();
    return () => { listeners.delete(update); if (speaking === text) stopSpeaking(); };
  }, [text]);
  return now;
}
