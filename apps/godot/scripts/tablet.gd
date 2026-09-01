extends Node3D

## First spatial placeholder for the existing GameAccess 2D interface.
## The next iteration will replace the Label3D content with a SubViewport
## backed by the React/CEF application while keeping this anchor unchanged.

var _screen: MeshInstance3D
var _title: Label3D
var _content: Label3D
var _is_open := false

func _ready() -> void:
	visible = false
	position = Vector3(0.32, -0.28, -0.88)
	rotation_degrees = Vector3(-8.0, -5.0, 0.0)
	_build_visual()

func toggle() -> void:
	_is_open = not _is_open
	visible = _is_open

func _build_visual() -> void:
	var body_material := StandardMaterial3D.new()
	body_material.albedo_color = Color("#171A21")
	body_material.roughness = 0.32
	body_material.metallic = 0.45

	var body := MeshInstance3D.new()
	body.name = "TabletBody"
	var body_mesh := BoxMesh.new()
	body_mesh.size = Vector3(1.38, 0.86, 0.08)
	body.mesh = body_mesh
	body.material_override = body_material
	add_child(body)

	var screen_material := StandardMaterial3D.new()
	screen_material.albedo_color = Color("#07151B")
	screen_material.roughness = 0.24
	screen_material.emission_enabled = true
	screen_material.emission = Color("#2E9A9A")
	screen_material.emission_energy_multiplier = 0.35
	screen_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	_screen = MeshInstance3D.new()
	_screen.name = "TabletScreen"
	var screen_mesh := BoxMesh.new()
	screen_mesh.size = Vector3(1.22, 0.70, 0.025)
	_screen.mesh = screen_mesh
	_screen.position = Vector3(0.0, 0.0, -0.052)
	_screen.material_override = screen_material
	add_child(_screen)

	_title = _label("GAMEACCESS", 34, Color("#F2C78D"), 0.0021)
	_title.position = Vector3(-0.56, 0.23, -0.075)
	add_child(_title)
	_content = _label("BIBLIOTECA\n\n▸ Continuar jugando\n  Sala comunitaria\n  Habitación privada\n\n[WASD] mover   [TAB] cerrar", 22, Color("#C9F4E6"), 0.0016)
	_content.position = Vector3(-0.56, -0.04, -0.077)
	add_child(_content)

	var led_material := StandardMaterial3D.new()
	led_material.albedo_color = Color("#54D9C5")
	led_material.emission_enabled = true
	led_material.emission = Color("#54D9C5")
	led_material.emission_energy_multiplier = 3.0
	var led := MeshInstance3D.new()
	var led_mesh := BoxMesh.new()
	led_mesh.size = Vector3(0.9, 0.018, 0.02)
	led.mesh = led_mesh
	led.position = Vector3(0.0, -0.39, -0.055)
	led.material_override = led_material
	add_child(led)

func _label(text_value: String, font_size_value: int, color: Color, pixel_size_value: float) -> Label3D:
	var label := Label3D.new()
	label.text = text_value
	label.font_size = font_size_value
	label.outline_size = 8
	label.modulate = color
	label.pixel_size = pixel_size_value
	label.no_depth_test = true
	return label
