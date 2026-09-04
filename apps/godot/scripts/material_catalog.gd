class_name MaterialCatalog
extends RefCounted

## Loads reusable PBR material definitions from JSON and caches Godot materials.
## Architectural geometry depends on material ids, not asset file paths.

var _definitions: Dictionary = {}
var _cache: Dictionary = {}

func load_manifest(path: String) -> Error:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return FileAccess.get_open_error()

	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return ERR_PARSE_ERROR

	var root := parsed as Dictionary
	var definitions: Variant = root.get("materials", {})
	if not definitions is Dictionary:
		return ERR_INVALID_DATA

	_definitions = definitions
	_cache.clear()
	return OK

func get_material(material_id: StringName) -> StandardMaterial3D:
	if _cache.has(material_id):
		return _cache[material_id] as StandardMaterial3D

	var definition: Dictionary = _definitions.get(String(material_id), {})
	var material := _build_material(definition)
	_cache[material_id] = material
	return material

func has_material(material_id: StringName) -> bool:
	return _definitions.has(String(material_id))

func _build_material(definition: Dictionary) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(String(definition.get("fallback_color", "#777777")))
	material.roughness = float(definition.get("roughness", 0.65))
	material.metallic = float(definition.get("metallic", 0.0))

	var uv_scale := float(definition.get("uv_scale", 1.0))
	material.uv1_scale = Vector3(uv_scale, uv_scale, uv_scale)

	var albedo := _load_texture(String(definition.get("albedo", "")))
	if albedo != null:
		material.albedo_texture = albedo

	var normal := _load_texture(String(definition.get("normal", "")))
	if normal != null:
		material.normal_enabled = true
		material.normal_texture = normal

	var roughness_texture := _load_texture(String(definition.get("roughness_texture", "")))
	if roughness_texture != null:
		material.roughness_texture = roughness_texture
		material.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED

	var ao := _load_texture(String(definition.get("ao", "")))
	if ao != null:
		material.ao_enabled = true
		material.ao_texture = ao

	var emission_color := String(definition.get("emission_color", ""))
	if not emission_color.is_empty():
		material.emission_enabled = true
		material.emission = Color(emission_color)
		material.emission_energy_multiplier = float(definition.get("emission_energy", 1.0))

	return material

func _load_texture(path: String) -> Texture2D:
	if path.is_empty() or not ResourceLoader.exists(path):
		return null
	return load(path) as Texture2D
