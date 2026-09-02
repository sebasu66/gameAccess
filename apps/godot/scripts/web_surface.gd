class_name GameAccessWebSurface
extends Node3D

signal ready_state_changed(ready: bool, message: String)

@export var logical_resolution := Vector2i(1280, 800)

var _viewport: SubViewport
var _browser: Control
var _screen_material: StandardMaterial3D
var _target_url := ""
var _surface_size := Vector2.ONE

func configure(size: Vector2, target_url: String, frame_material: Material) -> void:
	_surface_size = size
	_target_url = target_url
	_build_geometry(size, frame_material)
	_build_viewport()
	_create_browser_or_diagnostic()

func navigate(target_url: String) -> void:
	_target_url = target_url
	if _browser == null:
		return
	if _has_property(_browser, &"url"):
		_browser.set("url", target_url)
	elif _browser.has_method("load_url"):
		_browser.call("load_url", target_url)

func browser_available() -> bool:
	return _browser != null

func target_url() -> String:
	return _target_url

func forward_pointer_event(event: InputEvent, world_position: Vector3) -> bool:
	if _viewport == null:
		return false
	var viewport_position := _viewport_position_from_world(world_position)
	if viewport_position.x < 0.0 or viewport_position.y < 0.0:
		return false
	var forwarded := event.duplicate() as InputEvent
	if forwarded is InputEventMouseButton:
		forwarded.position = viewport_position
		forwarded.global_position = viewport_position
	elif forwarded is InputEventMouseMotion:
		forwarded.position = viewport_position
		forwarded.global_position = viewport_position
	else:
		return false
	_viewport.push_input(forwarded, true)
	return true

func forward_keyboard_event(event: InputEventKey) -> bool:
	if _viewport == null or _browser == null:
		return false
	var forwarded := event.duplicate() as InputEvent
	_viewport.push_input(forwarded, true)
	return true

func _viewport_position_from_world(world_position: Vector3) -> Vector2:
	var local_position := to_local(world_position)
	var u := (local_position.x / _surface_size.x) + 0.5
	var v := 0.5 - (local_position.y / _surface_size.y)
	if u < 0.0 or u > 1.0 or v < 0.0 or v > 1.0:
		return Vector2(-1.0, -1.0)
	return Vector2(
		u * float(logical_resolution.x),
		v * float(logical_resolution.y)
	)

func _build_geometry(size: Vector2, frame_material: Material) -> void:
	var frame := MeshInstance3D.new()
	frame.name = "WebFrame"
	var frame_mesh := BoxMesh.new()
	frame_mesh.size = Vector3(size.x + 0.14, size.y + 0.14, 0.08)
	frame_mesh.material = frame_material
	frame.mesh = frame_mesh
	add_child(frame)

	_screen_material = StandardMaterial3D.new()
	_screen_material.albedo_color = Color.WHITE
	_screen_material.roughness = 0.2
	_screen_material.cull_mode = BaseMaterial3D.CULL_DISABLED

	var surface := MeshInstance3D.new()
	surface.name = "WebDisplaySurface"
	var quad := QuadMesh.new()
	quad.size = size
	quad.material = _screen_material
	surface.mesh = quad
	surface.position.z = 0.05
	add_child(surface)

	var input_area := Area3D.new()
	input_area.name = "WebInputArea"
	input_area.position.z = 0.055
	add_child(input_area)

	var collision := CollisionShape3D.new()
	collision.name = "WebInputCollision"
	var shape := BoxShape3D.new()
	shape.size = Vector3(size.x, size.y, 0.025)
	collision.shape = shape
	input_area.add_child(collision)

func _build_viewport() -> void:
	_viewport = SubViewport.new()
	_viewport.name = "WebViewport"
	_viewport.size = logical_resolution
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.transparent_bg = false
	_viewport.gui_disable_input = false
	add_child(_viewport)
	_screen_material.albedo_texture = _viewport.get_texture()

func _create_browser_or_diagnostic() -> void:
	if not ClassDB.class_exists("CefTexture"):
		_build_diagnostic(
			"Game Access web runtime is not installed.\nRun scripts/install_godot_cef.ps1 to enable the live Tauri/Vite UI."
		)
		ready_state_changed.emit(false, "CefTexture class unavailable")
		return

	var instance: Object = ClassDB.instantiate("CefTexture")
	if not instance is Control:
		if instance != null:
			instance.free()
		_build_diagnostic("CEF runtime loaded but CefTexture is not a Control node.")
		ready_state_changed.emit(false, "Invalid CefTexture runtime")
		return

	_browser = instance as Control
	_browser.name = "GameAccessBrowser"
	_viewport.add_child(_browser)
	_browser.position = Vector2.ZERO
	_browser.size = Vector2(logical_resolution)
	_browser.mouse_filter = Control.MOUSE_FILTER_STOP
	if _has_property(_browser, &"enable_accelerated_osr"):
		_browser.set("enable_accelerated_osr", true)
	navigate(_target_url)
	ready_state_changed.emit(true, "Game Access web surface ready")

func _build_diagnostic(message: String) -> void:
	var background := ColorRect.new()
	background.color = Color("#081014")
	background.position = Vector2.ZERO
	background.size = Vector2(logical_resolution)
	_viewport.add_child(background)

	var label := Label.new()
	label.text = "GAMEACCESS\n\n%s" % message
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 28)
	label.add_theme_color_override("font_color", Color("#C9F4E6"))
	label.position = Vector2.ZERO
	label.size = Vector2(logical_resolution)
	_viewport.add_child(label)

func _has_property(object: Object, property_name: StringName) -> bool:
	for property_value: Variant in object.get_property_list():
		var property: Dictionary = property_value as Dictionary
		if StringName(property.get("name", "")) == property_name:
			return true
	return false
