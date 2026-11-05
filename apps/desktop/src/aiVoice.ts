import { useEffect, useState } from "react";
import { getAppLocale } from "./i18n";

/**
 * Gemma's voice (Seba, 2026-11-05): the AI panels read their text aloud with the WebView's speech (speechSynthesis),
 * which offers the voices installed in Windows. The player picks one (or leaves the best one found, pickVoice) and
 * whether answers are read on their own or only with the button.
 */
export interface VoiceSettings { voice: string; auto: boolean }
const SETTINGS_KEY = "gameaccess:ai-voice";
const DEFAULTS: VoiceSettings = { voice: "", auto: false };
export function loadVoiceSettings(): VoiceSettings {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") as Partial<VoiceSettings> | null) }; }
  catch { return DEFAULTS; }
}
export function saveVoiceSettings(settings: VoiceSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* the defaults keep working */ }
}

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
  const voices = synth.getVoices();
  const chosen = loadVoiceSettings().voice;
  const voice = voices.find(item => item.name === chosen) ?? pickVoice(voices);
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

/** The voices of the app's language; Windows hands them over a moment after the page opens. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!voiceAvailable()) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices().filter(voice => voice.lang.toLowerCase().startsWith(getAppLocale() === "es" ? "es" : "en")));
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
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
