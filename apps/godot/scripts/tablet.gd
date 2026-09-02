extends Node3D

## Player-mounted tablet that renders the same React/Vite application used by Tauri.
## Browser implementation is delegated to GameAccessWebSurface so the tablet is
## independent from the chosen embedded-browser runtime.

var _is_open := false
var _web_surface: GameAccessWebSurface

func _ready() -> void:
	visible = false
	position = Vector3(0.32, -0.28, -0.88)
	rotation_degrees = Vector3(-8.0, -5.0, 0.0)
	_build_visual()

func toggle() -> void:
	set_open(not _is_open)

func set_open(open: bool) -> void:
	_is_open = open
	visible = _is_open

func is_open() -> bool:
	return _is_open

func navigate(target_url: String) -> void:
	if _web_surface != null:
		_web_surface.navigate(target_url)

func browser_available() -> bool:
	return _web_surface != null and _web_surface.browser_available()

func forward_pointer_event(event: InputEvent, world_position: Vector3) -> bool:
	if not _is_open or _web_surface == null:
		return false
	return _web_surface.forward_pointer_event(event, world_position)

func forward_keyboard_event(event: InputEventKey) -> bool:
	if not _is_open or _web_surface == null:
		return false
	return _web_surface.forward_keyboard_event(event)

func _build_visual() -> void:
	var body_material := StandardMaterial3D.new()
	body_material.albedo_color = Color("#171A21")
	body_material.roughness = 0.32
	body_material.metallic = 0.45

	var body := MeshInstance3D.new()
	body.name = "TabletBody"
	var body_mesh := BoxMesh.new()
	body_mesh.size = Vector3(1.38, 0.86, 0.08)
	body_mesh.material = body_material
	body.mesh = body_mesh
	add_child(body)

	var screen_frame_material := StandardMaterial3D.new()
	screen_frame_material.albedo_color = Color("#090C10")
	screen_frame_material.roughness = 0.24
	screen_frame_material.metallic = 0.35

	_web_surface = GameAccessWebSurface.new()
	_web_surface.name = "GameAccessWebUI"
	_web_surface.position = Vector3(0.0, 0.0, -0.055)
	add_child(_web_surface)
	_web_surface.configure(Vector2(1.22, 0.70), _configured_web_url(), screen_frame_material)

	var led_material := StandardMaterial3D.new()
	led_material.albedo_color = Color("#54D9C5")
	led_material.emission_enabled = true
	led_material.emission = Color("#54D9C5")
	led_material.emission_energy_multiplier = 3.0
	var led := MeshInstance3D.new()
	led.name = "StatusLed"
	var led_mesh := BoxMesh.new()
	led_mesh.size = Vector3(0.9, 0.018, 0.02)
	led_mesh.material = led_material
	led.mesh = led_mesh
	led.position = Vector3(0.0, -0.39, -0.055)
	add_child(led)

func _configured_web_url() -> String:
	return String(ProjectSettings.get_setting("game_access/web_ui_url", "http://127.0.0.1:1420"))
