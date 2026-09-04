class_name GameAccessWorldController
extends Node3D

const WORLD_MANIFEST := "res://data/world.json"
const MATERIAL_MANIFEST := "res://data/materials.json"
const ASSET_MANIFEST := "res://data/assets.json"

var _world_data: Dictionary = {}
var _identity: Dictionary = {}
var _materials := MaterialCatalog.new()
var _assets := GameAccessAssetRegistry.new()
var _player: GameAccessPlayerController
var _media_screen: SpatialScreen
var _network_session: GameAccessNetworkSession
var _network_clock: GameAccessNetworkClock
var _media_sync: GameAccessMediaSyncController
var _hud_status: Label

func _ready() -> void:
	_identity = GameAccessUserIdentity.load_or_create()
	_load_manifests()
	_build_environment()
	_build_spaces()
	_place_assets()
	_build_media_screens()
	_create_player()
	_create_network_services()
	_create_hud()
	_configure_demo_media()

func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	match event.keycode:
		KEY_1:
			_teleport_to_space("public_lounge")
		KEY_2:
			_teleport_to_space("private_room")
		KEY_P:
			if _media_sync != null:
				_media_sync.toggle_playback()

func _load_manifests() -> void:
	_world_data = _load_json_dictionary(WORLD_MANIFEST)
	var material_error := _materials.load_manifest(MATERIAL_MANIFEST)
	if material_error != OK:
		push_error("Unable to load material manifest: %s" % error_string(material_error))
	var asset_error := _assets.load_manifest(ASSET_MANIFEST)
	if asset_error != OK:
		push_error("Unable to load asset manifest: %s" % error_string(asset_error))

func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	world_environment.name = "InteriorEnvironment"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#111316")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#B89B87")
	environment.ambient_light_energy = 0.33
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.tonemap_exposure = 1.05
	environment.glow_enabled = true
	environment.glow_intensity = 0.35
	world_environment.environment = environment
	add_child(world_environment)

	for light_value in _world_data.get("lights", []):
		if light_value is Dictionary:
			_add_light(light_value as Dictionary)

func _build_spaces() -> void:
	var spaces_root := Node3D.new()
	spaces_root.name = "Spaces"
	add_child(spaces_root)
	var builder := ConnectedSpaceBuilder.new(_materials)
	for space_value in _world_data.get("spaces", []):
		if space_value is Dictionary:
			builder.build_space(spaces_root, space_value as Dictionary, _identity)

func _place_assets() -> void:
	var assets_root := Node3D.new()
	assets_root.name = "PlacedAssets"
	add_child(assets_root)
	for placement_value in _world_data.get("assets", []):
		if not placement_value is Dictionary:
			continue
		var placement := placement_value as Dictionary
		var asset_id := StringName(placement.get("asset_id", ""))
		if asset_id.is_empty():
			continue
		var instance := _assets.instantiate(asset_id)
		instance.name = String(placement.get("id", String(asset_id).to_pascal_case()))
		instance.position = _vector3(placement.get("position", [0.0, 0.0, 0.0]))
		instance.rotation_degrees = _vector3(placement.get("rotation_degrees", [0.0, 0.0, 0.0]))
		instance.scale = _vector3(placement.get("scale", [1.0, 1.0, 1.0]))
		assets_root.add_child(instance)

func _build_media_screens() -> void:
	var screens_root := Node3D.new()
	screens_root.name = "Screens"
	add_child(screens_root)
	for screen_value in _world_data.get("screens", []):
		if not screen_value is Dictionary:
			continue
		var definition := screen_value as Dictionary
		var screen := SpatialScreen.new()
		screen.name = String(definition.get("id", "Screen"))
		screen.position = _vector3(definition.get("position", [0.0, 0.0, 0.0]))
		screen.rotation_degrees = _vector3(definition.get("rotation_degrees", [0.0, 0.0, 0.0]))
		screens_root.add_child(screen)
		var size := _vector2(definition.get("size", [4.0, 2.25]))
		screen.configure(size, _materials.get_material(&"screen_frame"))
		if String(definition.get("role", "")) == "shared_media" and _media_screen == null:
			_media_screen = screen

func _create_player() -> void:
	_player = GameAccessPlayerController.new()
	_player.name = "Player"
	_player.position = _spawn_position()
	add_child(_player)
	var collision_shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.32
	capsule.height = 1.7
	collision_shape.shape = capsule
	collision_shape.position.y = 0.85
	_player.add_child(collision_shape)

func _create_network_services() -> void:
	_network_clock = GameAccessNetworkClock.new()
	_network_clock.name = "NetworkClock"
	add_child(_network_clock)

	_media_sync = GameAccessMediaSyncController.new()
	_media_sync.name = "MediaSync"
	add_child(_media_sync)
	if _media_screen != null:
		_media_sync.configure(_media_screen, _network_clock)

	_network_session = GameAccessNetworkSession.new()
	_network_session.name = "NetworkSession"
	add_child(_network_session)
	_network_session.session_started.connect(_on_session_started)
	_network_session.connection_failed.connect(_on_connection_failed)
	_network_session.configure_from_command_line()

func _configure_demo_media() -> void:
	if _media_sync == null:
		return
	var demo_path := String(ProjectSettings.get_setting("game_access/demo_video_path", "res://assets/media/demo.ogv"))
	if ResourceLoader.exists(demo_path):
		_media_sync.set_media(demo_path)
		if bool(ProjectSettings.get_setting("game_access/demo_video_autoplay", true)):
			_media_sync.set_playing(true)
	else:
		_set_status("Video asset missing: %s" % demo_path)

func _create_hud() -> void:
	var canvas := CanvasLayer.new()
	canvas.name = "HUD"
	add_child(canvas)

	var panel := ColorRect.new()
	panel.position = Vector2(24.0, 24.0)
	panel.size = Vector2(500.0, 150.0)
	panel.color = Color(0.035, 0.045, 0.052, 0.88)
	canvas.add_child(panel)

	var title := Label.new()
	title.position = Vector2(18.0, 14.0)
	title.text = "GAME ACCESS  /  3D SOCIAL SLICE"
	title.add_theme_font_size_override("font_size", 19)
	title.add_theme_color_override("font_color", Color("#E7C69B"))
	panel.add_child(title)

	var instructions := Label.new()
	instructions.position = Vector2(18.0, 46.0)
	instructions.text = "WASD / arrows  move   Tab  tablet   P  play/pause video\n1  public room   2  private room   Esc  release mouse"
	instructions.add_theme_font_size_override("font_size", 15)
	instructions.add_theme_color_override("font_color", Color("#C9F4E6"))
	panel.add_child(instructions)

	_hud_status = Label.new()
	_hud_status.position = Vector2(18.0, 104.0)
	_hud_status.text = "Initializing"
	_hud_status.add_theme_font_size_override("font_size", 14)
	_hud_status.add_theme_color_override("font_color", Color("#77D8CC"))
	panel.add_child(_hud_status)

func _teleport_to_space(space_id: String) -> void:
	if _player == null:
		return
	var target := _space_center(space_id)
	target.y = 0.24
	target.z += 1.0
	_player.teleport_to(target, space_id)
	_set_status("Space: %s" % space_id)

func _space_center(space_id: String) -> Vector3:
	for space_value in _world_data.get("spaces", []):
		if space_value is Dictionary and String((space_value as Dictionary).get("id", "")) == space_id:
			return _vector3((space_value as Dictionary).get("position", [0.0, 0.0, 0.0]))
	return Vector3.ZERO

func _spawn_position() -> Vector3:
	var spawn: Dictionary = _world_data.get("spawn", {})
	return _vector3(spawn.get("position", [0.0, 0.24, 2.0]))

func _add_light(data: Dictionary) -> void:
	var light := OmniLight3D.new()
	light.name = String(data.get("id", "Light"))
	light.position = _vector3(data.get("position", [0.0, 2.8, 0.0]))
	light.light_color = Color(String(data.get("color", "#FFD5B3")))
	light.light_energy = float(data.get("energy", 2.0))
	light.omni_range = float(data.get("range", 7.0))
	light.shadow_enabled = bool(data.get("shadows", true))
	add_child(light)

func _on_session_started(mode: String) -> void:
	_set_status("Network: %s  |  User: %s" % [mode, String(_identity.get("display_name", "Player"))])
	if mode == "client" and _network_clock != null:
		_network_clock.request_immediate_sync()

func _on_connection_failed(message: String) -> void:
	_set_status(message)

func _set_status(message: String) -> void:
	if _hud_status != null:
		_hud_status.text = message

func _load_json_dictionary(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Unable to open JSON manifest: %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		push_error("Invalid JSON object in manifest: %s" % path)
		return {}
	return parsed as Dictionary

func _vector3(value: Variant) -> Vector3:
	if value is Array and value.size() >= 3:
		return Vector3(float(value[0]), float(value[1]), float(value[2]))
	return Vector3.ZERO

func _vector2(value: Variant) -> Vector2:
	if value is Array and value.size() >= 2:
		return Vector2(float(value[0]), float(value[1]))
	return Vector2.ONE
