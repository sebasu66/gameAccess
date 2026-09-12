from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "main.rs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> int:
    text = MAIN.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "mod download_lifecycle;\n",
        "mod automation;\nmod download_lifecycle;\n",
        "automation module declaration",
    )
    text = replace_once(
        text,
        "fn main() {\n    let visual_debug_dir = visual_debug_session_dir();\n    tauri::Builder::default()\n        .manage(VisualDebugState {\n",
        "fn main() {\n    let visual_debug_dir = visual_debug_session_dir();\n    let automation_state = automation::AutomationState::from_process();\n    tauri::Builder::default()\n        .manage(automation_state)\n        .manage(VisualDebugState {\n",
        "automation state registration",
    )
    text = replace_once(
        text,
        "        .invoke_handler(tauri::generate_handler![\n            narration_log_path,\n",
        "        .invoke_handler(tauri::generate_handler![\n            automation::automation_config,\n            automation::capture_automation_screenshot,\n            automation::finish_automation,\n            narration_log_path,\n",
        "automation command registration",
    )
    MAIN.write_text(text, encoding="utf-8")
    print(f"Patched {MAIN}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
