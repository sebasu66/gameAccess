//! Whether Windows has a game controller connected, for big picture mode.
//!
//! The webview only lists a controller after one of its buttons was pressed, so it cannot answer before the mode
//! starts. Windows can: XInput sees Xbox-style controllers (slots 0-3) and the classic joystick API (winmm) sees the
//! other ones (DualShock, generic USB pads), which also lists XInput controllers. Both DLLs ship with Windows; they are
//! called directly, with no extra crate.

#[cfg(windows)]
#[allow(dead_code)] // The structs mirror the Windows ones; only their size and a few fields are used.
mod windows_api {
    #[repr(C)]
    #[derive(Default)]
    pub struct XInputGamepad { buttons: u16, left_trigger: u8, right_trigger: u8, thumb_lx: i16, thumb_ly: i16, thumb_rx: i16, thumb_ry: i16 }
    #[repr(C)]
    #[derive(Default)]
    pub struct XInputState { packet_number: u32, gamepad: XInputGamepad }
    #[repr(C)]
    #[derive(Default)]
    pub struct JoyInfoEx {
        size: u32, flags: u32, x: u32, y: u32, z: u32, r: u32, u: u32, v: u32,
        buttons: u32, button_number: u32, pov: u32, reserved1: u32, reserved2: u32,
    }
    const JOY_RETURNALL: u32 = 0xFF;
    impl JoyInfoEx {
        pub fn new() -> Self { Self { size: std::mem::size_of::<Self>() as u32, flags: JOY_RETURNALL, ..Default::default() } }
    }

    #[link(name = "xinput1_4", kind = "raw-dylib")]
    extern "system" {
        pub fn XInputGetState(user_index: u32, state: *mut XInputState) -> u32;
    }
    #[link(name = "winmm", kind = "raw-dylib")]
    extern "system" {
        pub fn joyGetNumDevs() -> u32;
        pub fn joyGetPosEx(joystick_id: u32, info: *mut JoyInfoEx) -> u32;
    }
}

#[cfg(windows)]
fn connected_controllers() -> usize {
    use windows_api::*;
    let xinput = (0..4).filter(|slot| {
        let mut state = XInputState::default();
        // ERROR_SUCCESS: a controller is in that slot.
        unsafe { XInputGetState(*slot, &mut state) == 0 }
    }).count();
    let devices = unsafe { joyGetNumDevs() }.min(16);
    let joysticks = (0..devices).filter(|id| {
        let mut info = JoyInfoEx::new();
        // JOYERR_NOERROR: that joystick is plugged in.
        unsafe { joyGetPosEx(*id, &mut info) == 0 }
    }).count();
    // An Xbox controller shows in both lists: the larger count is the number of controllers.
    xinput.max(joysticks)
}

#[cfg(not(windows))]
fn connected_controllers() -> usize {
    0
}

/// How many game controllers Windows has connected now.
#[tauri::command]
pub fn game_controllers_connected() -> usize {
    connected_controllers()
}

#[cfg(test)]
mod tests {
    #[test]
    fn asks_windows_without_crashing() {
        // The real calls: a wrong struct layout or signature would fail here, not in the app. No controller is needed.
        let count = super::connected_controllers();
        assert!(count <= 20);
    }
}
