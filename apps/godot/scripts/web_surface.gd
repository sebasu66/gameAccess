class_name GameAccessWebSurface
extends Node3D

signal ready_state_changed(ready: bool, message: String)

@export var logical_resolution := Vector2i(1280, 800)

var _viewport: SubViewport
var _browser: Control
var _screen_material: StandardMaterial3D
var _target_url := ""

func configure(size: Vector2, target_url: String, frame_material: Material) -> void:
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

func _build_viewport() -> void:
	_viewport = SubViewport.new()
	_viewport.name = "WebViewport"
	_viewport.size = logical_resolution
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.transparent_bg = false
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
	_browser.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_viewport.add_child(_browser)
	if _has_property(_browser, &"enable_accelerated_osr"):
		_browser.set("enable_accelerated_osr", true)
	navigate(_target_url)
	ready_state_changed.emit(true, "Game Access web surface ready")

func _build_diagnostic(message: String) -> void:
	var background := ColorRect.new()
	background.color = Color("#081014")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_viewport.add_child(background)

	var label := Label.new()
	label.text = "GAMEACCESS\n\n%s" % message
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 28)
	label.add_theme_color_override("font_color", Color("#C9F4E6"))
	label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_viewport.add_child(label)

func _has_property(object: Object, property_name: StringName) -> bool:
	for property_value: Variant in object.get_property_list():
		var property: Dictionary = property_value as Dictionary
		if StringName(property.get("name", "")) == property_name:
			return true
	return false
