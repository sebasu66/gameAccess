class_name GameAccessGameMediaCatalog
extends RefCounted

const CYBERPUNK_APP_ID := 1091500
const CYBERPUNK_VIDEO := "user://media/cyberpunk_ultimate_edition_trailer_1440p_hap1.mov"
const CYBERPUNK_AUDIO := "res://assets/media/cyberpunk_ultimate_edition_trailer_audio.ogg"


static func descriptor_for(app_id: int, title: String) -> Dictionary:
	match app_id:
		CYBERPUNK_APP_ID:
			return {
				"available": FileAccess.file_exists(CYBERPUNK_VIDEO) and ResourceLoader.exists(CYBERPUNK_AUDIO),
				"app_id": app_id,
				"title": title if not title.is_empty() else "Cyberpunk 2077",
				"video_path": CYBERPUNK_VIDEO,
				"audio_path": CYBERPUNK_AUDIO,
				"autoplay": true,
				"loop": true,
				"start_position": 0.0,
				"volume_db": 0.0,
			}
		_:
			return {
				"available": false,
				"app_id": app_id,
				"title": title,
				"reason": "No cached HAP trailer is available for this game yet.",
			}
