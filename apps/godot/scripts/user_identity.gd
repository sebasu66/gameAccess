class_name GameAccessUserIdentity
extends RefCounted

const IDENTITY_PATH := "user://game_access_identity.json"

static func load_or_create() -> Dictionary:
	var existing := _load_identity()
	if not existing.is_empty():
		return existing

	var crypto := Crypto.new()
	var user_id := crypto.generate_random_bytes(16).hex_encode()
	var identity := {
		"user_id": user_id,
		"display_name": "Player %s" % user_id.substr(0, 4).to_upper(),
	}
	_save_identity(identity)
	return identity

static func accent_color(user_id: String) -> Color:
	var hash_value := _fnv1a_32(user_id)
	var hue := float(hash_value % 360) / 360.0
	return Color.from_hsv(hue, 0.55, 0.88)

static func _load_identity() -> Dictionary:
	if not FileAccess.file_exists(IDENTITY_PATH):
		return {}
	var file := FileAccess.open(IDENTITY_PATH, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return {}
	var identity := parsed as Dictionary
	if String(identity.get("user_id", "")).is_empty():
		return {}
	return identity

static func _save_identity(identity: Dictionary) -> void:
	var file := FileAccess.open(IDENTITY_PATH, FileAccess.WRITE)
	if file == null:
		push_warning("Unable to persist Game Access user identity")
		return
	file.store_string(JSON.stringify(identity, "\t"))

static func _fnv1a_32(value: String) -> int:
	var hash_value: int = 2166136261
	for byte in value.to_utf8_buffer():
		hash_value = hash_value ^ int(byte)
		hash_value = int((hash_value * 16777619) & 0xFFFFFFFF)
	return hash_value
