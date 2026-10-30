import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./native";
import { translate } from "./i18n";
import { hideNotice, showNotice } from "./notice/notice";
import type { RestrictionBlock } from "./kidMode";

/** A block this recent when Game Access starts is shown: the restrictor opened Game Access to say it. */
const FRESH_MS = 20_000;
const POLL_MS = 2000;

/** The notice for one block: a game goes to the library, a program to the allowed programs. */
export function blockNotice(block: RestrictionBlock) {
  return block.game
    ? { title: translate("blockedGameTitle"), text: translate("blockedGameText", { name: block.name }) }
    : { title: translate("blockedProgramTitle"), text: translate("blockedProgramText", { name: block.name }) };
}

/**
 * Kid mode's restrictor (restrictor.rs) closed something: Game Access says so with the single notice, with the program's
 * name and what an adult has to do. The restrictor writes the last block to a file and opens Game Access when it was
 * not running; this reads that file every couple of seconds and shows each new block once.
 */
export function startRestrictionNotices(): () => void {
  if (!hasTauriRuntime()) return () => undefined;
  let seen = Date.now() - FRESH_MS;
  const check = async () => {
    const block = await invoke<RestrictionBlock | null>("restriction_notice").catch(() => null);
    if (!block || block.at <= seen) return;
    seen = block.at;
    const { title, text } = blockNotice(block);
    const id = showNotice({ tone: "danger", title, text, actions: [{ label: translate("close"), kind: "secondary", run: () => hideNotice(id) }] });
  };
  void check();
  const timer = window.setInterval(() => void check(), POLL_MS);
  return () => window.clearInterval(timer);
}
