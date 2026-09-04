class_name GameAccessAssetRegistry
extends RefCounted

var _definitions: Dictionary = {}

func load_manifest(path: String) -> Error:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return FileAccess.get_open_error()
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return ERR_PARSE_ERROR
	var root := parsed as Dictionary
	var definitions: Variant = root.get("assets", {})
	if not definitions is Dictionary:
		return ERR_INVALID_DATA
	_definitions = definitions
	return OK

func instantiate(asset_id: StringName) -> Node3D:
	var definition: Dictionary = _definitions.get(String(asset_id), {})
	var scene_path := String(definition.get("scene", ""))
	if not scene_path.is_empty() and ResourceLoader.exists(scene_path):
		var resource := load(scene_path)
		if resource is PackedScene:
			return (resource as PackedScene).instantiate() as Node3D

	push_warning("3D asset '%s' is unavailable; using diagnostic fallback" % asset_id)
	return _build_fallback(asset_id, definition)

func _build_fallback(asset_id: StringName, definition: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = "%sFallback" % String(asset_id).to_pascal_case()

	var mesh_instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = _vector3(definition.get("fallback_size", [1.0, 1.0, 1.0]))
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(String(definition.get("fallback_color", "#41464C")))
	material.roughness = 0.55
	mesh.material = material
	mesh_instance.mesh = mesh
	mesh_instance.position.y = mesh.size.y * 0.5
	root.add_child(mesh_instance)

	var label := Label3D.new()
	label.text = String(asset_id).replace("_", " ").to_upper()
	label.font_size = 28
	label.outline_size = 8
	label.modulate = Color("#F5D8A8")
	label.pixel_size = 0.002
	label.position = Vector3(0.0, mesh.size.y + 0.18, 0.0)
	root.add_child(label)
	return root

func _vector3(value: Variant) -> Vector3:
	if value is Array and value.size() >= 3:
		return Vector3(float(value[0]), float(value[1]), float(value[2]))
	return Vector3.ONE
