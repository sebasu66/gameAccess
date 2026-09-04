class_name RoomTV
extends Node3D

signal source_changed(source: String)

enum SourceMode { GAME, HAP }

const FRAME_DEPTH := 0.16
const GAME_BACKEND_Z := 0.05
const HAP_BACKEND_Z := 0.0

var _game_surface: GameAccessWebSurface
var _hap_surface: HapSpatialScreen
var _source_mode := SourceMode.GAME

func configure(size: Vector2, frame_material: Material, game_surface_url: String) -> void:
	_build_shared_frame(size, frame_material)

	_game_surface = GameAccessWebSurface.new()
	_game_surface.name = "GameDisplayBackend"
	_game_surface.logical_resolution = Vector2i(1920, 1080)
	_game_surface.continuous_render = true
	# Keep the two renderer quads physically separated. The web quad sits
	# slightly in front when GAME is active; HAP sits slightly behind. Only one
	# backend is visible at a time, so there is no coplanar/z-fighting ambiguity.
	_game_surface.position.z = GAME_BACKEND_Z
	add_child(_game_surface)
	_game_surface.configure(size, game_surface_url, frame_material, false)

	_hap_surface = HapSpatialScreen.new()
	_hap_surface.name = "HapVideoBackend"
	_hap_surface.position.z = HAP_BACKEND_Z
	add_child(_hap_surface)
	_hap_surface.configure(size, frame_material, false)

	add_to_group("gameaccess_tv_controllers")
	_set_source(SourceMode.GAME)

func receive_tablet_message(message: String) -> void:
	var payload: Variant = JSON.parse_string(message)
	if not payload is Dictionary:
		return
	var message_type := String(payload.get("type", ""))
	if message_type not in ["game-selection", "game-selection-clear"]:
		return
	show_game_source()
	if _game_surface != null:
		_game_surface.receive_game_selection(message)

func show_game_source() -> void:
	_set_source(SourceMode.GAME)

func play_hap_media(parameters: Dictionary) -> bool:
	if _hap_surface == null:
		return false
	if not _hap_surface.configure_media(parameters):
		return false
	_set_source(SourceMode.HAP)
	return true

func set_hap_video(video_path: String, audio_path := "", autoplay := true, loop := true) -> bool:
	return play_hap_media({
		"video_path": video_path,
		"audio_path": audio_path,
		"autoplay": autoplay,
		"loop": loop,
	})

func play() -> void:
	if _source_mode == SourceMode.HAP and _hap_surface != null:
		_hap_surface.resume()

func pause() -> void:
	if _source_mode == SourceMode.HAP and _hap_surface != null:
		_hap_surface.pause()

func stop() -> void:
	if _source_mode == SourceMode.HAP and _hap_surface != null:
		_hap_surface.stop()

func set_muted(muted: bool) -> void:
	if _hap_surface != null:
		_hap_surface.set_muted(muted)

func set_volume_linear(volume: float) -> void:
	if _hap_surface != null:
		_hap_surface.set_volume_linear(volume)

func set_volume_db(volume_db: float) -> void:
	if _hap_surface != null:
		_hap_surface.set_volume_db(volume_db)

func current_source() -> String:
	return "hap" if _source_mode == SourceMode.HAP else "game"

func game_backend_available() -> bool:
	return _game_surface != null and _game_surface.browser_available()

func hap_backend_available() -> bool:
	return _hap_surface != null

func debug_game_texture() -> Texture2D:
	return _game_surface.display_texture() if _game_surface != null else null

func debug_isolate_game_surface() -> void:
	_source_mode = SourceMode.GAME
	var frame := get_node_or_null("Frame") as Node3D
	if frame != null:
		frame.visible = false
	if _hap_surface != null:
		_hap_surface.stop()
		_hap_surface.visible = false
		_hap_surface.process_mode = Node.PROCESS_MODE_DISABLED
		_hap_surface.position.z = -2.0
	if _game_surface != null:
		_game_surface.process_mode = Node.PROCESS_MODE_INHERIT
		_game_surface.position.z = 0.25
		_game_surface.visible = true
		_game_surface.set_active(true)
		_game_surface.request_redraw(120)
	print("[TV DEBUG] isolated GAME surface; HAP/frame removed from view")

func debug_restore_normal() -> void:
	var frame := get_node_or_null("Frame") as Node3D
	if frame != null:
		frame.visible = true
	if _game_surface != null:
		_game_surface.position.z = GAME_BACKEND_Z
		_game_surface.process_mode = Node.PROCESS_MODE_INHERIT
	if _hap_surface != null:
		_hap_surface.position.z = HAP_BACKEND_Z
		_hap_surface.process_mode = Node.PROCESS_MODE_INHERIT
	_apply_source_state(_source_mode)
	print("[TV DEBUG] normal TV geometry restored")

func _set_source(mode: SourceMode) -> void:
	if mode == _source_mode:
		# Reassert backend state even when the logical mode did not change. This
		# makes tablet selections able to recover a renderer after a debug/manual
		# source switch.
		_apply_source_state(mode)
		return
	_source_mode = mode
	_apply_source_state(mode)
	source_changed.emit(current_source())

func _apply_source_state(mode: SourceMode) -> void:
	var game_active := mode == SourceMode.GAME
	if _game_surface != null:
		_game_surface.process_mode = Node.PROCESS_MODE_INHERIT
		_game_surface.visible = game_active
		_game_surface.set_active(game_active)
		if game_active:
			_game_surface.request_redraw(60)
	if _hap_surface != null:
		_hap_surface.process_mode = Node.PROCESS_MODE_DISABLED if game_active else Node.PROCESS_MODE_INHERIT
		_hap_surface.visible = not game_active
		if game_active:
			# Hidden video must not keep decoding/playing behind the GAME surface.
			_hap_surface.stop()

func forward_pointer_event(event: InputEvent, world_position: Vector3) -> bool:
	if _source_mode == SourceMode.HAP and event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT and button.pressed:
			_hap_surface.toggle_playback()
			return true
	if _source_mode == SourceMode.GAME and _game_surface != null:
		return _game_surface.forward_pointer_event(event, world_position)
	return false

func _build_shared_frame(size: Vector2, frame_material: Material) -> void:
	var frame := MeshInstance3D.new()
	frame.name = "Frame"
	var frame_mesh := BoxMesh.new()
	frame_mesh.size = Vector3(size.x + 0.28, size.y + 0.28, FRAME_DEPTH)
	frame_mesh.material = frame_material
	frame.mesh = frame_mesh
	add_child(frame)
