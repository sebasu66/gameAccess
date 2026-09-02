class_name ConfiguraBridge
extends RefCounted

const APPLIER_PATH := "res://addons/Configura/character_state_applier.gd"

static func is_available() -> bool:
    return ResourceLoader.exists(APPLIER_PATH)

static func apply_state(state: Resource, config: Resource, character_root: Node) -> bool:
    if not is_available():
        push_warning("Configura is not installed. Run setup-avatar.ps1 first.")
        return false

    var applier_script := load(APPLIER_PATH)
    if applier_script == null:
        push_error("Configura CharacterStateApplier could not be loaded.")
        return false

    applier_script.call("apply", state, config, character_root)
    return true
