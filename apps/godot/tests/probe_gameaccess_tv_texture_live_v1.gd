extends SceneTree

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	var tv := RoomTV.new()
	root.add_child(tv)
	var material := StandardMaterial3D.new()
	tv.configure(Vector2(4.3, 2.42), material, "http://127.0.0.1:1431/?surface=display")
	var game := tv.get_node("GameDisplayBackend") as GameAccessWebSurface
	var viewport := game.get_node("WebViewport") as SubViewport
	var deadline := Time.get_ticks_msec() + 20000
	while Time.get_ticks_msec() < deadline and not game.browser_available():
		await create_timer(0.1).timeout
	print("BROWSER_AVAILABLE=", game.browser_available())
	await create_timer(8.0).timeout
	var image := viewport.get_texture().get_image()
	print("VIEWPORT_SIZE=", viewport.size)
	print("IMAGE_SIZE=", image.get_size())
	var points := [
		Vector2i(image.get_width()/2, image.get_height()/2),
		Vector2i(image.get_width()/4, image.get_height()/4),
		Vector2i(image.get_width()*3/4, image.get_height()/4),
		Vector2i(image.get_width()/4, image.get_height()*3/4),
		Vector2i(image.get_width()*3/4, image.get_height()*3/4),
	]
	var non_black := 0
	for point in points:
		var c := image.get_pixelv(point)
		print("PIXEL_", point.x, "_", point.y, "=", c)
		if c.r + c.g + c.b > 0.08:
			non_black += 1
	print("NON_BLACK_SAMPLES=", non_black)
	var surface := game.get_node("WebDisplaySurface") as MeshInstance3D
	var mat := surface.mesh.material as StandardMaterial3D
	print("GAME_VISIBLE=", game.visible)
	print("SURFACE_VISIBLE=", surface.visible)
	print("SURFACE_GLOBAL_Z=", surface.global_position.z)
	print("MATERIAL_HAS_TEXTURE=", mat.albedo_texture != null)
	print("TEXTURE_CLASS=", mat.albedo_texture.get_class() if mat.albedo_texture != null else "null")
	print("TV_TEXTURE_PROBE_OK=true")
	tv.queue_free()
	await process_frame
	quit(0)
