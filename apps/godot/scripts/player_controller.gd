class_name GameAccessPlayerController
extends CharacterBody3D

signal room_teleported(room_name: String)

@export var move_speed := 4.6
@export var mouse_sensitivity := 0.0024

var camera: Camera3D
var tablet: Node3D
var pitch := -0.08

func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_build_camera_and_tablet()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * mouse_sensitivity)
		pitch = clamp(pitch - event.relative.y * mouse_sensitivity, -1.15, 1.15)
		camera.rotation.x = pitch
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		elif event.keycode == KEY_TAB and tablet:
			tablet.call("toggle")

func _physics_process(delta: float) -> void:
	var input := Vector2.ZERO
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		input.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		input.x += 1.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		input.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		input.y += 1.0
	input = input.limit_length(1.0)

	var direction := (transform.basis * Vector3(input.x, 0.0, input.y)).normalized()
	velocity.x = move_toward(velocity.x, direction.x * move_speed, 18.0 * delta)
	velocity.z = move_toward(velocity.z, direction.z * move_speed, 18.0 * delta)
	if not is_on_floor():
		velocity.y -= 18.0 * delta
	else:
		velocity.y = -0.2
	move_and_slide()

func teleport_to(target: Vector3, room_name: String) -> void:
	global_position = target
	velocity = Vector3.ZERO
	room_teleported.emit(room_name)

func _build_camera_and_tablet() -> void:
	camera = Camera3D.new()
	camera.name = "PlayerCamera"
	camera.position = Vector3(0.0, 1.66, 0.0)
	camera.current = true
	camera.fov = 72.0
	add_child(camera)

	var tablet_scene := load("res://scripts/tablet.gd")
	tablet = Node3D.new()
	tablet.name = "Tablet"
	tablet.set_script(tablet_scene)
	camera.add_child(tablet)
