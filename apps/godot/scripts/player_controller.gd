class_name GameAccessPlayerController
extends CharacterBody3D

signal room_teleported(room_name: String)

@export var move_speed := 4.6
@export var mouse_sensitivity := 0.0024

var camera: Camera3D
var view_pivot: Node3D
var tablet: Node3D
var pitch := -0.08

func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_build_camera_and_tablet()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey:
		if event.pressed and not event.echo:
			if event.keycode == KEY_TAB:
				_set_tablet_open(not _tablet_open())
				get_viewport().set_input_as_handled()
				return
			if event.keycode == KEY_ESCAPE:
				if _tablet_open():
					_set_tablet_open(false)
					get_viewport().set_input_as_handled()
				else:
					Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
				return
		if _tablet_open():
			if tablet.call("forward_keyboard_event", event):
				get_viewport().set_input_as_handled()
			return

	if _tablet_open():
		if event is InputEventMouseButton or event is InputEventMouseMotion:
			if _try_tablet_pointer(event):
				get_viewport().set_input_as_handled()
		return

	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT and _try_interact(event.position):
			get_viewport().set_input_as_handled()
			return
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		view_pivot.rotate_y(-event.relative.x * mouse_sensitivity)
		pitch = clamp(pitch - event.relative.y * mouse_sensitivity, -1.15, 1.15)
		camera.rotation.x = pitch

func _try_tablet_pointer(event: InputEvent) -> bool:
	if camera == null or not camera.is_inside_tree():
		return false
	var mouse_event := event as InputEventMouse
	if mouse_event == null:
		return false
	var screen_position := mouse_event.position
	var origin := camera.project_ray_origin(screen_position)
	var direction := camera.project_ray_normal(screen_position)
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 3.0)
	query.collide_with_areas = true
	query.collide_with_bodies = false
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return false
	var target := hit.get("collider") as Node
	var world_position: Vector3 = hit.get("position", Vector3.ZERO)
	while target != null:
		if target.has_method("forward_pointer_event"):
			return bool(target.call("forward_pointer_event", event, world_position))
		target = target.get_parent()
	return false

func _try_interact(mouse_position: Vector2) -> bool:
	if camera == null or not camera.is_inside_tree():
		return false
	var screen_position := mouse_position
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		screen_position = get_viewport().get_visible_rect().size * 0.5
	var origin := camera.project_ray_origin(screen_position)
	var direction := camera.project_ray_normal(screen_position)
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 12.0)
	query.collide_with_areas = true
	query.collide_with_bodies = true
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return false
	var target := hit.get("collider") as Node
	while target != null:
		if target.has_method("toggle_playback"):
			target.call("toggle_playback")
			return true
		target = target.get_parent()
	return false

func _physics_process(delta: float) -> void:
	if _tablet_open():
		velocity = velocity.move_toward(Vector3.ZERO, 18.0 * delta)
		move_and_slide()
		return

	var input := Vector2.ZERO
	var up_down := 0.0
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		input.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		input.x += 1.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		input.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		input.y += 1.0
	if Input.is_key_pressed(KEY_Q):
		up_down = 1.0
	if Input.is_key_pressed(KEY_E):
		up_down = -0.8
	input = input.limit_length(1.0)

	var direction := (view_pivot.global_basis * Vector3(input.x, 0.0, input.y)).normalized()
	direction.y = 0.0
	direction = direction.normalized()
	velocity.x = move_toward(velocity.x, direction.x * move_speed, 18.0 * delta)
	velocity.z = move_toward(velocity.z, direction.z * move_speed, 18.0 * delta)
	velocity.y = move_toward(velocity.y, up_down * move_speed, 18.0 * delta)
	move_and_slide()

func teleport_to(target: Vector3, room_name: String) -> void:
	global_position = target
	velocity = Vector3.ZERO
	room_teleported.emit(room_name)

func _tablet_open() -> bool:
	return tablet != null and tablet.has_method("is_open") and bool(tablet.call("is_open"))

func _set_tablet_open(open: bool) -> void:
	if tablet == null:
		return
	tablet.call("set_open", open)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if open else Input.MOUSE_MODE_CAPTURED

func _build_camera_and_tablet() -> void:
	view_pivot = Node3D.new()
	view_pivot.name = "ViewPivot"
	add_child(view_pivot)

	camera = Camera3D.new()
	camera.name = "PlayerCamera"
	camera.position = Vector3(0.0, 1.66, 0.0)
	camera.current = true
	camera.fov = 72.0
	view_pivot.add_child(camera)

	var tablet_scene := load("res://scripts/tablet.gd")
	tablet = Node3D.new()
	tablet.name = "Tablet"
	tablet.set_script(tablet_scene)
	camera.add_child(tablet)
