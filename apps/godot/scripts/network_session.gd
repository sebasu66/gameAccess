class_name GameAccessNetworkSession
extends Node

signal session_started(mode: String)
signal connection_failed(message: String)

const DEFAULT_PORT := 31416
const DEFAULT_MAX_CLIENTS := 24

var mode := "offline"
var address := "127.0.0.1"
var port := DEFAULT_PORT

func configure_from_command_line() -> void:
	var should_host := false
	var join_address := ""
	for argument in OS.get_cmdline_user_args():
		if argument == "--host":
			should_host = true
		elif argument.begins_with("--join="):
			join_address = argument.trim_prefix("--join=")
		elif argument.begins_with("--port="):
			port = int(argument.trim_prefix("--port="))

	if should_host:
		start_host(port)
	elif not join_address.is_empty():
		join_host(join_address, port)
	else:
		mode = "offline"
		session_started.emit(mode)

func start_host(listen_port := DEFAULT_PORT) -> Error:
	shutdown()
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_server(listen_port, DEFAULT_MAX_CLIENTS)
	if error != OK:
		connection_failed.emit("Unable to host ENet session on port %d" % listen_port)
		return error
	multiplayer.multiplayer_peer = peer
	port = listen_port
	mode = "host"
	session_started.emit(mode)
	return OK

func join_host(host_address: String, host_port := DEFAULT_PORT) -> Error:
	shutdown()
	var peer := ENetMultiplayerPeer.new()
	var error := peer.create_client(host_address, host_port)
	if error != OK:
		connection_failed.emit("Unable to connect to %s:%d" % [host_address, host_port])
		return error
	multiplayer.multiplayer_peer = peer
	address = host_address
	port = host_port
	mode = "client"
	multiplayer.connected_to_server.connect(_on_connected_to_server, CONNECT_ONE_SHOT)
	multiplayer.connection_failed.connect(_on_connection_failed, CONNECT_ONE_SHOT)
	return OK

func shutdown() -> void:
	if multiplayer.multiplayer_peer != null:
		multiplayer.multiplayer_peer.close()
		multiplayer.multiplayer_peer = null
	mode = "offline"

func is_networked() -> bool:
	return multiplayer.multiplayer_peer != null

func _on_connected_to_server() -> void:
	session_started.emit("client")

func _on_connection_failed() -> void:
	connection_failed.emit("Connection to Game Access host failed")
