class_name GameAccessNetworkClock
extends Node

const SERVER_PEER_ID := 1
const RESYNC_INTERVAL_SECONDS := 1.0
const OFFSET_SMOOTHING := 0.2

var _server_offset_msec := 0.0
var _resync_elapsed := 0.0
var _has_sample := false

func _process(delta: float) -> void:
	if multiplayer.multiplayer_peer == null or multiplayer.is_server():
		return
	_resync_elapsed += delta
	if _resync_elapsed >= RESYNC_INTERVAL_SECONDS:
		_resync_elapsed = 0.0
		_request_sample()

func server_now_msec() -> int:
	if multiplayer.multiplayer_peer == null or multiplayer.is_server():
		return Time.get_ticks_msec()
	return int(round(float(Time.get_ticks_msec()) + _server_offset_msec))

func has_clock_sample() -> bool:
	return multiplayer.is_server() or _has_sample

func request_immediate_sync() -> void:
	if multiplayer.multiplayer_peer != null and not multiplayer.is_server():
		_request_sample()

func _request_sample() -> void:
	_clock_ping.rpc_id(SERVER_PEER_ID, Time.get_ticks_msec())

@rpc("any_peer", "call_remote", "unreliable")
func _clock_ping(client_sent_msec: int) -> void:
	if not multiplayer.is_server():
		return
	var sender_id := multiplayer.get_remote_sender_id()
	_clock_pong.rpc_id(sender_id, client_sent_msec, Time.get_ticks_msec())

@rpc("authority", "call_remote", "unreliable")
func _clock_pong(client_sent_msec: int, server_msec: int) -> void:
	var client_received_msec := Time.get_ticks_msec()
	var round_trip_msec := max(0, client_received_msec - client_sent_msec)
	var estimated_client_at_server_reply := float(client_sent_msec) + float(round_trip_msec) * 0.5
	var sample_offset := float(server_msec) - estimated_client_at_server_reply
	if not _has_sample:
		_server_offset_msec = sample_offset
		_has_sample = true
	else:
		_server_offset_msec = lerpf(_server_offset_msec, sample_offset, OFFSET_SMOOTHING)
