/**
 * Common programs the kids screen always lists (Seba, 2026-10-30): browsers, AI assistants, chat and everyday tools.
 * They start on, so nothing the family uses stops working, and they are always shown, installed or not, so the parent
 * remembers they are there and can turn any off. The restrictor (restrictor.rs) recognises each one by its executable
 * and checks its properties (`marks`: words its product, description or company holds), so a game renamed after one
 * does not pass; turned off, it is closed even when it is Windows' own (Notepad, Edge, the Store). Claude is not here: its
 * desktop app and Claude Code share `claude.exe`, and Claude Code always runs (restrictor.rs).
 */
export type KnownProgramGroup = "browser" | "ai" | "chat" | "tool";
export interface KnownProgram { name: string; group: KnownProgramGroup; exes: string[]; marks: string[] }

export const KNOWN_PROGRAMS: KnownProgram[] = [
  { name: "Google Chrome", group: "browser", exes: ["chrome.exe"], marks: ["google chrome"] },
  { name: "Microsoft Edge", group: "browser", exes: ["msedge.exe"], marks: ["microsoft edge"] },
  { name: "Mozilla Firefox", group: "browser", exes: ["firefox.exe"], marks: ["firefox"] },
  { name: "Brave", group: "browser", exes: ["brave.exe"], marks: ["brave"] },
  { name: "Opera", group: "browser", exes: ["opera.exe"], marks: ["opera"] },
  { name: "Vivaldi", group: "browser", exes: ["vivaldi.exe"], marks: ["vivaldi"] },
  { name: "DuckDuckGo", group: "browser", exes: ["DuckDuckGo.exe"], marks: ["duckduckgo"] },
  { name: "ChatGPT", group: "ai", exes: ["ChatGPT.exe"], marks: ["chatgpt", "openai"] },
  { name: "Grok", group: "ai", exes: ["Grok.exe"], marks: ["grok", "xai"] },
  { name: "Discord", group: "chat", exes: ["Discord.exe"], marks: ["discord"] },
  { name: "WhatsApp", group: "chat", exes: ["WhatsApp.exe", "WhatsApp.Root.exe"], marks: ["whatsapp"] },
  { name: "Telegram", group: "chat", exes: ["Telegram.exe"], marks: ["telegram"] },
  { name: "Zoom", group: "chat", exes: ["Zoom.exe"], marks: ["zoom"] },
  { name: "Microsoft Teams", group: "chat", exes: ["ms-teams.exe", "Teams.exe"], marks: ["teams"] },
  { name: "Microsoft Store", group: "tool", exes: ["WinStore.App.exe"], marks: ["store", "tienda"] },
  { name: "Visual Studio Code", group: "tool", exes: ["Code.exe"], marks: ["visual studio code"] },
  { name: "Antigravity", group: "tool", exes: ["Antigravity.exe"], marks: ["antigravity"] },
  { name: "Bloc de notas / Notepad", group: "tool", exes: ["notepad.exe"], marks: ["bloc de notas", "notepad"] },
  { name: "Notepad++", group: "tool", exes: ["notepad++.exe"], marks: ["notepad++"] },
  { name: "JDownloader", group: "tool", exes: ["JDownloader2.exe"], marks: ["jdownloader"] },
  { name: "Spotify", group: "tool", exes: ["Spotify.exe"], marks: ["spotify"] },
  { name: "VLC", group: "tool", exes: ["vlc.exe"], marks: ["vlc"] },
];

export interface KnownExe { exe: string; marks: string[] }

/** What the restrictor gets for the common programs: the ones left on and the ones turned off (`off`: their names). */
export function knownExes(off: string[]): { allowedExes: KnownExe[]; blockedExes: KnownExe[] } {
  const toExes = (list: KnownProgram[]) => list.flatMap(program => program.exes.map(exe => ({ exe, marks: program.marks })));
  return { allowedExes: toExes(KNOWN_PROGRAMS.filter(program => !off.includes(program.name))), blockedExes: toExes(KNOWN_PROGRAMS.filter(program => off.includes(program.name))) };
}
