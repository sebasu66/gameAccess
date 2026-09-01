class_name SpatialScreen
extends Node3D

signal media_loaded(path: String)

@export var logical_resolution := Vector2i(1280, 720)

var _viewport: SubViewport
var _video_player: VideoStreamPlayer
var _screen_material: StandardMaterial3D

func configure(size: Vector2, frame_material: Material) -> void:
	_build_geometry(size, frame_material)
	_build_video_viewport()

func set_video(path: String) -> bool:
	if _video_player == null:
		push_error("SpatialScreen must be configured before assigning media")
		return false
	if path.is_empty() or not ResourceLoader.exists(path):
		push_warning("Video resource is unavailable: %s" % path)
		return false

	var resource := load(path)
	if not resource is VideoStream:
		push_warning("Resource is not a VideoStream: %s" % path)
		return false
	_video_player.stream = resource as VideoStream
	media_loaded.emit(path)
	return true

func set_audio_bus(bus_name: StringName, volume_db := -4.0) -> void:
	if _video_player == null:
		return
	_video_player.bus = bus_name
	_video_player.volume_db = volume_db

func play_from(position_seconds := 0.0) -> void:
	if _video_player == null or _video_player.stream == null:
		return
	_video_player.paused = false
	_video_player.play()
	if position_seconds > 0.01:
		_video_player.stream_position = position_seconds

func pause() -> void:
	if _video_player != null:
		_video_player.paused = true

func resume() -> void:
	if _video_player != null:
		_video_player.paused = false

func stop() -> void:
	if _video_player != null:
		_video_player.stop()

func set_playback_position(position_seconds: float) -> void:
	if _video_player != null and _video_player.stream != null:
		_video_player.stream_position = maxf(0.0, position_seconds)

func set_speed_scale(value: float) -> void:
	if _video_player != null:
		_video_player.speed_scale = clampf(value, 0.9, 1.1)

func playback_position() -> float:
	if _video_player == null:
		return 0.0
	return _video_player.stream_position

func is_playing() -> bool:
	return _video_player != null and _video_player.is_playing() and not _video_player.paused

func _build_geometry(size: Vector2, frame_material: Material) -> void:
	var frame := MeshInstance3D.new()
	frame.name = "Frame"
	var frame_mesh := BoxMesh.new()
	frame_mesh.size = Vector3(size.x + 0.28, size.y + 0.28, 0.16)
	frame_mesh.material = frame_material
	frame.mesh = frame_mesh
	add_child(frame)

	_screen_material = StandardMaterial3D.new()
	_screen_material.albedo_color = Color.WHITE
	_screen_material.roughness = 0.18
	_screen_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	_screen_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_screen_material.emission_enabled = true
	_screen_material.emission = Color.WHITE
	_screen_material.emission_energy_multiplier = 0.55

	var screen := MeshInstance3D.new()
	screen.name = "DisplaySurface"
	var screen_mesh := QuadMesh.new()
	screen_mesh.size = size
	screen_mesh.material = _screen_material
	screen.mesh = screen_mesh
	screen.position.z = 0.09
	add_child(screen)

func _build_video_viewport() -> void:
	_viewport = SubViewport.new()
	_viewport.name = "MediaViewport"
	_viewport.size = logical_resolution
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.transparent_bg = false
	add_child(_viewport)

	var background := ColorRect.new()
	background.color = Color("#05070A")
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	_viewport.add_child(background)

	_video_player = VideoStreamPlayer.new()
	_video_player.name = "VideoPlayer"
	_video_player.expand = true
	_video_player.loop = true
	_video_player.set_anchors_preset(Control.PRESET_FULL_RECT)
	_viewport.add_child(_video_player)

	_screen_material.albedo_texture = _viewport.get_texture()
	_screen_material.emission_texture = _viewport.get_texture()
