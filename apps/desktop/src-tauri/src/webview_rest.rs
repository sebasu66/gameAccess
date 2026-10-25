//! Game Access rests while the player is not looking at it, with WebView2's own controls (no frame-rate logic of
//! ours): the view is marked not visible, so Chromium stops animation frames, CSS animations and video and throttles
//! timers (the page sees `document.hidden`); WebView2 is asked to keep its memory low; and while a game runs, the
//! page is also suspended (no CPU at all). Tauri does not do this on Windows by itself: its background throttling
//! option is not supported there, and a minimized window does not tell WebView2 it is hidden.
//!
//! It rests when the window is minimized, or while a game runs and Game Access does not have the focus. It wakes as
//! soon as the window is restored or focused, and when the game ends (game_focus.rs). Without a game the page is not
//! suspended, only hidden, so its timers keep running slowly (download notices still arrive).

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tauri::{AppHandle, Manager, Runtime, Window};

static GAME_RUNNING: AtomicBool = AtomicBool::new(false);
/// 0 awake, 1 hidden (minimized), 2 hidden and suspended (a game runs).
static STATE: AtomicU8 = AtomicU8::new(0);
const AWAKE: u8 = 0;
const HIDDEN: u8 = 1;
const SUSPENDED: u8 = 2;

/// What the view should be, from the window's state.
fn wanted(minimized: bool, focused: bool, game_running: bool) -> u8 {
    if game_running && !focused { SUSPENDED } else if minimized { HIDDEN } else { AWAKE }
}

/// A game started (its window appeared) or ended.
pub fn set_game_running<R: Runtime>(app: &AppHandle<R>, running: bool) {
    GAME_RUNNING.store(running, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let minimized = window.is_minimized().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        apply(app, wanted(minimized, focused, running));
    }
}

/// The window changed (focus, size, minimized): rest or wake to match. `focused` comes from a focus event, which is
/// newer than what the window reports while the event is being handled.
pub fn reconcile<R: Runtime>(window: &Window<R>, focused: Option<bool>) {
    if window.label() != "main" { return; }
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = focused.unwrap_or_else(|| window.is_focused().unwrap_or(true));
    apply(window.app_handle(), wanted(minimized, focused, GAME_RUNNING.load(Ordering::SeqCst)));
}

/// Wakes the view now (before telling the page something it must act on).
pub fn wake<R: Runtime>(app: &AppHandle<R>) { apply(app, AWAKE); }

fn apply<R: Runtime>(app: &AppHandle<R>, next: u8) {
    let previous = STATE.swap(next, Ordering::SeqCst);
    if previous == next { return; }
    let Some(webview) = app.get_webview_window("main") else { return; };
    #[cfg(windows)]
    let _ = webview.with_webview(move |platform| unsafe { native::set(&platform.controller(), next) });
    #[cfg(not(windows))]
    let _ = webview;
}

#[cfg(windows)]
mod native {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use webview2_com::TrySuspendCompletedHandler;
    use windows_core::Interface;

    pub unsafe fn set(controller: &ICoreWebView2Controller, state: u8) {
        let core = controller.CoreWebView2().ok();
        let level = |low: bool| if let Some(view) = core.as_ref().and_then(|core| core.cast::<ICoreWebView2_19>().ok()) {
            let _ = view.SetMemoryUsageTargetLevel(if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL });
        };
        let suspendable = core.as_ref().and_then(|core| core.cast::<ICoreWebView2_3>().ok());
        if state == super::AWAKE {
            if let Some(view) = &suspendable { let _ = view.Resume(); }
            level(false);
            let _ = controller.SetIsVisible(true);
            return;
        }
        // TrySuspend needs the view hidden first.
        let _ = controller.SetIsVisible(false);
        level(true);
        if state == super::SUSPENDED {
            if let Some(view) = &suspendable {
                let handler = TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
                let _ = view.TrySuspend(&handler);
            }
        } else if let Some(view) = &suspendable {
            let _ = view.Resume();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rests_only_when_nobody_is_looking() {
        assert_eq!(wanted(false, true, false), AWAKE);
        assert_eq!(wanted(false, false, false), AWAKE, "in the background without a game it stays awake");
        assert_eq!(wanted(true, false, false), HIDDEN);
        assert_eq!(wanted(false, false, true), SUSPENDED, "a game in front of it");
        assert_eq!(wanted(true, false, true), SUSPENDED);
        assert_eq!(wanted(false, true, true), AWAKE, "the player came back to it during the game");
    }
}
