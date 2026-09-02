class_name PresenceAvatar3D
extends Node3D

enum MotionState {
    IDLE,
    WALKING,
    SITTING,
}

signal expression_changed(expression: StringName, weight: float)
signal appearance_changed
signal motion_state_changed(state: MotionState)

@export var display_name: String = "Player"
@export var body_color: Color = Color(0.22, 0.42, 0.72, 1.0)
@export var head_color: Color = Color(0.78, 0.62, 0.50, 1.0)

@onready var visual_root: Node3D = $VisualRoot
@onready var default_visual: Node3D = $VisualRoot/DefaultVisual
@onready var custom_visual: Node3D = $VisualRoot/CustomVisual
@onready var head_pivot: Node3D = $VisualRoot/DefaultVisual/HeadPivot
@onready var head_mesh: MeshInstance3D = $VisualRoot/DefaultVisual/HeadPivot/Head
@onready var body_mesh: MeshInstance3D = $VisualRoot/DefaultVisual/Body
@onready var left_hand: Node3D = $LeftHandAnchor
@onready var right_hand: Node3D = $RightHandAnchor
@onready var name_label: Label3D = $NameLabel
@onready var voice_anchor: AudioStreamPlayer3D = $VoiceAnchor

var motion_state: MotionState = MotionState.IDLE
var expression_values: Dictionary = {}

func _ready() -> void:
    name_label.text = display_name
    _apply_material_colors()

func set_display_name(value: String) -> void:
    display_name = value
    if is_node_ready():
        name_label.text = value

func set_body_color(value: Color) -> void:
    body_color = value
    if is_node_ready():
        _set_mesh_color(body_mesh, value)
        appearance_changed.emit()

func set_head_color(value: Color) -> void:
    head_color = value
    if is_node_ready():
        _set_mesh_color(head_mesh, value)
        appearance_changed.emit()

func set_look_rotation(value: Vector3) -> void:
    head_pivot.rotation = value

func set_hand_pose(side: StringName, pose: Transform3D, visible := true) -> void:
    var anchor := left_hand if side == &"left" else right_hand
    anchor.transform = pose
    anchor.visible = visible

func hide_hands() -> void:
    left_hand.visible = false
    right_hand.visible = false

func set_motion_state(value: MotionState) -> void:
    if motion_state == value:
        return

    motion_state = value
    visual_root.position.y = -0.32 if value == MotionState.SITTING else 0.0
    motion_state_changed.emit(value)

func set_expression(expression: StringName, weight := 1.0) -> void:
    var normalized := clampf(weight, 0.0, 1.0)
    expression_values[expression] = normalized
    expression_changed.emit(expression, normalized)

func set_custom_character_scene(scene: PackedScene) -> void:
    for child in custom_visual.get_children():
        child.queue_free()

    if scene == null:
        default_visual.visible = true
        custom_visual.visible = false
        appearance_changed.emit()
        return

    var instance := scene.instantiate()
    custom_visual.add_child(instance)
    default_visual.visible = false
    custom_visual.visible = true
    appearance_changed.emit()

func get_voice_player() -> AudioStreamPlayer3D:
    return voice_anchor

func _apply_material_colors() -> void:
    _set_mesh_color(body_mesh, body_color)
    _set_mesh_color(head_mesh, head_color)

func _set_mesh_color(mesh_instance: MeshInstance3D, color: Color) -> void:
    var material := mesh_instance.material_override as StandardMaterial3D
    if material == null:
        material = StandardMaterial3D.new()
    else:
        material = material.duplicate() as StandardMaterial3D

    material.albedo_color = color
    material.roughness = 0.85
    mesh_instance.material_override = material
