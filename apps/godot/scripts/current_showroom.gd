extends Node3D

const SettingsOverlay := preload("res://scripts/settings_overlay.gd")

const CONCRETE_ALBEDO := preload("res://assets/materials/concrete_wall_009/concrete_wall_009_diff_1k.jpg")
const CONCRETE_NORMAL := preload("res://assets/materials/concrete_wall_009/concrete_wall_009_nor_gl_1k.jpg")
const CONCRETE_ROUGHNESS := preload("res://assets/materials/concrete_wall_009/concrete_wall_009_rough_1k.jpg")
const CONCRETE_AO := preload("res://assets/materials/concrete_wall_009/concrete_wall_009_ao_1k.jpg")
const WOOD_FLOOR_PBR := preload("res://assets/ambientcg/Extracted/WoodFloor008_4K-JPG.tres")
const RUG_FABRIC_PBR := preload("res://assets/ambientcg/Extracted/Fabric028_2K-PNG.tres")
const CYBERPUNK_TRAILER := "user://media/cyberpunk_ultimate_edition_trailer_1440p_hap1.mov"
const CYBERPUNK_TRAILER_AUDIO := "res://assets/media/cyberpunk_ultimate_edition_trailer_audio.ogg"
const MAIN_SCREEN_HEIGHT := 2.42
const MAIN_SCREEN_SIZE := Vector2(MAIN_SCREEN_HEIGHT * 16.0 / 9.0, MAIN_SCREEN_HEIGHT)
const LOUNGE_FORWARD_OFFSET := 1.45
const TV_WALL_APPROACH := 0.38

func _ready() -> void:
	var environment := _create_environment()
	_configure_authored_materials($metal)
	_create_lounge_focus()
	_create_room_collision_shell()
	_create_static_collisions($metal)
	_create_lighting()
	_create_settings_overlay(environment)

func _create_environment() -> Environment:
	var world_environment := WorldEnvironment.new()
	world_environment.name = "ShowroomEnvironment"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#151923")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#B8C6D5")
	environment.ambient_light_energy = 0.11
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_BG
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.tonemap_exposure = 0.98
	environment.glow_enabled = true
	environment.glow_intensity = 0.12
	environment.ssao_enabled = true
	environment.ssao_radius = 0.85
	environment.ssao_intensity = 1.25
	environment.ssao_power = 1.35
	environment.ssao_detail = 0.45
	environment.adjustment_enabled = true
	environment.adjustment_brightness = 1.0
	environment.adjustment_contrast = 1.04
	environment.adjustment_saturation = 0.92
	world_environment.environment = environment
	add_child(world_environment)
	return environment

func _create_settings_overlay(environment: Environment) -> void:
	var settings := SettingsOverlay.new()
	settings.name = "SettingsOverlay"
	add_child(settings)
	settings.configure(environment)

func _create_static_collisions(root: Node) -> void:
	for child in root.get_children():
		if child is MeshInstance3D and child.visible:
			var mesh := child as MeshInstance3D
			if mesh.mesh != null and not _has_static_collision(mesh):
				mesh.create_trimesh_collision()
		_create_static_collisions(child)

func _has_static_collision(mesh: MeshInstance3D) -> bool:
	for child in mesh.get_children():
		if child is StaticBody3D:
			return true
	return false

func _create_lighting() -> void:
	var key := SpotLight3D.new()
	key.name = "SoftCeilingKey"
	key.position = Vector3(0.0, 3.05, 0.0)
	key.rotation_degrees = Vector3(-90.0, 0.0, 0.0)
	key.light_color = Color("#FFE6C9")
	key.light_energy = 2.6
	key.light_size = 1.8
	key.spot_range = 15.0
	key.spot_angle = 82.0
	key.spot_angle_attenuation = 0.65
	key.shadow_enabled = true
	key.shadow_bias = 0.06
	add_child(key)

	_add_static_fill("WallFillBack", Vector3(0.0, 1.65, -5.8), Color("#F5DFC8"), 0.34, 4.8)
	_add_static_fill("WallFillLeft", Vector3(-5.25, 1.55, 0.0), Color("#E9D8C5"), 0.26, 4.2)
	_add_static_fill("WallFillRight", Vector3(5.25, 1.55, 0.0), Color("#E9D8C5"), 0.26, 4.2)

	for z_position in [-3.4, 0.0, 3.4]:
		_add_gallery_spot(
			"GalleryLeft_%s" % str(z_position).replace("-", "N").replace(".", "_"),
			Vector3(-4.75, 2.72, z_position),
			Vector3(-5.78, 1.45, z_position)
		)
		_add_gallery_spot(
			"GalleryRight_%s" % str(z_position).replace("-", "N").replace(".", "_"),
			Vector3(4.75, 2.72, z_position),
			Vector3(5.78, 1.45, z_position)
		)

func _configure_authored_materials(root: Node) -> void:
	# The imported Blender scene isolates the large overhead panels as
	# `glass.ceiling` and the thin wall strips as `emissions_wall`. Match only
	# those exact slots and preserve metal, wall, tile and floor PBR materials.
	for child in root.get_children():
		if child is MeshInstance3D:
			var mesh_instance := child as MeshInstance3D
			if mesh_instance.name in ["wall_back", "wall_back_tiles"]:
				# Bring the central feature wall into the room again, reopening the
				# original passage behind it on both sides.
				mesh_instance.position.z += LOUNGE_FORWARD_OFFSET
			if mesh_instance.name in ["floor_002", "floor_005", "floor_details"]:
				mesh_instance.visible = false
				continue
			mesh_instance.gi_mode = GeometryInstance3D.GI_MODE_STATIC
			mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			if mesh_instance.mesh != null:
				for surface_index in range(mesh_instance.mesh.get_surface_count()):
					var source := mesh_instance.get_active_material(surface_index)
					if not source is StandardMaterial3D:
						continue
					if mesh_instance.name == "walls_pillars_002" and source.resource_name == "windows_glass_external":
						# The chrome faces were removed surgically in Blender; retain the
						# original panel geometry and finish it like the feature wall.
						mesh_instance.set_surface_override_material(surface_index, _concrete_material())
					elif source.resource_name in ["wall", "wall.tiles"]:
						mesh_instance.set_surface_override_material(surface_index, _concrete_material())
					elif source.resource_name in ["glass.ceiling", "emissions_wall"]:
						var emissive := (source as StandardMaterial3D).duplicate() as StandardMaterial3D
						emissive.emission_enabled = true
						emissive.emission = Color("#FFF3E5")
						emissive.emission_energy_multiplier = 1.70 if source.resource_name == "glass.ceiling" else 1.35
						mesh_instance.set_surface_override_material(surface_index, emissive)
		_configure_authored_materials(child)

func _concrete_material() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.resource_name = "ShowroomConcrete"
	material.albedo_texture = CONCRETE_ALBEDO
	material.albedo_color = Color("#777B7D")
	material.normal_enabled = true
	material.normal_texture = CONCRETE_NORMAL
	material.normal_scale = 0.65
	material.roughness = 0.82
	material.roughness_texture = CONCRETE_ROUGHNESS
	material.ao_enabled = true
	material.ao_texture = CONCRETE_AO
	material.uv1_scale = Vector3(3.2, 3.2, 3.2)
	return material

func _wood_floor_material() -> StandardMaterial3D:
	var material := (WOOD_FLOOR_PBR as StandardMaterial3D).duplicate() as StandardMaterial3D
	material.resource_name = "LoungeWoodFloor008"
	# WoodFloor008 contains naturally long boards. Repeat the plank direction
	# more aggressively so they read at a believable width/length in this room.
	material.uv1_scale = Vector3(6.8, 5.0, 1.0)
	material.normal_scale = 0.22
	material.roughness_texture = null
	material.roughness = 0.82
	material.metallic = 0.0
	material.metallic_specular = 0.28
	material.heightmap_enabled = false
	return material

func _rug_fabric_material() -> StandardMaterial3D:
	var material := (RUG_FABRIC_PBR as StandardMaterial3D).duplicate() as StandardMaterial3D
	material.resource_name = "LoungeFabric028"
	material.uv1_scale = Vector3(3.2, 3.2, 3.2)
	material.normal_scale = 0.62
	material.heightmap_enabled = false
	return material

func _create_lounge_focus() -> void:
	var lounge := Node3D.new()
	lounge.name = "LoungeFocus"
	add_child(lounge)

	var frame_material := StandardMaterial3D.new()
	frame_material.albedo_color = Color("#090B0E")
	frame_material.metallic = 0.72
	frame_material.roughness = 0.24
	var screen := GameAccessMediaScreenController.new()
	screen.name = "MainScreen"
	# Keep the display in front of the imported wall instead of coplanar with it.
	screen.position = Vector3(0.0, 1.58, -4.82 + LOUNGE_FORWARD_OFFSET - TV_WALL_APPROACH)
	lounge.add_child(screen)
	screen.configure(MAIN_SCREEN_SIZE, frame_material)
	_add_tv_led_outline(screen, MAIN_SCREEN_SIZE)
	_ensure_tv_audio_bus()
	screen.set_audio_bus(&"TVRoom", 0.0)
	screen.configure_media({
		"title": "Cyberpunk 2077",
		"video_path": CYBERPUNK_TRAILER,
		"audio_path": CYBERPUNK_TRAILER_AUDIO,
		"autoplay": true,
		"loop": true,
		"start_position": 0.0,
		"volume_db": 0.0,
	})
	_add_static_box_collision(
		screen,
		"ScreenCollision",
		Vector3(MAIN_SCREEN_SIZE.x + 0.35, MAIN_SCREEN_SIZE.y + 0.33, 0.20),
		Vector3.ZERO
	)

	var floor_material := _wood_floor_material()
	_add_box(lounge, "WoodFloor", Vector3(11.55, 0.10, 13.25), Vector3(0.0, -0.045, 0.0), floor_material)

	var rug_border := StandardMaterial3D.new()
	rug_border.albedo_color = Color("#121B25")
	rug_border.roughness = 0.98
	_add_box(lounge, "RugBorder", Vector3(6.41, 0.025, 3.76), Vector3(0.0, 0.05, -2.15 + LOUNGE_FORWARD_OFFSET), rug_border)

	var rug_material := _rug_fabric_material()
	_add_box(lounge, "CenterRug", Vector3(6.25, 0.03, 3.6), Vector3(0.0, 0.07, -2.15 + LOUNGE_FORWARD_OFFSET), rug_material)

func _add_tv_led_outline(screen: Node3D, display_size: Vector2) -> void:
	var led_material := StandardMaterial3D.new()
	led_material.resource_name = "MainScreenLedTrim"
	led_material.albedo_color = Color("#17343B")
	led_material.emission_enabled = true
	led_material.emission = Color("#52CBE5")
	led_material.emission_energy_multiplier = 2.80
	led_material.roughness = 0.30

	# HapSpatialScreen's frame extends 14 cm beyond the display and has an
	# 8 cm front face. A 5 mm tube at z=8.5 cm physically touches that face.
	var frame_half_width := display_size.x * 0.5 + 0.14
	var frame_half_height := display_size.y * 0.5 + 0.14
	var front_z := 0.085
	var horizontal_length := display_size.x + 0.28
	var vertical_length := display_size.y + 0.28
	var strips: Array[MeshInstance3D] = [
		_add_led_tube(screen, "LedTop", horizontal_length, Vector3(0.0, frame_half_height, front_z), true, led_material),
		_add_led_tube(screen, "LedBottom", horizontal_length, Vector3(0.0, -frame_half_height, front_z), true, led_material),
		_add_led_tube(screen, "LedLeft", vertical_length, Vector3(-frame_half_width, 0.0, front_z), false, led_material),
		_add_led_tube(screen, "LedRight", vertical_length, Vector3(frame_half_width, 0.0, front_z), false, led_material),
	]
	for strip in strips:
		strip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _add_led_tube(parent: Node3D, node_name: String, length: float, position: Vector3, horizontal: bool, material: Material) -> MeshInstance3D:
	var tube := MeshInstance3D.new()
	tube.name = node_name
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.005
	mesh.bottom_radius = 0.005
	mesh.height = length
	mesh.radial_segments = 16
	mesh.rings = 1
	mesh.material = material
	tube.mesh = mesh
	tube.position = position
	if horizontal:
		tube.rotation_degrees.z = 90.0
	tube.gi_mode = GeometryInstance3D.GI_MODE_STATIC
	parent.add_child(tube)
	return tube

func _create_room_collision_shell() -> void:
	var shell := Node3D.new()
	shell.name = "RoomCollisionShell"
	add_child(shell)
	_add_static_box_collision(shell, "FloorBoundary", Vector3(11.6, 0.16, 13.3), Vector3(0.0, -0.10, 0.0))
	_add_static_box_collision(shell, "LeftBoundary", Vector3(0.22, 3.2, 13.3), Vector3(-5.72, 1.5, 0.0))
	_add_static_box_collision(shell, "RightBoundary", Vector3(0.22, 3.2, 13.3), Vector3(5.72, 1.5, 0.0))
	_add_static_box_collision(shell, "RearBoundary", Vector3(11.6, 3.2, 0.22), Vector3(0.0, 1.5, 6.55))

func _add_static_box_collision(parent: Node3D, body_name: String, size: Vector3, position: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = body_name
	body.position = position
	parent.add_child(body)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	return body

func _ensure_tv_audio_bus() -> void:
	var bus_index := AudioServer.get_bus_index("TVRoom")
	if bus_index < 0:
		AudioServer.add_bus()
		bus_index = AudioServer.bus_count - 1
		AudioServer.set_bus_name(bus_index, "TVRoom")
		AudioServer.set_bus_send(bus_index, "Master")
	AudioServer.set_bus_mute(bus_index, false)
	AudioServer.set_bus_volume_db(bus_index, 0.0)
	var has_reverb := false
	for effect_index in AudioServer.get_bus_effect_count(bus_index):
		if AudioServer.get_bus_effect(bus_index, effect_index) is AudioEffectReverb:
			has_reverb = true
			break
	if not has_reverb:
		var reverb := AudioEffectReverb.new()
		reverb.room_size = 0.72
		reverb.damping = 0.62
		reverb.wet = 0.16
		reverb.dry = 0.92
		AudioServer.add_bus_effect(bus_index, reverb)

func _add_gallery_spot(light_name: String, position: Vector3, target: Vector3) -> void:
	var spot := SpotLight3D.new()
	spot.name = light_name
	spot.position = position
	spot.light_color = Color("#FFDDBA")
	spot.light_energy = 1.15
	spot.light_size = 0.35
	spot.spot_range = 3.4
	spot.spot_angle = 32.0
	spot.spot_angle_attenuation = 0.8
	spot.shadow_enabled = false
	add_child(spot)
	spot.look_at(target, Vector3.UP)

func _add_box(parent: Node3D, node_name: String, size: Vector3, position: Vector3, material: Material) -> MeshInstance3D:
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = node_name
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = material
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	mesh_instance.gi_mode = GeometryInstance3D.GI_MODE_STATIC
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	parent.add_child(mesh_instance)
	return mesh_instance

func _add_static_fill(light_name: String, light_position: Vector3, color: Color, energy: float, range_value: float) -> void:
	var light := OmniLight3D.new()
	light.name = light_name
	light.position = light_position
	light.light_color = color
	light.light_energy = energy
	light.omni_range = range_value
	light.shadow_enabled = false
	add_child(light)
