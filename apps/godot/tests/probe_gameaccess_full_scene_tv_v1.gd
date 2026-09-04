extends SceneTree

func _init() -> void:
	call_deferred("_run")

func _sample_center(viewport: SubViewport, label: String) -> Color:
	await process_frame
	await process_frame
	var image := viewport.get_texture().get_image()
	var point := Vector2i(image.get_width() / 2, image.get_height() / 2)
	var color := image.get_pixelv(point)
	print(label, "=", color)
	return color

func _run() -> void:
	var viewport := SubViewport.new()
	viewport.name = "DiagnosticViewport"
	viewport.size = Vector2i(960, 540)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)

	var packed := load("res://node_3d.tscn") as PackedScene
	var scene := packed.instantiate()
	viewport.add_child(scene)
	await process_frame
	await process_frame

	var tv := scene.find_child("MainScreen", true, false) as RoomTV
	if tv == null:
		push_error("MainScreen RoomTV not found")
		quit(2)
		return
	var game := tv.get_node("GameDisplayBackend") as GameAccessWebSurface
	var web_viewport := game.get_node("WebViewport") as SubViewport
	var deadline := Time.get_ticks_msec() + 20000
	while Time.get_ticks_msec() < deadline and not game.browser_available():
		await create_timer(0.1).timeout
	await create_timer(8.0).timeout

	var camera := Camera3D.new()
	camera.name = "DiagnosticCamera"
	viewport.add_child(camera)
	camera.global_position = tv.global_position + Vector3(0.0, 0.0, 3.4)
	camera.look_at(tv.global_position, Vector3.UP)
	camera.fov = 55.0
	camera.current = true
	await process_frame

	var direct_image := web_viewport.get_texture().get_image()
	var direct_color := direct_image.get_pixel(direct_image.get_width()/2, direct_image.get_height()/2)
	print("DIRECT_WEB_CENTER=", direct_color)
	print("TV_GLOBAL_POSITION=", tv.global_position)
	print("CAMERA_GLOBAL_POSITION=", camera.global_position)

	await _sample_center(viewport, "FULL_SCENE_CENTER")

	var frame := tv.get_node_or_null("Frame") as Node3D
	if frame != null:
		frame.visible = false
	for name in ["LedTop", "LedBottom", "LedLeft", "LedRight"]:
		var led := tv.get_node_or_null(name) as Node3D
		if led != null:
			led.visible = false
	await _sample_center(viewport, "WITHOUT_TV_FRAME_CENTER")

	var metal := scene.get_node_or_null("metal") as Node3D
	if metal != null:
		metal.visible = false
	await _sample_center(viewport, "WITHOUT_IMPORTED_ROOM_CENTER")

	print("GAME_GLOBAL_POSITION=", game.global_position)
	var surface := game.get_node("WebDisplaySurface") as MeshInstance3D
	print("WEB_SURFACE_GLOBAL_POSITION=", surface.global_position)
	print("GAME_VISIBLE=", game.visible)
	print("WEB_SURFACE_VISIBLE=", surface.visible)
	print("FULL_SCENE_TV_PROBE_OK=true")
	quit(0)
