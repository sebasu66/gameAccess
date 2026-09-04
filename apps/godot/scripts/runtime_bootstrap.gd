extends Node

signal runtime_state_changed(ready: bool, message: String)

const HOST := "127.0.0.1"
const PORT := 1431
const STARTUP_TIMEOUT_SECONDS := 12.0

var _runtime_ready := false
var _last_error := ""
var _runtime_pid := -1
var _building := false

func _ready() -> void:
	call_deferred("ensure_ready")

func is_ready() -> bool:
	return _runtime_ready or _port_is_open()

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

func get_library() -> Dictionary:
	return await _request_json(HTTPClient.METHOD_GET, "/local-steam-pool")

func get_game(app_id: int) -> Dictionary:
	var library := await get_library()
	for game_value: Variant in library.get("games", []):
		if game_value is Dictionary and int(game_value.get("app_id", 0)) == app_id:
			return game_value as Dictionary
	return {}

func play_game(app_id: int) -> Dictionary:
	return await _request_json(HTTPClient.METHOD_POST, "/open-steam-run", {"appId": app_id})

func install_game(app_id: int) -> Dictionary:
	return await _request_json(HTTPClient.METHOD_POST, "/open-steam-install", {"appId": app_id})

func get_download_status(app_id: int) -> Dictionary:
	return await _request_json(HTTPClient.METHOD_GET, "/steam-download-status/%d" % app_id)

func switch_steam_account(account_label: String) -> Dictionary:
	return await _request_json(HTTPClient.METHOD_POST, "/switch-steam-account", {"accountLabel": account_label})

func open_steam_client() -> Dictionary:
	return await _request_json(HTTPClient.METHOD_POST, "/open-steam-client")

func _request_json(method: int, route: String, body := {}) -> Dictionary:
	if not await ensure_ready():
		return {"ok": false, "error": _last_error}
	var request := HTTPRequest.new()
	add_child(request)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var encoded_body := "" if body.is_empty() else JSON.stringify(body)
	var start_error := request.request("http://%s:%d%s" % [HOST, PORT, route], headers, method, encoded_body)
	if start_error != OK:
		request.queue_free()
		return {"ok": false, "error": "Runtime request failed to start", "code": start_error}
	var response: Array = await request.request_completed
	request.queue_free()
	var result_code := int(response[0])
	var http_code := int(response[1])
	var response_body: PackedByteArray = response[3]
	if result_code != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "error": "Runtime request failed", "result": result_code, "status": http_code}
	var text := response_body.get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(text)
	if parsed is Dictionary:
		var value := parsed as Dictionary
		if http_code >= 400:
			value["ok"] = false
			value["status"] = http_code
		return value
	return {"ok": http_code < 400, "status": http_code, "body": text}

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
	_runtime_ready = value
	if not value:
		_last_error = message
	runtime_state_changed.emit(value, message)
