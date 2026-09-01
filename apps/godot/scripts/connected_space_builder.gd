class_name ConnectedSpaceBuilder
extends RefCounted

const WALL_THICKNESS := 0.22
const FLOOR_THICKNESS := 0.18
const CEILING_THICKNESS := 0.16
const MIN_SEGMENT_LENGTH := 0.04

var _materials: MaterialCatalog

func _init(material_catalog: MaterialCatalog) -> void:
	_materials = material_catalog

func build_space(parent: Node3D, data: Dictionary, identity: Dictionary = {}) -> Node3D:
	var space := Node3D.new()
	space.name = String(data.get("id", "Space"))
	parent.add_child(space)
	space.position = _vector3(data.get("position", [0.0, 0.0, 0.0]))

	var size := _vector3(data.get("size", [10.0, 3.6, 8.0]))
	var material_ids: Dictionary = data.get("materials", {})
	var wall_material := _materials.get_material(StringName(material_ids.get("walls", "wall_concrete")))
	var floor_material := _materials.get_material(StringName(material_ids.get("floor", "floor_slate")))
	var ceiling_material := _materials.get_material(StringName(material_ids.get("ceiling", "ceiling_warm")))
	var trim_material := _materials.get_material(StringName(material_ids.get("trim", "trim_dark")))
	var openings: Dictionary = data.get("openings", {})

	_build_floor_and_ceiling(space, size, floor_material, ceiling_material)
	_build_wall(space, "north", size, openings.get("north", []), wall_material)
	_build_wall(space, "south", size, openings.get("south", []), wall_material)
	_build_wall(space, "west", size, openings.get("west", []), wall_material)
	_build_wall(space, "east", size, openings.get("east", []), wall_material)
	_build_trim(space, size, openings, trim_material)
	_add_space_label(space, String(data.get("title", space.name)), size)

	if bool(data.get("personalized", false)):
		_personalize_corridor(space, size, identity)

	return space

func _build_floor_and_ceiling(
	space: Node3D,
	size: Vector3,
	floor_material: Material,
	ceiling_material: Material
) -> void:
	_add_box(
		space,
		"Floor",
		Vector3(size.x, FLOOR_THICKNESS, size.z),
		Vector3(0.0, -FLOOR_THICKNESS * 0.5, 0.0),
		floor_material,
		true
	)
	_add_box(
		space,
		"Ceiling",
		Vector3(size.x, CEILING_THICKNESS, size.z),
		Vector3(0.0, size.y + CEILING_THICKNESS * 0.5, 0.0),
		ceiling_material,
		true
	)

func _build_wall(
	space: Node3D,
	side: String,
	size: Vector3,
	opening_values: Variant,
	material: Material
) -> void:
	var wall_length := size.x if side in ["north", "south"] else size.z
	var openings := _normalize_openings(opening_values, wall_length, size.y)
	var cursor := -wall_length * 0.5
	var segment_index := 0

	for opening in openings:
		var opening_center := float(opening.get("offset", 0.0))
		var opening_width := float(opening.get("width", 2.2))
		var opening_height := float(opening.get("height", 2.7))
		var opening_start := opening_center - opening_width * 0.5
		var opening_end := opening_center + opening_width * 0.5

		if opening_start - cursor > MIN_SEGMENT_LENGTH:
			_add_wall_segment(
				space,
				side,
				size,
				cursor,
				opening_start,
				size.y,
				0.0,
				material,
				segment_index
			)
			segment_index += 1

		var header_height := maxf(0.0, size.y - opening_height)
		if header_height > MIN_SEGMENT_LENGTH:
			_add_wall_segment(
				space,
				side,
				size,
				opening_start,
				opening_end,
				header_height,
				opening_height,
				material,
				segment_index
			)
			segment_index += 1
		cursor = opening_end

	if wall_length * 0.5 - cursor > MIN_SEGMENT_LENGTH:
		_add_wall_segment(
			space,
			side,
			size,
			cursor,
			wall_length * 0.5,
			size.y,
			0.0,
			material,
			segment_index
		)

func _add_wall_segment(
	space: Node3D,
	side: String,
	size: Vector3,
	start: float,
	finish: float,
	height: float,
	base_y: float,
	material: Material,
	index: int
) -> void:
	var length := finish - start
	if length <= MIN_SEGMENT_LENGTH or height <= MIN_SEGMENT_LENGTH:
		return

	var center := (start + finish) * 0.5
	var box_size: Vector3
	var position: Vector3
	if side == "north":
		box_size = Vector3(length, height, WALL_THICKNESS)
		position = Vector3(center, base_y + height * 0.5, -size.z * 0.5)
	elif side == "south":
		box_size = Vector3(length, height, WALL_THICKNESS)
		position = Vector3(center, base_y + height * 0.5, size.z * 0.5)
	elif side == "west":
		box_size = Vector3(WALL_THICKNESS, height, length)
		position = Vector3(-size.x * 0.5, base_y + height * 0.5, center)
	else:
		box_size = Vector3(WALL_THICKNESS, height, length)
		position = Vector3(size.x * 0.5, base_y + height * 0.5, center)

	_add_box(
		space,
		"Wall_%s_%02d" % [side.capitalize(), index],
		box_size,
		position,
		material,
		true
	)

func _build_trim(space: Node3D, size: Vector3, openings: Dictionary, material: Material) -> void:
	var trim_height := 0.13
	var trim_depth := 0.06
	if not openings.has("north") or (openings.get("north", []) as Array).is_empty():
		_add_box(space, "TrimNorth", Vector3(size.x, trim_height, trim_depth), Vector3(0.0, trim_height * 0.5, -size.z * 0.5 + 0.13), material)
	if not openings.has("south") or (openings.get("south", []) as Array).is_empty():
		_add_box(space, "TrimSouth", Vector3(size.x, trim_height, trim_depth), Vector3(0.0, trim_height * 0.5, size.z * 0.5 - 0.13), material)
	if not openings.has("west") or (openings.get("west", []) as Array).is_empty():
		_add_box(space, "TrimWest", Vector3(trim_depth, trim_height, size.z), Vector3(-size.x * 0.5 + 0.13, trim_height * 0.5, 0.0), material)
	if not openings.has("east") or (openings.get("east", []) as Array).is_empty():
		_add_box(space, "TrimEast", Vector3(trim_depth, trim_height, size.z), Vector3(size.x * 0.5 - 0.13, trim_height * 0.5, 0.0), material)

func _personalize_corridor(space: Node3D, size: Vector3, identity: Dictionary) -> void:
	var user_id := String(identity.get("user_id", "local"))
	var display_name := String(identity.get("display_name", "Player"))
	var accent_color := GameAccessUserIdentity.accent_color(user_id)
	var accent_material := StandardMaterial3D.new()
	accent_material.albedo_color = accent_color.darkened(0.25)
	accent_material.roughness = 0.28
	accent_material.metallic = 0.35
	accent_material.emission_enabled = true
	accent_material.emission = accent_color
	accent_material.emission_energy_multiplier = 1.8

	_add_box(
		space,
		"PersonalAccentLeft",
		Vector3(size.x - 0.4, 0.045, 0.055),
		Vector3(0.0, 0.22, -size.z * 0.5 + 0.16),
		accent_material
	)
	_add_box(
		space,
		"PersonalAccentRight",
		Vector3(size.x - 0.4, 0.045, 0.055),
		Vector3(0.0, 0.22, size.z * 0.5 - 0.16),
		accent_material
	)

	var label := Label3D.new()
	label.name = "OwnerLabel"
	label.text = "%s  /  PRIVATE" % display_name.to_upper()
	label.font_size = 36
	label.outline_size = 10
	label.modulate = accent_color
	label.pixel_size = 0.0021
	label.position = Vector3(0.0, size.y - 0.45, -size.z * 0.5 + 0.15)
	space.add_child(label)

func _add_space_label(space: Node3D, title: String, size: Vector3) -> void:
	var label := Label3D.new()
	label.name = "SpaceLabel"
	label.text = title.to_upper()
	label.font_size = 32
	label.outline_size = 8
	label.modulate = Color("#E6D4C2")
	label.pixel_size = 0.002
	label.position = Vector3(-size.x * 0.5 + 0.5, size.y - 0.45, -size.z * 0.5 + 0.15)
	space.add_child(label)

func _normalize_openings(values: Variant, wall_length: float, wall_height: float) -> Array[Dictionary]:
	var normalized: Array[Dictionary] = []
	if not values is Array:
		return normalized
	for value in values:
		if not value is Dictionary:
			continue
		var opening := (value as Dictionary).duplicate()
		var width := clampf(float(opening.get("width", 2.2)), 0.2, wall_length - 0.2)
		var offset_limit := maxf(0.0, wall_length * 0.5 - width * 0.5 - 0.1)
		opening["width"] = width
		opening["height"] = clampf(float(opening.get("height", 2.7)), 0.4, wall_height - 0.1)
		opening["offset"] = clampf(float(opening.get("offset", 0.0)), -offset_limit, offset_limit)
		normalized.append(opening)
	normalized.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["offset"]) < float(b["offset"]))
	return normalized

func _add_box(
	parent: Node3D,
	node_name: String,
	size: Vector3,
	position: Vector3,
	material: Material,
	collision := false
) -> MeshInstance3D:
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = node_name
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = material
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	parent.add_child(mesh_instance)

	if collision:
		var body := StaticBody3D.new()
		body.name = "%sCollision" % node_name
		body.position = position
		parent.add_child(body)
		var collision_shape := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		collision_shape.shape = shape
		body.add_child(collision_shape)

	return mesh_instance

func _vector3(value: Variant) -> Vector3:
	if value is Array and value.size() >= 3:
		return Vector3(float(value[0]), float(value[1]), float(value[2]))
	return Vector3.ZERO
