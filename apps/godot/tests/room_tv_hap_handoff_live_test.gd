extends SceneTree

var _failures := 0

func _init() -> void:
	call_deferred("_run")

func _check(value: bool, label: String) -> void:
	if value:
		print("PASS: ", label)
	else:
		_failures += 1
		push_error("FAIL: %s" % label)

func _run() -> void:
	print("ROOM_TV_HAP_HANDOFF_START=true")
	var tv := RoomTV.new()
	root.add_child(tv)
	var frame_material := StandardMaterial3D.new()
	tv.configure(Vector2(4.3, 2.42), frame_material, "http://127.0.0.1:1431/?surface=display")
	await process_frame

	var hap := tv.get_node_or_null("HapVideoBackend") as HapSpatialScreen
	var game := tv.get_node_or_null("GameDisplayBackend") as GameAccessWebSurface
	_check(hap != null and game != null, "RoomTV created HAP and GAME backends")
	var started := tv.set_hap_video("user://media/cyberpunk_ultimate_edition_trailer_1440p_hap1.mov", "res://assets/media/cyberpunk_ultimate_edition_trailer_audio.ogg", true, true)
	_check(started, "RoomTV accepted known Cyberpunk HAP media")

	var deadline := Time.get_ticks_msec() + 12000
	while Time.get_ticks_msec() < deadline and not hap.is_playing():
		await create_timer(0.1).timeout
	_check(tv.current_source() == "hap", "RoomTV entered HAP source")
	_check(hap.visible and not game.visible, "HAP renderer is the only visible renderer")
	_check(hap.is_playing(), "HAP playback started")

	var before := hap.playback_position()
	await create_timer(1.0).timeout
	var after := hap.playback_position()
	_check(after > before + 0.1, "HAP playback position advances")

	tv.show_game_source()
	await process_frame
	_check(tv.current_source() == "game", "RoomTV returned to GAME source")
	_check(game.visible and not hap.visible, "GAME renderer is the only visible renderer after handoff")
	_check(not hap.is_playing(), "HAP playback stops when GAME takes over")

	tv.queue_free()
	await process_frame
	if _failures == 0:
		print("ROOM_TV_HAP_HANDOFF_OK=true")
	quit(_failures)
