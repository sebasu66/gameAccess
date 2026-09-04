extends SceneTree

## Re-exports any Godot-loadable PackedScene as a self-contained GLB.
## Usage:
## godot --headless --path apps/godot --script res://tools/export_scene_to_glb.gd \
##   -- --source=res://path/to/source.blend --output=res://assets/model.glb
## Optional: --image-format=Lossy WebP --quality=0.72

func _init() -> void:
	var arguments := _parse_arguments(OS.get_cmdline_user_args())
	var source_path := String(arguments.get("source", ""))
	var output_path := String(arguments.get("output", ""))
	if source_path.is_empty() or output_path.is_empty():
		_fail("Both --source and --output are required")
		return

	if not ResourceLoader.exists(source_path):
		_fail("Source scene is not importable: %s" % source_path)
		return

	var resource: Resource = load(source_path)
	if not resource is PackedScene:
		_fail("Source is not a PackedScene: %s" % source_path)
		return

	var scene: Node = (resource as PackedScene).instantiate()
	var document := GLTFDocument.new()
	document.image_format = String(arguments.get("image-format", "Lossy WebP"))
	document.lossy_quality = clampf(float(arguments.get("quality", "0.72")), 0.0, 1.0)
	var state := GLTFState.new()
	var append_error := document.append_from_scene(scene, state)
	if append_error != OK:
		scene.free()
		_fail("Unable to convert scene to GLTF state: %s" % error_string(append_error))
		return

	var absolute_output := ProjectSettings.globalize_path(output_path)
	var output_directory := absolute_output.get_base_dir()
	var directory_error := DirAccess.make_dir_recursive_absolute(output_directory)
	if directory_error != OK:
		scene.free()
		_fail("Unable to create output directory: %s" % error_string(directory_error))
		return

	var write_error := document.write_to_filesystem(state, absolute_output)
	scene.free()
	if write_error != OK:
		_fail("Unable to write GLB: %s" % error_string(write_error))
		return

	var output_file := FileAccess.open(absolute_output, FileAccess.READ)
	var output_size: int = output_file.get_length() if output_file != null else -1
	if output_file != null:
		output_file.close()
	print("Exported %s -> %s (%d bytes, %s)" % [source_path, output_path, output_size, document.image_format])
	quit(0)

func _parse_arguments(values: PackedStringArray) -> Dictionary:
	var result: Dictionary = {}
	for value: String in values:
		if not value.begins_with("--") or not value.contains("="):
			continue
		var separator: int = value.find("=")
		var key: String = value.substr(2, separator - 2)
		var argument_value: String = value.substr(separator + 1)
		result[key] = argument_value
	return result

func _fail(message: String) -> void:
	push_error(message)
	quit(1)
