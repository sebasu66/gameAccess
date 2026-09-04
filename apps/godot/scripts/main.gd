extends Node3D

const RoomBuilderScript := preload("res://scripts/room_builder.gd")
const PlayerScript := preload("res://scripts/player_controller.gd")

var player: GameAccessPlayerController
var hud_status: Label
var room_data: Dictionary
var community_spawn := Vector3(-5.0, 0.22, 4.2)
var private_spawn := Vector3(9.5, 0.22, 2.0)

func _ready() -> void:
	room_data = _load_room_data()
	_create_environment()
	_create_rooms()
	_create_player()
	_create_hud()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_1:
			player.teleport_to(community_spawn, "Salón comunitario")
			_set_status("Salón comunitario")
		elif event.keycode == KEY_2:
			player.teleport_to(private_spawn, "Habitación privada")
			_set_status("Habitación privada")

func _load_room_data() -> Dictionary:
	var file := FileAccess.open("res://data/rooms.json", FileAccess.READ)
	if not file:
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Dictionary else {}

func _create_environment() -> void:
	var world_environment := WorldEnvironment.new()
	world_environment.name = "WarmInteriorEnvironment"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#211B20")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#C18F7A")
	environment.ambient_light_energy = 0.52
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.tonemap_exposure = 1.18
	environment.glow_enabled = true
	environment.glow_intensity = 0.55
	environment.glow_bloom = 0.12
	world_environment.environment = environment
	add_child(world_environment)

	var sun := DirectionalLight3D.new()
	sun.name = "SoftKeyLight"
	sun.rotation_degrees = Vector3(-52.0, -28.0, 0.0)
	sun.light_color = Color("#FFD5B3")
	sun.light_energy = 0.42
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 42.0
	add_child(sun)

	_add_zone_light("CommunityWarm", Vector3(-7.0, 3.15, -2.0), Color("#F4AD7B"), 3.4, 8.5)
	_add_zone_light("CommunityTeal", Vector3(1.7, 2.9, 2.7), Color("#62C6C3"), 2.8, 7.0)
	_add_zone_light("PrivateAmber", Vector3(9.5, 2.7, -1.0), Color("#E8AA72"), 2.3, 6.5)

func _add_zone_light(light_name: String, position: Vector3, color: Color, energy: float, range_value: float) -> void:
	var light := OmniLight3D.new()
	light.name = light_name
	light.position = position
	light.light_color = color
	light.light_energy = energy
	light.omni_range = range_value
	light.shadow_enabled = true
	light.shadow_bias = 0.04
	add_child(light)

func _create_rooms() -> void:
	var world := Node3D.new()
	world.name = "World"
	add_child(world)
	var builder := RoomBuilderScript.new()
	if room_data.has("community_hall"):
		builder.build_room(world, room_data["community_hall"])
	if room_data.has("private_room"):
		builder.build_room(world, room_data["private_room"])

func _create_player() -> void:
	player = PlayerScript.new()
	player.name = "Player"
	player.position = community_spawn
	add_child(player)
	var collision_shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.32
	capsule.height = 1.7
	collision_shape.shape = capsule
	collision_shape.position.y = 0.85
	player.add_child(collision_shape)
	player.room_teleported.connect(_on_room_teleported)

func _create_hud() -> void:
	var canvas := CanvasLayer.new()
	canvas.name = "HUD"
	add_child(canvas)

	var panel := ColorRect.new()
	panel.position = Vector2(28.0, 28.0)
	panel.size = Vector2(420.0, 155.0)
	panel.color = Color(0.055, 0.045, 0.055, 0.86)
	canvas.add_child(panel)

	var title := Label.new()
	title.position = Vector2(22.0, 16.0)
	title.text = "GAMEACCESS  /  3D LAYOUT LAB"
	title.add_theme_font_size_override("font_size", 19)
	title.add_theme_color_override("font_color", Color("#F4C99B"))
	panel.add_child(title)

	var instructions := Label.new()
	instructions.position = Vector2(22.0, 50.0)
	instructions.text = "WASD / flechas  mover\nClick  capturar mouse   Esc  liberar\nTab  abrir tablet   1/2  cambiar de sala"
	instructions.add_theme_font_size_override("font_size", 16)
	instructions.add_theme_color_override("font_color", Color("#C6E4DC"))
	panel.add_child(instructions)

	hud_status = Label.new()
	hud_status.position = Vector2(22.0, 124.0)
	hud_status.text = "Sala: Salón comunitario"
	hud_status.add_theme_font_size_override("font_size", 15)
	hud_status.add_theme_color_override("font_color", Color("#E6A56B"))
	panel.add_child(hud_status)

	var crosshair := Label.new()
	crosshair.text = "+"
	crosshair.set_anchors_preset(Control.PRESET_CENTER)
	crosshair.position = Vector2(-8.0, -14.0)
	crosshair.add_theme_font_size_override("font_size", 24)
	crosshair.add_theme_color_override("font_color", Color(1.0, 0.88, 0.70, 0.75))
	canvas.add_child(crosshair)

func _on_room_teleported(room_name: String) -> void:
	_set_status(room_name)

func _set_status(room_name: String) -> void:
	if hud_status:
		hud_status.text = "Sala: %s" % room_name
