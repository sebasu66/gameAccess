class_name GodotxToastManager
extends CanvasLayer

signal toast_shown(id: String)
signal toast_dismissed(id: String, reason: int)
signal toast_clicked(id: String)
signal loading_progress_updated(id: String, progress: float)
signal loading_completed(id: String, success: bool)

var proportion: float = 30.0
var default_origin: GodotxToastEnums.ToastOrigin = GodotxToastEnums.ToastOrigin.BOTTOM
var default_animation: GodotxToastEnums.ToastAnimation = GodotxToastEnums.ToastAnimation.SLIDE
var default_time: int = GodotxToastEnums.ToastTime.MEDIUM

var _containers: Dictionary = {}
var _deck_containers: Dictionary = {}
var _loading_toasts: Dictionary = {}
var _toast_counter: int = 0
var _ui_scale: float = 1.0
var _cached_width: float = 0.0

func _ready():
	layer = 128
	follow_viewport_enabled = false
	_setup_containers()
	_update_ui_scale()
	get_tree().root.size_changed.connect(_on_viewport_resized)

func _setup_containers():
	for origin in GodotxToastEnums.ToastOrigin.values():
		var container = GodotxToastContainer.new(origin)
		container.name = "Container_%d" % origin
		add_child(container)
		_containers[origin] = container
		
		var deck_container = GodotxToastDeckContainer.new(origin)
		deck_container.name = "DeckContainer_%d" % origin
		add_child(deck_container)
		_deck_containers[origin] = deck_container

func show_toast(
	message: String,
	style: GodotxToastStyle,
	time: float,
	origin: GodotxToastEnums.ToastOrigin,
	animation: GodotxToastEnums.ToastAnimation,
	options: Dictionary = {}
) -> String:
	
	if message.is_empty():
		push_error("GodotxToastManager: Cannot show toast with empty message")
		return ""
	
	if style == null:
		push_error("GodotxToastManager: Cannot show toast with null style")
		return ""
	
	_toast_counter += 1
	var toast_id = "toast_%d_%d" % [_toast_counter, Time.get_ticks_msec()]
	
	var toast_view = GodotxToastView.new()
	toast_view.toast_id = toast_id
	toast_view.style = style
	toast_view.message = message
	toast_view.display_time = time
	toast_view.origin = origin
	toast_view.animation = animation
	
	toast_view.clicked.connect(_on_toast_clicked)
	toast_view.dismissed.connect(_on_toast_dismissed)
	toast_view.swiped.connect(_on_toast_swiped)
	
	var max_width = _calculate_toast_max_width()
	toast_view.set_max_width(max_width)
	
	var use_deck = style.stack_strategy == GodotxToastEnums.StackStrategy.DECK
	var container = _deck_containers[origin] if use_deck else _containers[origin]
	
	var success = container.add_toast(toast_view, style.stack_strategy, style.max_visible)
	
	if not success:
		return ""
	
	toast_shown.emit(toast_id)
	return toast_id

func show_loading(
	message: String,
	style: GodotxToastStyle,
	origin: GodotxToastEnums.ToastOrigin,
	animation: GodotxToastEnums.ToastAnimation,
	options: Dictionary = {}
) -> String:
	
	if message.is_empty():
		push_error("GodotxToastManager: Cannot show loading toast with empty message")
		return ""
	
	if style == null:
		push_error("GodotxToastManager: Cannot show loading toast with null style")
		return ""
	
	_toast_counter += 1
	var toast_id = "loading_%d_%d" % [_toast_counter, Time.get_ticks_msec()]
	
	var loading_view = GodotxToastLoadingView.new()
	loading_view.toast_id = toast_id
	loading_view.style = style
	loading_view.message = message
	loading_view.display_time = -1
	loading_view.origin = origin
	loading_view.animation = animation
	
	loading_view.clicked.connect(_on_toast_clicked)
	loading_view.dismissed.connect(_on_loading_dismissed)
	loading_view.progress_updated.connect(_on_loading_progress_updated)
	loading_view.swiped.connect(_on_toast_swiped)
	
	var max_width = _calculate_toast_max_width()
	loading_view.set_max_width(max_width)
	
	var use_deck = style.stack_strategy == GodotxToastEnums.StackStrategy.DECK
	var container = _deck_containers[origin] if use_deck else _containers[origin]
	
	var success = container.add_toast(loading_view, style.stack_strategy, style.max_visible)
	
	if not success:
		return ""
	
	_loading_toasts[toast_id] = loading_view
	toast_shown.emit(toast_id)
	return toast_id

func update_loading(toast_id: String, progress: float, new_message: String = "") -> bool:
	if not _loading_toasts.has(toast_id):
		return false
	
	var loading_view = _loading_toasts[toast_id]
	loading_view.update_progress(progress, new_message)
	return true

func complete_loading(toast_id: String, success: bool = true, final_message: String = "") -> bool:
	if not _loading_toasts.has(toast_id):
		return false
	
	var loading_view = _loading_toasts[toast_id]
	loading_view.complete(success, final_message)
	
	if success:
		loading_completed.emit(toast_id, true)
	else:
		loading_completed.emit(toast_id, false)
	
	_loading_toasts.erase(toast_id)
	return true

func dismiss_toast(toast_id: String) -> bool:
	for container in _containers.values():
		if container.dismiss_toast(toast_id, GodotxToastEnums.ToastDismissReason.API):
			return true
	
	for container in _deck_containers.values():
		if container.dismiss_toast(toast_id, GodotxToastEnums.ToastDismissReason.API):
			return true
	
	if _loading_toasts.has(toast_id):
		var loading_view = _loading_toasts[toast_id]
		loading_view.dismiss(GodotxToastEnums.ToastDismissReason.API)
		_loading_toasts.erase(toast_id)
		return true
	
	return false

func clear_all():
	for container in _containers.values():
		container.dismiss_all(GodotxToastEnums.ToastDismissReason.API)
	
	for container in _deck_containers.values():
		container.dismiss_all(GodotxToastEnums.ToastDismissReason.API)
	
	for toast_id in _loading_toasts.keys():
		_loading_toasts[toast_id].dismiss(GodotxToastEnums.ToastDismissReason.API)
	_loading_toasts.clear()

func dismiss_by_origin(origin: GodotxToastEnums.ToastOrigin):
	if _containers.has(origin):
		_containers[origin].dismiss_all(GodotxToastEnums.ToastDismissReason.API)
	
	if _deck_containers.has(origin):
		_deck_containers[origin].dismiss_all(GodotxToastEnums.ToastDismissReason.API)

func _calculate_toast_max_width() -> float:
	var viewport_size = get_viewport().get_visible_rect().size
	var safe_margin = 48.0 * _ui_scale
	return viewport_size.x - (safe_margin * 2)

func _on_viewport_resized():
	_update_ui_scale()
	var new_max_width = _calculate_toast_max_width()
	if abs(new_max_width - _cached_width) > 1.0:
		_cached_width = new_max_width
		for container in _containers.values():
			container.update_max_widths(new_max_width)
			container.handle_viewport_resized()
		
		for container in _deck_containers.values():
			container.update_max_widths(new_max_width)
			container.handle_viewport_resized()

func _update_ui_scale():
	var viewport = get_viewport()
	if viewport:
		_ui_scale = viewport.content_scale_factor

func _on_toast_clicked(toast_id: String):
	toast_clicked.emit(toast_id)

func _on_toast_dismissed(toast_id: String, reason: int):
	toast_dismissed.emit(toast_id, reason)

func _on_toast_swiped(_toast_id: String, _direction: Vector2):
	# Swipe dismiss is handled by the container; do nothing here to avoid double-dismiss.
	pass

func _on_loading_dismissed(toast_id: String, reason: int):
	toast_dismissed.emit(toast_id, reason)
	_loading_toasts.erase(toast_id)

func _on_loading_progress_updated(toast_id: String, progress: float):
	loading_progress_updated.emit(toast_id, progress)

func set_proportion(value: float):
	proportion = clamp(value, 1.0, 100.0)
	_on_viewport_resized()

func update_config(
	p_proportion: float = -1,
	p_origin: int = -1,
	p_animation: int = -1,
	p_time: int = -1
):
	if p_proportion > 0:
		proportion = clamp(p_proportion, 1.0, 100.0)
	if p_origin >= 0:
		default_origin = p_origin
	if p_animation >= 0:
		default_animation = p_animation
	if p_time > 0:
		default_time = p_time
