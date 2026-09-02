extends Node3D

@onready var xr_origin: XROrigin3D = $XROrigin3D
@onready var desktop_camera: Camera3D = $DesktopCamera3D
@onready var status_label: Label = $CanvasLayer/Status

var xr_interface: XRInterface

func _ready() -> void:
    xr_interface = XRServer.find_interface("OpenXR")

    if xr_interface and xr_interface.is_initialized():
        _enable_xr()
        return

    if xr_interface and xr_interface.initialize():
        _enable_xr()
        return

    _enable_desktop_fallback()

func _enable_xr() -> void:
    get_viewport().use_xr = true
    desktop_camera.current = false
    status_label.text = "OpenXR activo - Quest/PCVR"
    print("Game Access XR: OpenXR initialized")

func _enable_desktop_fallback() -> void:
    get_viewport().use_xr = false
    desktop_camera.current = true
    status_label.text = "OpenXR no detectado - modo desktop de diagnóstico"
    push_warning("Game Access XR: OpenXR runtime not available; using desktop fallback")

func _unhandled_input(event: InputEvent) -> void:
    if event.is_action_pressed("ui_cancel"):
        get_tree().quit()
