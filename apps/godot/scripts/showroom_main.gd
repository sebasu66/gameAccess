extends Node3D

const PlayerScene := preload("res://scenes/Player.tscn")

@onready var showroom: Node3D = $Showroom
var player: GameAccessPlayerController

func _ready() -> void:
    # Preserve the imported showroom exactly as authored. We only add gameplay
    # collision and the existing GameAccess first-person controller around it.
    var reference_camera := _find_reference_camera(showroom)
    var eye_transform := Transform3D(Basis.IDENTITY, Vector3(0.0, 1.66, 5.0))
    if reference_camera:
        eye_transform = reference_camera.global_transform
        reference_camera.current = false

    _create_runtime_collisions(showroom)
    _create_player(eye_transform)

func _create_player(eye_transform: Transform3D) -> void:
    player = PlayerScene.instantiate() as GameAccessPlayerController
    if player == null:
        push_error("Player.tscn must instantiate GameAccessPlayerController")
        return
    add_child(player)

    # PlayerCamera is created at y=1.66 by player_controller.gd. Place the
    # CharacterBody origin under the imported camera so the eye starts there.
    player.global_position = eye_transform.origin - Vector3(0.0, 1.66, 0.0)
    var reference_euler := eye_transform.basis.get_euler()
    player.rotation.y = reference_euler.y
    player.pitch = clamp(reference_euler.x, -1.15, 1.15)
    if player.camera:
        player.camera.rotation.x = player.pitch

func _find_reference_camera(node: Node) -> Camera3D:
    if node is Camera3D:
        return node as Camera3D
    for child in node.get_children():
        var found := _find_reference_camera(child)
        if found:
            return found
    return null

func _create_runtime_collisions(root: Node) -> void:
    var meshes: Array[MeshInstance3D] = []
    _collect_collision_meshes(root, meshes)
    for mesh_instance in meshes:
        if mesh_instance.mesh == null:
            continue
        var lower_name := mesh_instance.name.to_lower()
        if "light" in lower_name or "lamp" in lower_name or "spot" in lower_name:
            continue
        var already_has_collision := false
        for child in mesh_instance.get_children():
            if child is StaticBody3D:
                already_has_collision = true
                break
        if not already_has_collision:
            mesh_instance.create_trimesh_collision()

func _collect_collision_meshes(node: Node, result: Array[MeshInstance3D]) -> void:
    if node is MeshInstance3D:
        result.append(node as MeshInstance3D)
    for child in node.get_children():
        _collect_collision_meshes(child, result)
