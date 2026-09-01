class_name HapSpatialScreen
extends Node3D

signal media_loaded(path: String)
signal media_error(message: String)

var _hap_player: HapPlayer
var _audio_player: AudioStreamPlayer3D
var _screen_material: ShaderMaterial
var _video_path := ""
var _opened := false
var _play_when_opened := false
var _requested_position := 0.0
var _loop := true
var _volume_db := 0.0
var _muted := false


func configure(size: Vector2, frame_material: Material) -> void:
	_build_geometry(size, frame_material)
	_build_players()


func _exit_tree() -> void:
	if _hap_player != null:
		_hap_player.stop()
		_hap_player.stream = null
	if _audio_player != null:
		_audio_player.stop()
		_audio_player.stream = null


func set_video(path: String) -> bool:
	if _hap_player == null:
		push_error("HapSpatialScreen must be configured before assigning media")
		return false
	if path.is_empty() or not FileAccess.file_exists(path):
		push_warning("Hap video is unavailable: %s" % path)
		return false

	_opened = false
	_video_path = path
	var stream := HapVideoStream.new()
	stream.file = path
	_hap_player.stream = stream
	return true


func configure_media(parameters: Dictionary) -> bool:
	var video_path := String(parameters.get("video_path", ""))
	var audio_path := String(parameters.get("audio_path", ""))
	set_loop(bool(parameters.get("loop", true)))
	set_volume_db(float(parameters.get("volume_db", 0.0)))
	_requested_position = maxf(0.0, float(parameters.get("start_position", 0.0)))

	if not audio_path.is_empty() and not set_audio(audio_path):
		return false
	if not set_video(video_path):
		return false
	if bool(parameters.get("autoplay", true)):
		play_from(_requested_position)
	return true


func set_audio(path: String) -> bool:
	if _audio_player == null:
		push_error("HapSpatialScreen must be configured before assigning audio")
		return false
	if path.is_empty() or not ResourceLoader.exists(path):
		push_warning("Screen audio is unavailable: %s" % path)
		return false

	var resource := load(path)
	if not resource is AudioStream:
		push_warning("Screen audio is not an AudioStream: %s" % path)
		return false
	if resource is AudioStreamOggVorbis:
		(resource as AudioStreamOggVorbis).loop = _loop
	_audio_player.stream = resource as AudioStream
	return true


func set_audio_bus(bus_name: StringName, volume_db := -4.0) -> void:
	if _audio_player == null:
		return
	_audio_player.bus = bus_name
	set_volume_db(volume_db)


func set_volume_db(volume_db: float) -> void:
	_volume_db = clampf(volume_db, -80.0, 6.0)
	_apply_volume()


func volume_db() -> float:
	return _volume_db


func set_volume_linear(volume: float) -> void:
	set_volume_db(linear_to_db(clampf(volume, 0.0, 2.0)))


func set_muted(muted: bool) -> void:
	_muted = muted
	_apply_volume()


func set_loop(loop_enabled: bool) -> void:
	_loop = loop_enabled
	if _hap_player != null:
		_hap_player.loop = loop_enabled
	if _audio_player != null and _audio_player.stream is AudioStreamOggVorbis:
		(_audio_player.stream as AudioStreamOggVorbis).loop = loop_enabled


func play_from(position_seconds := 0.0) -> void:
	_requested_position = maxf(0.0, position_seconds)
	_play_when_opened = true
	if _opened:
		_begin_playback()


func pause() -> void:
	if _hap_player != null:
		_hap_player.pause()
	if _audio_player != null:
		_audio_player.stream_paused = true


func resume() -> void:
	if _hap_player != null and _opened:
		_hap_player.play()
	if _audio_player != null:
		_audio_player.stream_paused = false


func stop() -> void:
	_play_when_opened = false
	if _hap_player != null:
		_hap_player.stop()
	if _audio_player != null:
		_audio_player.stop()


func toggle_playback() -> void:
	if is_playing():
		pause()
	else:
		resume()


func set_playback_position(position_seconds: float) -> void:
	_requested_position = maxf(0.0, position_seconds)
	if _hap_player != null:
		_hap_player.stream_position = _requested_position
	if _audio_player != null and _audio_player.stream != null:
		_audio_player.seek(_requested_position)


func set_speed_scale(value: float) -> void:
	var speed := clampf(value, 0.9, 1.1)
	if _hap_player != null:
		_hap_player.playback_speed = speed
	if _audio_player != null:
		_audio_player.pitch_scale = speed


func playback_position() -> float:
	return _hap_player.stream_position if _hap_player != null else 0.0


func is_playing() -> bool:
	return _hap_player != null and _opened and not _hap_player.paused


func _build_geometry(size: Vector2, frame_material: Material) -> void:
	var frame := MeshInstance3D.new()
	frame.name = "Frame"
	var frame_mesh := BoxMesh.new()
	frame_mesh.size = Vector3(size.x + 0.28, size.y + 0.28, 0.16)
	frame_mesh.material = frame_material
	frame.mesh = frame_mesh
	add_child(frame)

	_screen_material = ShaderMaterial.new()
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform sampler2D video_texture : source_color, filter_linear;
uniform float emission_strength = 0.55;

void fragment() {
	vec3 video_color = texture(video_texture, UV).rgb;
	ALBEDO = video_color;
	EMISSION = video_color * emission_strength;
}
"""
	_screen_material.shader = shader

	var display := MeshInstance3D.new()
	display.name = "DisplaySurface"
	var display_mesh := QuadMesh.new()
	display_mesh.size = size
	display_mesh.material = _screen_material
	display.mesh = display_mesh
	display.position.z = 0.09
	add_child(display)


func _build_players() -> void:
	_hap_player = HapPlayer.new()
	_hap_player.name = "HapPlayer"
	_hap_player.loop = _loop
	_hap_player.autoplay = false
	_hap_player.opened.connect(_on_hap_opened)
	_hap_player.playback_looped.connect(_on_hap_looped)
	_hap_player.error_occurred.connect(_on_hap_error)
	add_child(_hap_player)

	_audio_player = AudioStreamPlayer3D.new()
	_audio_player.name = "ScreenAudio"
	_audio_player.position = Vector3(0.0, 0.0, 0.18)
	_audio_player.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
	_audio_player.unit_size = 6.0
	_audio_player.max_distance = 20.0
	_audio_player.max_db = 3.0
	_audio_player.panning_strength = 0.8
	_audio_player.attenuation_filter_cutoff_hz = 20500.0
	_audio_player.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
	add_child(_audio_player)
	_apply_volume()


func _on_hap_opened() -> void:
	var texture := _hap_player.get_texture()
	if texture == null:
		_on_hap_error("Hap video opened without a display texture")
		return
	_screen_material.set_shader_parameter("video_texture", texture)
	_opened = true
	media_loaded.emit(_video_path)
	if _play_when_opened:
		_begin_playback()


func _on_hap_looped() -> void:
	if _loop and _audio_player.stream != null:
		_audio_player.play(0.0)


func _on_hap_error(message: String) -> void:
	push_error("Hap screen failed: %s" % message)
	media_error.emit(message)


func _begin_playback() -> void:
	_hap_player.stream_position = _requested_position
	_hap_player.play()
	if _audio_player.stream != null:
		_audio_player.play(_requested_position)
		_report_audio_state.call_deferred()


func _apply_volume() -> void:
	if _audio_player != null:
		_audio_player.volume_db = -80.0 if _muted else _volume_db


func _report_audio_state() -> void:
	await get_tree().create_timer(0.75).timeout
	var bus_index := AudioServer.get_bus_index(_audio_player.bus)
	var peak_db := -80.0
	if bus_index >= 0:
		peak_db = AudioServer.get_bus_peak_volume_left_db(bus_index, 0)
	print(
		"[TV AUDIO] driver=%s output=%s bus=%s playing=%s volume_db=%.1f peak_db=%.1f" % [
			AudioServer.get_driver_name(),
			AudioServer.output_device,
			_audio_player.bus,
			_audio_player.playing,
			_audio_player.volume_db,
			peak_db,
		]
	)
