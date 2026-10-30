import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "./native";
import { translate } from "./i18n";
import { confirmNotice, showNotice } from "./notice/notice";
import { AdminRequiredError, requireAdmin } from "./accessRole";

/**
 * The block dialog's "Yes" (restrictor.rs, Seba 2026-10-30): something stays blocked that the family uses, and going
 * through the parental control screen every time would be a nuisance. Windows' dialog opens Game Access with the
 * program; here it asks to confirm, the gate asks for the parent's key, and kid mode's service adds the program's
 * folder to the allowed programs (it checks the key itself). Game Access opens only because the parent chose "Yes".
 */
async function allow(path: string) {
  const name = path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || path;
  const ok = await confirmNotice({ title: translate("allowBlockedTitle", { name }), text: translate("allowBlockedText", { path }),
    confirmLabel: translate("kidAllow"), cancelLabel: translate("noticeCancel"), kind: "primary" });
  if (!ok) return;
  try {
    await requireAdmin();
    await invoke("restriction_allow", { path });
    showNotice({ tone: "ok", title: translate("allowBlockedDone", { name }) });
  } catch (error) {
    if (error instanceof AdminRequiredError) return;
    showNotice({ tone: "error", title: translate("allowBlockedFailed", { name }), text: String(error) });
  }
}

export function startAllowFromBlock(): void {
  if (!hasTauriRuntime()) return;
  const take = () => { void invoke<string | null>("restriction_take_allow").then(path => { if (path) void allow(path); }).catch(() => undefined); };
  take();
  void listen("gameaccess:allow-program", take);
}
