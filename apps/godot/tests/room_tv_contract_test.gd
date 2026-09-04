extends SceneTree

var _failures := 0

func _init() -> void:
	print("ROOM_TV_CONTRACT_START=true")
	_run()

func _check(value: bool, label: String) -> void:
	if value:
		print("PASS: ", label)
	else:
		_failures += 1
		push_error("FAIL: %s" % label)

func _run() -> void:
	var tv := RoomTV.new()
	_check(tv.current_source() == "game", "RoomTV defaults to game source")
	for method_name in [&"receive_tablet_message", &"show_game_source", &"play_hap_media", &"set_hap_video", &"play", &"pause", &"stop", &"set_muted", &"set_volume_linear", &"forward_pointer_event"]:
		_check(tv.has_method(method_name), "RoomTV exposes %s" % method_name)
	var frame_front := RoomTV.FRAME_DEPTH * 0.5
	var game_plane := RoomTV.GAME_BACKEND_Z + GameAccessWebSurface.DISPLAY_SURFACE_Z
	var hap_plane := RoomTV.HAP_BACKEND_Z + HapSpatialScreen.DISPLAY_SURFACE_Z
	_check(game_plane > frame_front, "GAME renderer is in front of frame")
	_check(hap_plane > frame_front, "HAP renderer is in front of frame")
	_check(absf(game_plane - hap_plane) >= 0.005, "GAME and HAP renderers are not coplanar")
	var frame_material := StandardMaterial3D.new()
	tv.configure(Vector2(4.0, 2.25), frame_material, "http://127.0.0.1:1431/?surface=display")
	var game_backend := tv.get_node_or_null("GameDisplayBackend") as Node3D
	var hap_backend := tv.get_node_or_null("HapVideoBackend") as Node3D
	_check(game_backend != null and hap_backend != null, "RoomTV creates both renderer backends")
	_check(game_backend.visible and not hap_backend.visible, "RoomTV starts with GAME renderer only")
	tv.call("_set_source", RoomTV.SourceMode.HAP)
	_check(not game_backend.visible and hap_backend.visible, "RoomTV switches renderer visibility to HAP")
	tv.show_game_source()
	_check(game_backend.visible and not hap_backend.visible, "RoomTV switches renderer visibility back to GAME")
	tv.free()

	var hap := HapSpatialScreen.new()
	_check(hap.has_method("configure_media"), "HAP backend configure_media remains available")
	_check(hap.has_method("play_from"), "HAP backend play_from remains available")
	_check(hap.has_method("pause"), "HAP backend pause remains available")
	_check(hap.has_method("resume"), "HAP backend resume remains available")
	_check(hap.has_method("stop"), "HAP backend stop remains available")
	_check(hap.has_method("set_playback_position"), "HAP backend seek remains available")
	_check(hap.has_method("set_volume_linear"), "HAP backend volume remains available")
	hap.free()

	var runtime_script := load("res://scripts/runtime_bootstrap.gd")
	var runtime: Node = runtime_script.new()
	for method_name in [&"get_library", &"get_game", &"play_game", &"install_game", &"get_download_status", &"switch_steam_account", &"open_steam_client"]:
		_check(runtime.has_method(method_name), "Godot runtime exposes %s" % method_name)
	runtime.free()

	if _failures == 0:
		print("ROOM_TV_CONTRACT_OK=true")
	quit(_failures)
