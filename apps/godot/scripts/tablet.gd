extends Node3D

## Player-mounted tablet: lightweight catalog/control surface. The selected game's
## rich media is rendered by the room display, not by this browser.

var _is_open := false
var _web_surface: GameAccessWebSurface

func _ready() -> void:
	visible = false
	position = Vector3(0.58, 0.02, -1.05)
	rotation_degrees = Vector3(-3.0, -7.0, 0.0)
	_build_visual()

func toggle() -> void:
	set_open(not _is_open)

func set_open(open: bool) -> void:
	_is_open = open
	visible = _is_open
	if _web_surface != null:
		_web_surface.set_active(open)

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
	body_material.roughness = 1.0
	body_material.metallic = 0.0
	body_material.metallic_specular = 0.0
	body_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	var body := MeshInstance3D.new()
	body.name = "TabletBody"
	var body_mesh := BoxMesh.new()
	body_mesh.size = Vector3(0.62, 0.98, 0.07)
	body_mesh.material = body_material
	body.mesh = body_mesh
	add_child(body)

	var screen_frame_material := StandardMaterial3D.new()
	screen_frame_material.albedo_color = Color("#090C10")
	screen_frame_material.roughness = 1.0
	screen_frame_material.metallic = 0.0
	screen_frame_material.metallic_specular = 0.0
	screen_frame_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED

	_web_surface = GameAccessWebSurface.new()
	_web_surface.name = "GameAccessWebUI"
	_web_surface.logical_resolution = Vector2i(600, 1000)
	_web_surface.continuous_render = false
	_web_surface.set_active(false)
	# Camera looks down -Z. Positive local Z is the camera-facing side of the tablet.
	_web_surface.position = Vector3(0.0, 0.0, 0.055)
	add_child(_web_surface)
	_web_surface.configure(Vector2(0.52, 0.86), _configured_web_url(), screen_frame_material)

	var led_material := StandardMaterial3D.new()
	led_material.albedo_color = Color("#54D9C5")
	led_material.roughness = 1.0
	led_material.metallic = 0.0
	led_material.metallic_specular = 0.0
	led_material.emission_enabled = true
	led_material.emission = Color("#54D9C5")
	led_material.emission_energy_multiplier = 3.0
	var led := MeshInstance3D.new()
	led.name = "StatusLed"
	var led_mesh := BoxMesh.new()
	led_mesh.size = Vector3(0.30, 0.014, 0.015)
	led_mesh.material = led_material
	led.mesh = led_mesh
	led.position = Vector3(0.0, -0.455, 0.050)
	add_child(led)

func _configured_web_url() -> String:
	var base_url := String(ProjectSettings.get_setting("game_access/web_ui_url", "http://127.0.0.1:1420"))
	var separator := "&" if base_url.contains("?") else "?"
	return "%s%ssurface=tablet" % [base_url, separator]