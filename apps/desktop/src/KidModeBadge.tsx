import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Baby } from "lucide-react";
import { useI18n } from "./i18n";
import { hasTauriRuntime } from "./native";
import { useAccessRole } from "./accessRole";
import { useKidAssigned } from "./kidMode";
import "./kid-mode.css";

/** How often Game Access in parent mode tells kid mode's restrictor that the parent is here (it pauses for a minute). */
const PARENT_EVERY_MS = 30_000;

/**
 * While kid mode is on (the big switch, restrictor.rs), a child's face in the top right corner of the frame says so: the
 * library shows only the child's games and the rest of the PC is closed. In parent mode the restrictor pauses (Seba,
 * 2026-10-30): Game Access says every 30 s that the parent is here, and the face is dimmed; leaving parent mode says
 * it at once, and closing Game Access or the 5 idle minutes let the pause run out within a minute. Information only.
 */
export default function KidModeBadge() {
  const { t } = useI18n();
  const on = useKidAssigned() !== null;
  const parent = useAccessRole() === "admin";
  // Back in the player's mode Game Access no longer holds the parent's key (kid mode's service asks for it).
  useEffect(() => { if (!parent && hasTauriRuntime()) void invoke("admin_key_forget").catch(() => undefined); }, [parent]);
  useEffect(() => {
    if (!on || !hasTauriRuntime()) return undefined;
    const say = (present: boolean) => { void invoke("restriction_parent", { present }).catch(() => undefined); };
    if (!parent) { say(false); return undefined; }
    say(true);
    const timer = window.setInterval(() => say(true), PARENT_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [on, parent]);
  if (!on) return null;
  const label = parent ? t("kidPausedBadge") : t("kidRestrictedBadge");
  return <span className={`ga-kid-badge${parent ? " is-paused" : ""}`} role="status" aria-label={label} title={label}><Baby size={20} aria-hidden="true" /></span>;
}
