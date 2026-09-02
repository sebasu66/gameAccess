extends Node

signal runtime_state_changed(ready: bool, message: String)

const HOST := "127.0.0.1"
const PORT := 1431
const STARTUP_TIMEOUT_SECONDS := 12.0

var _ready := false
var _last_error := ""
var _runtime_pid := -1
var _building := false

func _ready() -> void:
	call_deferred("ensure_ready")

func is_ready() -> bool:
	return _ready or _port_is_open()

func last_error() -> String:
	return _last_error

func ensure_ready() -> bool:
	if _port_is_open():
		_set_ready(true, "GameAccess runtime ready")
		return true
	if not _building:
		_building = true
		if not _start_runtime():
			_building = false
			_set_ready(false, _last_error)
			return false
		_building = false

	var deadline := Time.get_ticks_msec() + int(STARTUP_TIMEOUT_SECONDS * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if _port_is_open():
			_set_ready(true, "GameAccess runtime ready")
			return true
		await get_tree().create_timer(0.1).timeout
	_last_error = "GameAccess runtime did not become ready on 127.0.0.1:1431"
	_set_ready(false, _last_error)
	return false

func _start_runtime() -> bool:
	# In a source checkout, keep the compiled UI/runtime current automatically.
	var ensure_script := ProjectSettings.globalize_path("res://scripts/ensure_gameaccess_runtime.ps1")
	var manifest := ProjectSettings.globalize_path("res://../desktop/src-tauri/Cargo.toml")
	if FileAccess.file_exists(ensure_script) and FileAccess.file_exists(manifest):
		var output: Array = []
		var code := OS.execute("powershell.exe", PackedStringArray([
			"-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ensure_script
		]), output, true)
		if code != 0:
			_last_error = "Could not build GameAccess runtime: %s" % "\n".join(output)
			return false

	var executable := _find_runtime_executable()
	if executable.is_empty():
		_last_error = "gameaccess-runtime.exe was not found. Build/stage the standalone runtime first."
		return false
	_runtime_pid = OS.create_process(executable, PackedStringArray(), false)
	if _runtime_pid <= 0:
		_last_error = "Could not start %s" % executable
		return false
	return true

func _find_runtime_executable() -> String:
	var configured := String(ProjectSettings.get_setting("game_access/runtime_executable", "")).strip_edges()
	var candidates: Array[String] = []
	if not configured.is_empty():
		candidates.append(configured)
	var exe_dir := OS.get_executable_path().get_base_dir()
	candidates.append(exe_dir.path_join("gameaccess-runtime.exe"))
	candidates.append(exe_dir.path_join("runtime").path_join("gameaccess-runtime.exe"))
	candidates.append(ProjectSettings.globalize_path("res://../desktop/src-tauri/target/debug/gameaccess-runtime.exe"))
	candidates.append(ProjectSettings.globalize_path("res://../desktop/src-tauri/target/release/gameaccess-runtime.exe"))
	for candidate in candidates:
		if FileAccess.file_exists(candidate):
			return candidate
	return ""

func _port_is_open() -> bool:
	var peer := StreamPeerTCP.new()
	var error := peer.connect_to_host(HOST, PORT)
	if error != OK:
		return false
	var deadline := Time.get_ticks_msec() + 120
	while Time.get_ticks_msec() < deadline:
		peer.poll()
		var status := peer.get_status()
		if status == StreamPeerTCP.STATUS_CONNECTED:
			peer.disconnect_from_host()
			return true
		if status == StreamPeerTCP.STATUS_ERROR or status == StreamPeerTCP.STATUS_NONE:
			return false
		OS.delay_msec(5)
	return false

func _set_ready(value: bool, message: String) -> void:
	_ready = value
	if not value:
		_last_error = message
	runtime_state_changed.emit(value, message)
