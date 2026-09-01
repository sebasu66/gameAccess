class_name GameAccessMediaSyncController
extends Node

signal state_changed(media_path: String, playing: bool, position_seconds: float)

const SERVER_PEER_ID := 1
const SNAPSHOT_INTERVAL_SECONDS := 2.0
const HARD_DRIFT_SECONDS := 0.55
const SOFT_DRIFT_SECONDS := 0.08
const MAX_SPEED_CORRECTION := 0.035

var _screen: SpatialScreen
var _clock: GameAccessNetworkClock
var _media_path := ""
var _playing := false
var _anchor_position_seconds := 0.0
var _anchor_server_msec := 0
var _snapshot_elapsed := 0.0

func configure(screen: SpatialScreen, clock: GameAccessNetworkClock) -> void:
	_screen = screen
	_clock = clock
	if not multiplayer.peer_connected.is_connected(_on_peer_connected):
		multiplayer.peer_connected.connect(_on_peer_connected)

func set_media(path: String) -> void:
	if _is_authority():
		_set_media_authoritative(path)
	else:
		_request_set_media.rpc_id(SERVER_PEER_ID, path)

func set_playing(value: bool) -> void:
	if _is_authority():
		_set_playing_authoritative(value)
	else:
		_request_set_playing.rpc_id(SERVER_PEER_ID, value)

func toggle_playback() -> void:
	set_playing(not _playing)

func current_media_path() -> String:
	return _media_path

func current_expected_position() -> float:
	if not _playing:
		return _anchor_position_seconds
	var now_msec := _server_now_msec()
	return maxf(0.0, _anchor_position_seconds + float(now_msec - _anchor_server_msec) / 1000.0)

func _process(delta: float) -> void:
	if _screen == null:
		return
	_reconcile_playback()
	if _is_authority() and multiplayer.multiplayer_peer != null:
		_snapshot_elapsed += delta
		if _snapshot_elapsed >= SNAPSHOT_INTERVAL_SECONDS:
			_snapshot_elapsed = 0.0
			_broadcast_state()

func _set_media_authoritative(path: String) -> void:
	_media_path = path
	_anchor_position_seconds = 0.0
	_anchor_server_msec = _server_now_msec()
	_playing = false
	_apply_state_locally()
	_broadcast_state()

func _set_playing_authoritative(value: bool) -> void:
	_anchor_position_seconds = current_expected_position()
	if _screen != null and _screen.is_playing():
		_anchor_position_seconds = _screen.playback_position()
	_anchor_server_msec = _server_now_msec()
	_playing = value
	_apply_state_locally()
	_broadcast_state()

func _apply_state_locally() -> void:
	if _screen == null:
		return
	if not _media_path.is_empty():
		_screen.set_video(_media_path)
	if _playing:
		_screen.play_from(_anchor_position_seconds)
	else:
		_screen.pause()
	state_changed.emit(_media_path, _playing, _anchor_position_seconds)

func _reconcile_playback() -> void:
	if _media_path.is_empty():
		return
	if not _playing:
		if _screen.is_playing():
			_screen.pause()
		_screen.set_speed_scale(1.0)
		return

	var expected := current_expected_position()
	if not _screen.is_playing():
		_screen.play_from(expected)
		return

	var actual := _screen.playback_position()
	var drift := expected - actual
	if absf(drift) >= HARD_DRIFT_SECONDS:
		_screen.set_playback_position(expected)
		_screen.set_speed_scale(1.0)
	elif absf(drift) >= SOFT_DRIFT_SECONDS:
		_screen.set_speed_scale(clampf(1.0 + drift * 0.06, 1.0 - MAX_SPEED_CORRECTION, 1.0 + MAX_SPEED_CORRECTION))
	else:
		_screen.set_speed_scale(1.0)

func _broadcast_state() -> void:
	if multiplayer.multiplayer_peer == null or not multiplayer.is_server():
		return
	_receive_state.rpc(_media_path, _playing, _anchor_position_seconds, _anchor_server_msec)

func _send_state_to(peer_id: int) -> void:
	if multiplayer.multiplayer_peer == null or not multiplayer.is_server():
		return
	_receive_state.rpc_id(peer_id, _media_path, _playing, _anchor_position_seconds, _anchor_server_msec)

@rpc("any_peer", "call_remote", "reliable")
func _request_set_media(path: String) -> void:
	if multiplayer.is_server():
		_set_media_authoritative(path)

@rpc("any_peer", "call_remote", "reliable")
func _request_set_playing(value: bool) -> void:
	if multiplayer.is_server():
		_set_playing_authoritative(value)

@rpc("authority", "call_remote", "reliable")
func _receive_state(path: String, playing: bool, anchor_position_seconds: float, anchor_server_msec: int) -> void:
	var media_changed := path != _media_path
	_media_path = path
	_playing = playing
	_anchor_position_seconds = maxf(0.0, anchor_position_seconds)
	_anchor_server_msec = anchor_server_msec
	if _screen == null:
		return
	if media_changed and not _media_path.is_empty():
		_screen.set_video(_media_path)
	if not _playing:
		_screen.pause()
		_screen.set_playback_position(_anchor_position_seconds)
	state_changed.emit(_media_path, _playing, _anchor_position_seconds)

func _on_peer_connected(peer_id: int) -> void:
	if multiplayer.is_server():
		_send_state_to(peer_id)

func _server_now_msec() -> int:
	if _clock != null:
		return _clock.server_now_msec()
	return Time.get_ticks_msec()

func _is_authority() -> bool:
	return multiplayer.multiplayer_peer == null or multiplayer.is_server()
