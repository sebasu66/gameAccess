class_name GameAccessMediaScreenController
extends Node3D

signal game_media_selected(app_id: int, title: String)
signal game_media_unavailable(app_id: int, title: String)

var _renderer: HapSpatialScreen
var _overlay: GameAccessMediaScreenOverlay
var _idle_media: Dictionary = {}
var _media_available := true
var _volume_linear := 1.0
var _brightness := 1.0


func configure(size: Vector2, frame_material: Material) -> void:
	add_to_group("gameaccess_media_screens")

	_renderer = HapSpatialScreen.new()
	_renderer.name = "HapRenderer"
	add_child(_renderer)
	_renderer.configure(size, frame_material)
	_renderer.media_loaded.connect(_on_media_loaded)
	_renderer.media_error.connect(_on_media_error)

	_overlay = GameAccessMediaScreenOverlay.new()
	_overlay.name = "MediaOverlay"
	add_child(_overlay)
	_overlay.configure(size)
	_overlay.play_pause_requested.connect(toggle_playback)
	_overlay.stop_requested.connect(stop)
	_overlay.volume_changed.connect(set_volume_linear)
	_overlay.brightness_changed.connect(set_brightness)
	_overlay.set_volume(_volume_linear)
	_overlay.set_brightness(_brightness)
	_overlay.set_title("GameAccess")
	_overlay.set_status("SHOWCASE")


func configure_media(parameters: Dictionary) -> bool:
	_idle_media = parameters.duplicate(true)
	var title := String(parameters.get("title", "GameAccess"))
	if _overlay != null:
		_overlay.set_title(title)
		_overlay.set_status("SHOWCASE")
	return _play_media(parameters)


func set_audio_bus(bus_name: StringName, volume_db := -4.0) -> void:
	if _renderer == null:
		return
	_renderer.set_audio_bus(bus_name, volume_db)
	_volume_linear = clampf(db_to_linear(volume_db), 0.0, 1.0)
	if _overlay != null:
		_overlay.set_volume(_volume_linear)


func set_volume_linear(value: float) -> void:
	_volume_linear = clampf(value, 0.0, 1.0)
	if _renderer != null:
		_renderer.set_volume_linear(_volume_linear)
	if _overlay != null:
		_overlay.set_volume(_volume_linear)


func set_brightness(value: float) -> void:
	_brightness = clampf(value, 0.2, 1.35)
	if _renderer != null:
		_renderer.set_brightness(_brightness)
	if _overlay != null:
		_overlay.set_brightness(_brightness)


func play_from(position_seconds := 0.0) -> void:
	if not _media_available or _renderer == null:
		return
	_renderer.play_from(position_seconds)
	if _overlay != null:
		_overlay.set_playing(true)
		_overlay.set_status("PLAYING")


func pause() -> void:
	if _renderer == null:
		return
	_renderer.pause()
	if _overlay != null:
		_overlay.set_playing(false)
		_overlay.set_status("PAUSED")


func resume() -> void:
	if not _media_available or _renderer == null:
		return
	_renderer.resume()
	if _overlay != null:
		_overlay.set_playing(true)
		_overlay.set_status("PLAYING")


func stop() -> void:
	if _renderer == null:
		return
	_renderer.stop()
	if _overlay != null:
		_overlay.set_playing(false)
		_overlay.set_status("STOPPED")


func toggle_playback() -> void:
	if not _media_available or _renderer == null:
		return
	if _renderer.is_playing():
		pause()
	else:
		resume()


func forward_pointer_event(event: InputEvent, world_position: Vector3) -> bool:
	if _overlay == null:
		return false
	return _overlay.forward_pointer_event(event, world_position)


func receive_game_selection(message: String) -> void:
	var parsed: Variant = JSON.parse_string(message)
	if not parsed is Dictionary:
		return
	var payload := parsed as Dictionary
	var message_type := String(payload.get("type", ""))
	if message_type == "game-selection-clear":
		_restore_idle_media()
		return
	if message_type != "game-selection":
		return

	var app_id_value: Variant = payload.get("appId", 0)
	var app_id := 0 if app_id_value == null else int(app_id_value)
	var title := String(payload.get("name", "Game"))
	var descriptor := GameAccessGameMediaCatalog.descriptor_for(app_id, title)
	if _overlay != null:
		_overlay.set_title(title)

	if not bool(descriptor.get("available", false)):
		_media_available = false
		if _renderer != null:
			_renderer.stop()
			_renderer.set_display_enabled(false)
		if _overlay != null:
			_overlay.set_media_available(false)
			_overlay.set_playing(false)
			_overlay.set_status("NO CACHED HAP TRAILER")
		game_media_unavailable.emit(app_id, title)
		return

	_media_available = true
	if _renderer != null:
		_renderer.set_display_enabled(true)
	if _overlay != null:
		_overlay.set_media_available(true)
		_overlay.set_status("LOADING")
	_play_media(descriptor)
	game_media_selected.emit(app_id, title)


func _restore_idle_media() -> void:
	_media_available = true
	if _renderer != null:
		_renderer.set_display_enabled(true)
	if _overlay != null:
		_overlay.set_media_available(true)
		_overlay.set_title("GameAccess")
		_overlay.set_status("SHOWCASE")
	if not _idle_media.is_empty():
		_play_media(_idle_media)


func _play_media(parameters: Dictionary) -> bool:
	if _renderer == null:
		return false
	_renderer.set_display_enabled(true)
	_renderer.set_brightness(_brightness)
	var merged := parameters.duplicate(true)
	merged["volume_db"] = linear_to_db(maxf(_volume_linear, 0.0001))
	var started := _renderer.configure_media(merged)
	if not started:
		_media_available = false
		_renderer.set_display_enabled(false)
		if _overlay != null:
			_overlay.set_media_available(false)
			_overlay.set_playing(false)
			_overlay.set_status("MEDIA UNAVAILABLE")
		return false
	_media_available = true
	if _overlay != null:
		_overlay.set_media_available(true)
		_overlay.set_playing(bool(parameters.get("autoplay", true)))
	return true


func _on_media_loaded(_path: String) -> void:
	if _overlay != null:
		_overlay.set_media_available(true)
		_overlay.set_playing(_renderer != null and _renderer.is_playing())
		_overlay.set_status("PLAYING" if _renderer != null and _renderer.is_playing() else "READY")


func _on_media_error(message: String) -> void:
	_media_available = false
	if _overlay != null:
		_overlay.set_media_available(false)
		_overlay.set_playing(false)
		_overlay.set_status("VIDEO ERROR: %s" % message)
