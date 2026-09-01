class_name GameAccessSettingsOverlay
extends CanvasLayer

const SETTINGS_PATH := "user://settings.cfg"
const DEFAULT_FPS := 60
const DEFAULT_BRIGHTNESS := 1.0

var _environment: Environment
var _backdrop: ColorRect
var _panel: PanelContainer
var _fps_selector: OptionButton
var _brightness_slider: HSlider
var _brightness_value: Label
var _settings_button: Button

func configure(environment: Environment) -> void:
	_environment = environment
	_load_and_apply_settings()

func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_interface()
	_load_and_apply_settings()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F10:
		_toggle_settings()
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_ESCAPE and _panel.visible:
		_close_settings()
		get_viewport().set_input_as_handled()

func _build_interface() -> void:
	_settings_button = Button.new()
	_settings_button.name = "SettingsButton"
	_settings_button.text = "SETTINGS"
	_settings_button.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_settings_button.position = Vector2(-178.0, 24.0)
	_settings_button.custom_minimum_size = Vector2(154.0, 44.0)
	_settings_button.add_theme_font_size_override("font_size", 16)
	_settings_button.pressed.connect(_open_settings)
	add_child(_settings_button)

	_backdrop = ColorRect.new()
	_backdrop.name = "SettingsBackdrop"
	_backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_backdrop.color = Color(0.015, 0.022, 0.035, 0.78)
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	_backdrop.visible = false
	add_child(_backdrop)

	_panel = PanelContainer.new()
	_panel.name = "SettingsPanel"
	_panel.set_anchors_preset(Control.PRESET_CENTER)
	_panel.position = Vector2(-270.0, -190.0)
	_panel.custom_minimum_size = Vector2(540.0, 380.0)
	_panel.visible = false
	_panel.add_theme_stylebox_override("panel", _panel_style())
	add_child(_panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 42)
	margin.add_theme_constant_override("margin_top", 34)
	margin.add_theme_constant_override("margin_right", 42)
	margin.add_theme_constant_override("margin_bottom", 34)
	_panel.add_child(margin)

	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 22)
	margin.add_child(content)

	var title := Label.new()
	title.text = "SETTINGS"
	title.add_theme_font_size_override("font_size", 30)
	title.add_theme_color_override("font_color", Color("#EAF7FF"))
	content.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "Display and performance"
	subtitle.add_theme_font_size_override("font_size", 15)
	subtitle.add_theme_color_override("font_color", Color("#91A5B7"))
	content.add_child(subtitle)

	var fps_row := _setting_row("FPS LIMIT")
	content.add_child(fps_row)
	_fps_selector = OptionButton.new()
	_fps_selector.custom_minimum_size = Vector2(150.0, 44.0)
	_fps_selector.add_item("30 FPS", 30)
	_fps_selector.add_item("60 FPS", 60)
	_fps_selector.item_selected.connect(_on_fps_selected)
	fps_row.add_child(_fps_selector)

	var brightness_header := HBoxContainer.new()
	var brightness_label := Label.new()
	brightness_label.text = "BRIGHTNESS"
	brightness_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	brightness_label.add_theme_font_size_override("font_size", 16)
	brightness_header.add_child(brightness_label)
	_brightness_value = Label.new()
	_brightness_value.add_theme_font_size_override("font_size", 16)
	_brightness_value.add_theme_color_override("font_color", Color("#69D8EE"))
	brightness_header.add_child(_brightness_value)
	content.add_child(brightness_header)

	_brightness_slider = HSlider.new()
	_brightness_slider.min_value = 0.50
	_brightness_slider.max_value = 1.50
	_brightness_slider.step = 0.05
	_brightness_slider.custom_minimum_size.y = 36.0
	_brightness_slider.value_changed.connect(_on_brightness_changed)
	content.add_child(_brightness_slider)

	var close_button := Button.new()
	close_button.text = "CLOSE"
	close_button.custom_minimum_size.y = 46.0
	close_button.add_theme_font_size_override("font_size", 16)
	close_button.pressed.connect(_close_settings)
	content.add_child(close_button)

func _setting_row(label_text: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = label_text
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.add_theme_font_size_override("font_size", 16)
	row.add_child(label)
	return row

func _panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color("#111B28")
	style.border_color = Color("#3C6376")
	style.set_border_width_all(1)
	style.set_corner_radius_all(14)
	style.shadow_color = Color(0.0, 0.0, 0.0, 0.55)
	style.shadow_size = 18
	return style

func _toggle_settings() -> void:
	if _panel.visible:
		_close_settings()
	else:
		_open_settings()

func _open_settings() -> void:
	_backdrop.visible = true
	_panel.visible = true
	_settings_button.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().paused = true
	_fps_selector.grab_focus()

func _close_settings() -> void:
	_backdrop.visible = false
	_panel.visible = false
	_settings_button.visible = true
	get_tree().paused = false

func _on_fps_selected(index: int) -> void:
	var fps := _fps_selector.get_item_id(index)
	Engine.max_fps = fps
	_save_settings(fps, _brightness_slider.value)

func _on_brightness_changed(value: float) -> void:
	_apply_brightness(value)
	_save_settings(Engine.max_fps, value)

func _apply_brightness(value: float) -> void:
	if _environment != null:
		_environment.adjustment_brightness = value
	if _brightness_value != null:
		_brightness_value.text = "%d%%" % roundi(value * 100.0)

func _load_and_apply_settings() -> void:
	var config := ConfigFile.new()
	config.load(SETTINGS_PATH)
	var fps := int(config.get_value("display", "fps_limit", DEFAULT_FPS))
	if fps not in [30, 60]:
		fps = DEFAULT_FPS
	var brightness := clampf(float(config.get_value("display", "brightness", DEFAULT_BRIGHTNESS)), 0.50, 1.50)
	Engine.max_fps = fps
	_apply_brightness(brightness)
	if _fps_selector != null:
		_fps_selector.select(0 if fps == 30 else 1)
	if _brightness_slider != null:
		_brightness_slider.set_value_no_signal(brightness)

func _save_settings(fps: int, brightness: float) -> void:
	var config := ConfigFile.new()
	config.set_value("display", "fps_limit", 30 if fps == 30 else 60)
	config.set_value("display", "brightness", clampf(brightness, 0.50, 1.50))
	config.save(SETTINGS_PATH)
