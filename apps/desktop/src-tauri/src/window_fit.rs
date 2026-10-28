//! The window keeps the size the player gave it through a game.
//!
//! Some games lower the monitor's resolution while they run and put it back when they close. Windows shrinks a
//! maximized window to the smaller screen, but does not grow it again when the resolution comes back: the window stays
//! small while it still counts as maximized. Then the Maximize button seemed not to work (its first click "restored"
//! the window, only the second one maximized it).
//!
//! So: when a game starts, how the window was is remembered (maximized, fullscreen); when it ends, the window goes back
//! to it. And whenever the window is maximized or fullscreen but does not fill its screen, it is fitted again (on
//! focus, at the end of a game, and before the Maximize button decides what to do).

use std::sync::Mutex;
use tauri::{Manager, Monitor, PhysicalSize, Runtime, WebviewWindow, Window};

/// What is needed from a window; both kinds of Tauri window have it (the event handler gets a `Window`, the app hands
/// out `WebviewWindow`s).
pub trait Frame {
    fn maximized(&self) -> bool;
    fn fullscreen(&self) -> bool;
    fn size(&self) -> Option<PhysicalSize<u32>>;
    fn monitor(&self) -> Option<Monitor>;
    fn set_maximized(&self, on: bool);
    fn set_full(&self, on: bool);
}
macro_rules! frame {
    ($kind:ident) => {
        impl<R: Runtime> Frame for $kind<R> {
            fn maximized(&self) -> bool { self.is_maximized().unwrap_or(false) }
            fn fullscreen(&self) -> bool { self.is_fullscreen().unwrap_or(false) }
            fn size(&self) -> Option<PhysicalSize<u32>> { self.outer_size().ok() }
            fn monitor(&self) -> Option<Monitor> { self.current_monitor().ok().flatten() }
            fn set_maximized(&self, on: bool) { let _ = if on { self.maximize() } else { self.unmaximize() }; }
            fn set_full(&self, on: bool) { let _ = self.set_fullscreen(on); }
        }
    };
}
frame!(Window);
frame!(WebviewWindow);

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Placement { maximized: bool, fullscreen: bool }

/// How the window was when the current game started.
static BEFORE_GAME: Mutex<Option<Placement>> = Mutex::new(None);
/// A maximized window may hang a few pixels over the work area, or fall that short: only a real gap counts.
const SLACK: u32 = 8;

/// Whether a window of `size` is short of `area` (both width, height) by more than the slack.
fn short_of(size: (u32, u32), area: (u32, u32)) -> bool {
    size.0 + SLACK < area.0 || size.1 + SLACK < area.1
}

fn placement(window: &impl Frame) -> Placement {
    Placement { maximized: window.maximized(), fullscreen: window.fullscreen() }
}

/// Fits a maximized or fullscreen window that does not fill its screen (the resolution grew back after a game).
/// A window the player left restored is not touched. Returns whether it had to fit it.
pub fn refit(window: &impl Frame) -> bool {
    let Some(monitor) = window.monitor() else { return false };
    let Some(size) = window.size() else { return false };
    let now = placement(window);
    if now.fullscreen {
        let screen = monitor.size();
        if !short_of((size.width, size.height), (screen.width, screen.height)) { return false; }
        window.set_full(false);
        window.set_full(true);
        return true;
    }
    if now.maximized {
        let area = monitor.work_area().size;
        if !short_of((size.width, size.height), (area.width, area.height)) { return false; }
        window.set_maximized(false);
        window.set_maximized(true);
        return true;
    }
    false
}

/// A game starts: remember how the window is now.
pub fn remember(window: &impl Frame) {
    if let Ok(mut saved) = BEFORE_GAME.lock() { *saved = Some(placement(window)); }
}

/// The game ended: the window goes back to how it was before it (maximized or fullscreen), filling the screen.
pub fn restore(window: &impl Frame) {
    let before = BEFORE_GAME.lock().ok().and_then(|mut saved| saved.take());
    if let Some(before) = before {
        let now = placement(window);
        if before.fullscreen && !now.fullscreen { window.set_full(true); }
        else if before.maximized && !now.maximized && !now.fullscreen { window.set_maximized(true); }
    }
    refit(window);
}

/// The window's own background (tauri.conf.json, #07090d) and the gate leaves' metal (splash-screen.css).
const WINDOW_BACKGROUND: tauri::window::Color = tauri::window::Color(7, 9, 13, 255);
const GATE_METAL: tauri::window::Color = tauri::window::Color(31, 36, 41, 255);

/// How the window was before big picture mode, to leave it the same way.
static BEFORE_BIG_SCREEN: Mutex<Option<Placement>> = Mutex::new(None);

/// Big picture mode is the whole screen, taskbar included. A maximized window is restored first: made fullscreen
/// while maximized, Windows keeps it at the work area's size and the taskbar stays on top of it. Leaving the mode puts
/// it back as it was. Returns whether the window is fullscreen afterwards.
#[tauri::command]
pub fn window_set_big_screen<R: Runtime>(app: tauri::AppHandle<R>, window: Window<R>, on: bool) -> bool {
    // While Windows resizes the window, the part the page has not repainted yet shows the window's own background:
    // during the change it is the gunmetal of the gate's leaves instead of near black, so no dark gap flashes; it goes
    // back once the change is surely over.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_background_color(Some(GATE_METAL));
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2500));
            let _ = main.set_background_color(Some(WINDOW_BACKGROUND));
        });
    }
    if on {
        let now = placement(&window);
        if let Ok(mut saved) = BEFORE_BIG_SCREEN.lock() { if saved.is_none() { *saved = Some(now); } }
        if now.fullscreen { refit(&window); return true; }
        if now.maximized { window.set_maximized(false); }
        window.set_full(true);
    } else {
        let before = BEFORE_BIG_SCREEN.lock().ok().and_then(|mut saved| saved.take()).unwrap_or_default();
        if !before.fullscreen {
            window.set_full(false);
            if before.maximized { window.set_maximized(true); }
        }
    }
    window.fullscreen()
}

/// The window's Maximize button. A window that counts as maximized but does not fill the screen is maximized properly
/// instead of being restored. Returns whether the window is maximized afterwards.
#[tauri::command]
pub fn window_toggle_maximize<R: Runtime>(window: Window<R>) -> bool {
    if refit(&window) { return true; }
    window.set_maximized(!window.maximized());
    window.maximized()
}

#[cfg(test)]
mod tests {
    use super::short_of;

    #[test]
    fn only_a_real_gap_counts_as_not_filling_the_screen() {
        // Maximized on a 1920 x 1080 screen with a 40 px taskbar: the window hangs 8 px over each side, or is exact.
        assert!(!short_of((1936, 1056), (1920, 1040)));
        assert!(!short_of((1920, 1040), (1920, 1040)));
        // Left from a 1280 x 720 game on the same screen.
        assert!(short_of((1296, 696), (1920, 1040)));
        // Only shorter in height.
        assert!(short_of((1920, 700), (1920, 1040)));
    }
}
