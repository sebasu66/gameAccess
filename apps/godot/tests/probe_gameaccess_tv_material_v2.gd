extends SceneTree

func _init() -> void:
	call_deferred("_run")

func _center(viewport: SubViewport, label: String) -> Color:
	await process_frame
	await process_frame
	var image := viewport.get_texture().get_image()
	var c := image.get_pixel(image.get_width()/2, image.get_height()/2)
	print(label, "=", c)
	return c

func _run() -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(960, 540)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	var scene := (load("res://node_3d.tscn") as PackedScene).instantiate()
	viewport.add_child(scene)
	await process_frame
	await process_frame
	var tv := scene.find_child("MainScreen", true, false) as RoomTV
	var game := tv.get_node("GameDisplayBackend") as GameAccessWebSurface
	var surface := game.get_node("WebDisplaySurface") as MeshInstance3D
	var camera := Camera3D.new()
	viewport.add_child(camera)
	camera.global_position = tv.global_position + Vector3(0,0,3.4)
	camera.look_at(surface.global_position, Vector3.UP)
	camera.current = true
	await create_timer(2.0).timeout
	await _center(viewport, "ORIGINAL_MATERIAL_CENTER")
	var test_material := StandardMaterial3D.new()
	test_material.albedo_color = Color(1.0, 0.0, 1.0, 1.0)
	test_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	test_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	surface.material_override = test_material
	await _center(viewport, "MAGENTA_OVERRIDE_CENTER")
	var box := MeshInstance3D.new()
	var box_mesh := BoxMesh.new()
	box_mesh.size = Vector3(1.0,1.0,0.02)
	box.mesh = box_mesh
	box.material_override = test_material
	box.global_position = surface.global_position + Vector3(0,0,0.2)
	viewport.add_child(box)
	await _center(viewport, "MAGENTA_BOX_CENTER")
	print("TV_MATERIAL_PROBE_OK=true")
	quit(0)
