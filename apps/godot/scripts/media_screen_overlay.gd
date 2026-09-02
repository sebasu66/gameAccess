class_name GameAccessMediaScreenOverlay
extends Node3D

signal play_pause_requested
signal stop_requested
signal volume_changed(value: float)
signal brightness_changed(value: float)

var _surface_size := Vector2.ONE
var _logical_resolution := Vector2i(1600, 900)
var _viewport: SubViewport
var _title_label: Label
var _status_label: Label
var _play_button: Button
var _stop_button: Button
var _volume_slider: HSlider
var _brightness_slider: HSlider
var _media_available := true


func configure(size: Vector2, logical_resolution := Vector2i(1600, 900)) -> void:
	_surface_size = size
	_logical_resolution = logical_resolution
	_build_viewport()
	_build_surface()


func set_title(title: String) -> void:
	if _title_label != null:
		_title_label.text = title if not title.is_empty() else "GameAccess"


func set_status(status: String) -> void:
	if _status_label != null:
		_status_label.text = status


func set_playing(playing: bool) -> void:
	if _play_button != null:
		_play_button.text = "PAUSE" if playing else "PLAY"


func set_media_available(available: bool) -> void:
	_media_available = available
	if _play_button != null:
		_play_button.disabled = not available
	if _stop_button != null:
		_stop_button.disabled = not available


func set_volume(value: float) -> void:
	if _volume_slider != null:
		_volume_slider.set_value_no_signal(clampf(value, 0.0, 1.0))


func set_brightness(value: float) -> void:
	if _brightness_slider != null:
		_brightness_slider.set_value_no_signal(clampf(value, 0.2, 1.35))


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


func _build_viewport() -> void:
	_viewport = SubViewport.new()
	_viewport.name = "MediaOverlayViewport"
	_viewport.size = _logical_resolution
	_viewport.transparent_bg = true
	_viewport.gui_disable_input = false
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_viewport)

	var root := Control.new()
	root.name = "MediaOverlayUI"
	root.position = Vector2.ZERO
	root.size = Vector2(_logical_resolution)
	root.mouse_filter = Control.MOUSE_FILTER_PASS
	_viewport.add_child(root)

	var heading_panel := ColorRect.new()
	heading_panel.name = "HeadingPanel"
	heading_panel.position = Vector2(48.0, 42.0)
	heading_panel.size = Vector2(760.0, 112.0)
	heading_panel.color = Color(0.025, 0.035, 0.045, 0.78)
	heading_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(heading_panel)

	var eyebrow := Label.new()
	eyebrow.position = Vector2(22.0, 14.0)
	eyebrow.size = Vector2(710.0, 26.0)
	eyebrow.text = "GAMEACCESS  /  MEDIA SCREEN"
	eyebrow.add_theme_font_size_override("font_size", 18)
	eyebrow.add_theme_color_override("font_color", Color("#79E0D3"))
	eyebrow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	heading_panel.add_child(eyebrow)

	_title_label = Label.new()
	_title_label.position = Vector2(22.0, 42.0)
	_title_label.size = Vector2(710.0, 46.0)
	_title_label.text = "GameAccess"
	_title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_title_label.add_theme_font_size_override("font_size", 30)
	_title_label.add_theme_color_override("font_color", Color.WHITE)
	_title_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	heading_panel.add_child(_title_label)

	_status_label = Label.new()
	_status_label.position = Vector2(22.0, 84.0)
	_status_label.size = Vector2(710.0, 22.0)
	_status_label.text = "SHOWCASE"
	_status_label.add_theme_font_size_override("font_size", 15)
	_status_label.add_theme_color_override("font_color", Color("#B8C8CF"))
	_status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	heading_panel.add_child(_status_label)

	var controls_panel := ColorRect.new()
	controls_panel.name = "ControlsPanel"
	controls_panel.position = Vector2(48.0, float(_logical_resolution.y) - 130.0)
	controls_panel.size = Vector2(float(_logical_resolution.x) - 96.0, 84.0)
	controls_panel.color = Color(0.018, 0.025, 0.032, 0.82)
	controls_panel.mouse_filter = Control.MOUSE_FILTER_PASS
	root.add_child(controls_panel)

	_play_button = _make_button("PAUSE", Vector2(18.0, 18.0), Vector2(116.0, 48.0))
	_play_button.pressed.connect(_on_play_pause_pressed)
	controls_panel.add_child(_play_button)

	_stop_button = _make_button("STOP", Vector2(146.0, 18.0), Vector2(104.0, 48.0))
	_stop_button.pressed.connect(_on_stop_pressed)
	controls_panel.add_child(_stop_button)

	var volume_label := _make_small_label("VOLUME", Vector2(288.0, 8.0), Vector2(190.0, 22.0))
	controls_panel.add_child(volume_label)
	_volume_slider = HSlider.new()
	_volume_slider.position = Vector2(288.0, 31.0)
	_volume_slider.size = Vector2(270.0, 38.0)
	_volume_slider.min_value = 0.0
	_volume_slider.max_value = 1.0
	_volume_slider.step = 0.02
	_volume_slider.value = 0.72
	_volume_slider.value_changed.connect(_on_volume_value_changed)
	controls_panel.add_child(_volume_slider)

	var brightness_label := _make_small_label("BRIGHTNESS", Vector2(604.0, 8.0), Vector2(220.0, 22.0))
	controls_panel.add_child(brightness_label)
	_brightness_slider = HSlider.new()
	_brightness_slider.position = Vector2(604.0, 31.0)
	_brightness_slider.size = Vector2(270.0, 38.0)
	_brightness_slider.min_value = 0.2
	_brightness_slider.max_value = 1.35
	_brightness_slider.step = 0.02
	_brightness_slider.value = 1.0
	_brightness_slider.value_changed.connect(_on_brightness_value_changed)
	controls_panel.add_child(_brightness_slider)

	var hint := _make_small_label("Tablet selects media  •  Click controls directly on the screen", Vector2(910.0, 28.0), Vector2(420.0, 28.0))
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	controls_panel.add_child(hint)

	set_media_available(_media_available)


func _build_surface() -> void:
	var material := StandardMaterial3D.new()
	material.resource_name = "MediaScreenOverlayMaterial"
	material.albedo_color = Color.WHITE
	material.albedo_texture = _viewport.get_texture()
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.metallic = 0.0
	material.roughness = 1.0

	var surface := MeshInstance3D.new()
	surface.name = "MediaOverlaySurface"
	var quad := QuadMesh.new()
	quad.size = _surface_size
	quad.material = material
	surface.mesh = quad
	surface.position.z = 0.105
	surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(surface)


func _make_button(text: String, position: Vector2, size: Vector2) -> Button:
	var button := Button.new()
	button.text = text
	button.position = position
	button.size = size
	button.focus_mode = Control.FOCUS_NONE
	button.add_theme_font_size_override("font_size", 17)
	return button


func _make_small_label(text: String, position: Vector2, size: Vector2) -> Label:
	var label := Label.new()
	label.text = text
	label.position = position
	label.size = size
	label.add_theme_font_size_override("font_size", 14)
	label.add_theme_color_override("font_color", Color("#B8C8CF"))
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


func _viewport_position_from_world(world_position: Vector3) -> Vector2:
	var local_position := to_local(world_position)
	var u := (local_position.x / _surface_size.x) + 0.5
	var v := 0.5 - (local_position.y / _surface_size.y)
	if u < 0.0 or u > 1.0 or v < 0.0 or v > 1.0:
		return Vector2(-1.0, -1.0)
	return Vector2(
		u * float(_logical_resolution.x),
		v * float(_logical_resolution.y)
	)


func _on_play_pause_pressed() -> void:
	play_pause_requested.emit()


func _on_stop_pressed() -> void:
	stop_requested.emit()


func _on_volume_value_changed(value: float) -> void:
	volume_changed.emit(value)


func _on_brightness_value_changed(value: float) -> void:
	brightness_changed.emit(value)
