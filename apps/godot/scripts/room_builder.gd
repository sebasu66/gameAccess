class_name RoomBuilder
extends RefCounted

## Procedural first-pass room builder.
##
## This intentionally has no dependency on external assets. Every visual element
## is replaceable by an imported GLB scene without changing the room data model.

const WALL_THICKNESS := 0.22
const FLOOR_THICKNESS := 0.20

var materials: Dictionary = {}

func build_room(parent: Node3D, data: Dictionary) -> Node3D:
	var room := Node3D.new()
	room.name = String(data.get("id", "Room"))
	parent.add_child(room)

	var width := float(data.get("width", 12.0))
	var depth := float(data.get("depth", 10.0))
	var wall_height := float(data.get("wall_height", 3.8))
	var origin := _vector3_from_array(data.get("position", [0.0, 0.0, 0.0]))
	room.position = origin

	var wall_color := Color(String(data.get("wall_color", "#7A5146")))
	var floor_color := Color(String(data.get("floor_color", "#63402D")))
	_build_shell(room, width, depth, wall_height, wall_color, floor_color)
	_build_parquet(room, width, depth, floor_color)
	_build_rugs(room, width, depth, String(data.get("kind", "community")))
	_build_expansion_markers(room, data, width, depth, wall_height)
	_add_room_sign(room, String(data.get("title", "Room")), width, wall_height)

	if String(data.get("kind", "community")) == "private":
		_build_private_content(room, width, depth)
	else:
		_build_community_content(room, width, depth)

	return room

func _build_shell(room: Node3D, width: float, depth: float, wall_height: float, wall_color: Color, floor_color: Color) -> void:
	var floor_material := _material("floor_base", floor_color, 0.56, 0.0)
	_add_box(room, "Floor", Vector3(width, FLOOR_THICKNESS, depth), Vector3(0.0, 0.0, 0.0), floor_material, true)

	var wall_material := _material("walls_%s" % room.name, wall_color, 0.78, 0.0)
	var trim_material := _material("trim_%s" % room.name, Color("#2B1A1D"), 0.48, 0.0)
	var half_width := width * 0.5
	var half_depth := depth * 0.5
	var wall_y := wall_height * 0.5

	_add_box(room, "WallNorth", Vector3(width, wall_height, WALL_THICKNESS), Vector3(0.0, wall_y, -half_depth), wall_material, true)
	_add_box(room, "WallSouth", Vector3(width, wall_height, WALL_THICKNESS), Vector3(0.0, wall_y, half_depth), wall_material, true)
	_add_box(room, "WallWest", Vector3(WALL_THICKNESS, wall_height, depth), Vector3(-half_width, wall_y, 0.0), wall_material, true)
	_add_box(room, "WallEast", Vector3(WALL_THICKNESS, wall_height, depth), Vector3(half_width, wall_y, 0.0), wall_material, true)

	# Dark skirting makes the procedural blockout read like a finished room.
	_add_box(room, "TrimNorth", Vector3(width, 0.16, 0.08), Vector3(0.0, 0.16, -half_depth + 0.11), trim_material)
	_add_box(room, "TrimSouth", Vector3(width, 0.16, 0.08), Vector3(0.0, 0.16, half_depth - 0.11), trim_material)
	_add_box(room, "TrimWest", Vector3(0.08, 0.16, depth), Vector3(-half_width + 0.11, 0.16, 0.0), trim_material)
	_add_box(room, "TrimEast", Vector3(0.08, 0.16, depth), Vector3(half_width - 0.11, 0.16, 0.0), trim_material)

func _build_parquet(room: Node3D, width: float, depth: float, floor_color: Color) -> void:
	var wood_a := _material("parquet_a", floor_color.lightened(0.08), 0.38, 0.0)
	var wood_b := _material("parquet_b", floor_color.darkened(0.10), 0.43, 0.0)
	var plank_width := 1.8
	var plank_depth := 0.34
	var rows := int(ceil(depth / plank_depth))
	var columns := int(ceil(width / plank_width))
	for row in range(rows):
		var z := -depth * 0.5 + plank_depth * 0.5 + row * plank_depth
		var offset := plank_width * 0.5 if row % 2 == 1 else 0.0
		for column in range(columns + 1):
			var x := -width * 0.5 + plank_width * 0.5 + column * plank_width + offset
			if x > width * 0.5 + plank_width * 0.5:
				continue
			var material := wood_a if (row + column) % 3 != 0 else wood_b
			_add_box(room, "Parquet_%02d_%02d" % [row, column], Vector3(plank_width - 0.035, 0.028, plank_depth - 0.028), Vector3(x, FLOOR_THICKNESS * 0.5 + 0.016, z), material)

func _build_rugs(room: Node3D, width: float, depth: float, kind: String) -> void:
	var rug_red := _material("rug_rust", Color("#9F4F3C"), 0.82, 0.0)
	var rug_gold := _material("rug_gold", Color("#C28C4C"), 0.84, 0.0)
	var rug_blue := _material("rug_blue", Color("#355E68"), 0.80, 0.0)
	if kind == "private":
		_add_box(room, "PrivateRug", Vector3(min(width * 0.68, 6.8), 0.034, min(depth * 0.42, 3.0)), Vector3(0.2, 0.125, 0.8), rug_blue)
		_add_box(room, "PrivateRugBorder", Vector3(min(width * 0.72, 7.2), 0.018, min(depth * 0.46, 3.35)), Vector3(0.2, 0.147, 0.8), rug_gold)
	else:
		_add_box(room, "MainRug", Vector3(7.4, 0.034, 3.8), Vector3(-1.0, 0.125, 1.0), rug_red)
		_add_box(room, "LoungeRug", Vector3(4.4, 0.034, 2.4), Vector3(5.8, 0.125, -3.9), rug_gold)

func _build_community_content(room: Node3D, width: float, depth: float) -> void:
	var wood := _material("furniture_wood", Color("#3A211B"), 0.32, 0.0)
	var leather := _material("leather", Color("#9B513A"), 0.70, 0.0)
	var metal := _material("furniture_metal", Color("#2B3038"), 0.26, 0.72)
	var screen := _material("arcade_emission", Color("#182337"), 0.18, 0.15, Color("#35D4C7"), 2.8)
	var screen_pink := _material("banner_emission", Color("#28172B"), 0.25, 0.0, Color("#DA628A"), 2.2)

	# Lounge island.
	_add_box(room, "SofaLeft", Vector3(3.2, 0.72, 0.85), Vector3(-2.0, 0.48, 2.8), leather)
	_add_box(room, "SofaRight", Vector3(3.2, 0.72, 0.85), Vector3(1.5, 0.48, 2.8), leather)
	_add_box(room, "CoffeeTable", Vector3(2.3, 0.12, 1.25), Vector3(-0.3, 0.78, 1.15), wood)
	_add_box(room, "CoffeeTableTop", Vector3(2.15, 0.10, 1.12), Vector3(-0.3, 0.88, 1.15), _material("table_top", Color("#B9794B"), 0.34, 0.0))

	# Arcade machines and a game showcase wall.
	for index in range(4):
		_add_arcade(room, "Arcade_%02d" % index, Vector3(-width * 0.5 + 1.0 + index * 1.45, 0.0, -depth * 0.5 + 1.15), screen if index % 2 == 0 else screen_pink, metal)
	_add_box(room, "GameShowcaseWall", Vector3(7.2, 2.0, 0.18), Vector3(2.6, 1.75, -depth * 0.5 + 0.35), wood)
	for index in range(3):
		_add_box(room, "GameBanner_%02d" % index, Vector3(1.85, 1.12, 0.035), Vector3(-0.2 + index * 2.35, 1.8, -depth * 0.5 + 0.24), screen_pink if index == 1 else screen)

	# Community notice board / future social screen.
	_add_box(room, "SocialScreenFrame", Vector3(4.8, 2.2, 0.24), Vector3(width * 0.5 - 0.35, 1.7, -1.0), metal)
	_add_box(room, "SocialScreen", Vector3(4.35, 1.75, 0.035), Vector3(width * 0.5 - 0.48, 1.7, -1.0), screen)

func _build_private_content(room: Node3D, width: float, depth: float) -> void:
	var wood := _material("private_wood", Color("#39231E"), 0.30, 0.0)
	var wood_light := _material("private_wood_light", Color("#A56B4A"), 0.38, 0.0)
	var fabric := _material("private_fabric", Color("#3D6370"), 0.76, 0.0)
	var screen := _material("private_screen", Color("#17202E"), 0.20, 0.18, Color("#7CE4D7"), 2.5)

	_add_box(room, "Desk", Vector3(3.8, 0.14, 0.86), Vector3(-2.0, 1.0, -2.2), wood)
	_add_box(room, "DeskLegLeft", Vector3(0.14, 1.0, 0.62), Vector3(-3.65, 0.5, -2.2), wood)
	_add_box(room, "DeskLegRight", Vector3(0.14, 1.0, 0.62), Vector3(-0.35, 0.5, -2.2), wood)
	_add_box(room, "PrivateMonitor", Vector3(2.0, 1.2, 0.12), Vector3(-2.0, 1.72, -2.48), screen)
	_add_box(room, "BedOrDaybed", Vector3(3.9, 0.48, 1.55), Vector3(2.1, 0.38, 1.8), fabric)
	_add_box(room, "BedHeadboard", Vector3(3.9, 1.55, 0.18), Vector3(2.1, 0.86, 2.55), wood_light)
	_add_box(room, "PrivateShelf", Vector3(2.2, 2.8, 0.35), Vector3(width * 0.5 - 1.0, 1.4, -depth * 0.5 + 0.5), wood)
	for row in range(2):
		_add_box(room, "Shelf_%02d" % row, Vector3(1.8, 0.58, 0.42), Vector3(width * 0.5 - 1.0, 0.65 + row * 0.95, -depth * 0.5 + 0.18), wood_light)

func _build_expansion_markers(room: Node3D, data: Dictionary, width: float, depth: float, wall_height: float) -> void:
	var marker_material := _material("expansion_marker", Color("#D7A86E"), 0.35, 0.0, Color("#F0B56C"), 1.7)
	var slots: Array = data.get("expansion_slots", [])
	for slot_value in slots:
		var slot := String(slot_value)
		var marker := Node3D.new()
		marker.name = "Expansion_%s" % slot.capitalize()
		room.add_child(marker)
		var position := Vector3.ZERO
		var rotation := Vector3.ZERO
		var size := Vector3(2.8, 2.7, 0.05)
		match slot:
			"north":
				position = Vector3(0.0, 1.45, -depth * 0.5 + 0.13)
			"south":
				position = Vector3(0.0, 1.45, depth * 0.5 - 0.13)
				rotation.y = PI
			"east":
				position = Vector3(width * 0.5 - 0.13, 1.45, 0.0)
				rotation.y = PI * 0.5
				size = Vector3(0.05, 2.7, 2.8)
			"west":
				position = Vector3(-width * 0.5 + 0.13, 1.45, 0.0)
				rotation.y = -PI * 0.5
				size = Vector3(0.05, 2.7, 2.8)
		marker.position = position
		marker.rotation = rotation
		_add_box(marker, "Frame", size, Vector3.ZERO, marker_material)
		var label := Label3D.new()
		label.text = "EXPAND"
		label.font_size = 28
		label.outline_size = 8
		label.modulate = Color("#F5C986")
		label.pixel_size = 0.0025
		label.position = Vector3(0.0, 0.0, -0.08)
		marker.add_child(label)

func _add_room_sign(room: Node3D, title: String, width: float, wall_height: float) -> void:
	var sign := Label3D.new()
	sign.name = "RoomSign"
	sign.text = title.to_upper()
	sign.font_size = 42
	sign.outline_size = 12
	sign.modulate = Color("#F6D5A6")
	sign.pixel_size = 0.0022
	sign.position = Vector3(-width * 0.5 + 0.45, wall_height - 0.55, -0.17)
	room.add_child(sign)

func _add_arcade(room: Node3D, name: String, position: Vector3, screen_material: StandardMaterial3D, metal_material: StandardMaterial3D) -> void:
	var arcade := Node3D.new()
	arcade.name = name
	arcade.position = position
	room.add_child(arcade)
	_add_box(arcade, "Cabinet", Vector3(0.92, 1.75, 0.62), Vector3.ZERO, metal_material)
	_add_box(arcade, "ControlPanel", Vector3(1.0, 0.14, 0.72), Vector3(0.0, 0.82, -0.08), _material("arcade_controls", Color("#5C2633"), 0.28, 0.35))
	_add_box(arcade, "Screen", Vector3(0.68, 0.60, 0.035), Vector3(0.0, 1.30, -0.34), screen_material)
	_add_box(arcade, "LightStrip", Vector3(0.72, 0.04, 0.025), Vector3(0.0, 0.96, -0.36), screen_material)

func _add_box(parent: Node3D, node_name: String, size: Vector3, position: Vector3, material: StandardMaterial3D, collision := false) -> Node3D:
	var holder: Node3D
	if collision:
		holder = StaticBody3D.new()
		var collision_shape := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		collision_shape.shape = shape
		holder.add_child(collision_shape)
	else:
		holder = MeshInstance3D.new()
	holder.name = node_name
	holder.position = position
	parent.add_child(holder)

	if collision:
		var visual := MeshInstance3D.new()
		visual.name = "%sVisual" % node_name
		holder.add_child(visual)
		visual.mesh = _box_mesh(size)
		visual.material_override = material
	else:
		var mesh_instance := holder as MeshInstance3D
		mesh_instance.mesh = _box_mesh(size)
		mesh_instance.material_override = material
	return holder

func _box_mesh(size: Vector3) -> BoxMesh:
	var mesh := BoxMesh.new()
	mesh.size = size
	return mesh

func _material(key: String, color: Color, roughness: float, metallic: float, emission_color := Color.BLACK, emission_energy := 0.0) -> StandardMaterial3D:
	if materials.has(key):
		return materials[key]
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	material.metallic = metallic
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if emission_energy > 0.0:
		material.emission_enabled = true
		material.emission = emission_color
		material.emission_energy_multiplier = emission_energy
	materials[key] = material
	return material

func _vector3_from_array(value: Variant) -> Vector3:
	var values: Array = value if value is Array else [0.0, 0.0, 0.0]
	return Vector3(float(values[0]), float(values[1]), float(values[2]))
