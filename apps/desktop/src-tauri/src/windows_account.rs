//! Whether the parent's Windows account has a password (vault/Modo niño.md, MN.27): without one, the child can pick
//! the parent's account on the sign-in screen and get in with no limits, so the kid mode wizard advises one. It only
//! advises: nothing of the parent's account is changed.
//!
//! Windows has no call that says it, so the account is asked to sign in with an empty password (`LogonUserW`, a
//! network sign-in that opens no session): "wrong password" (1326) means it has one; success, or "blank passwords are
//! refused here" (1327, `LimitBlankPasswordUse`), means it has none. With a password this counts as one failed try on
//! the account (Windows locks it after 10 in 10 minutes), so it is asked once, when the wizard finishes.

/// `Some(true)`: the account has a password; `Some(false)`: it has none; `None`: it could not be told.
#[tauri::command]
pub async fn windows_account_protected() -> Option<bool> {
    tauri::async_runtime::spawn_blocking(protected).await.ok().flatten()
}

#[cfg(windows)]
fn protected() -> Option<bool> {
    use std::ffi::c_void;
    #[link(name = "advapi32", kind = "raw-dylib")]
    extern "system" {
        fn LogonUserW(user: *const u16, domain: *const u16, password: *const u16, logon_type: u32, provider: u32, token: *mut *mut c_void) -> i32;
    }
    #[link(name = "kernel32", kind = "raw-dylib")]
    extern "system" {
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    const LOGON32_LOGON_NETWORK: u32 = 3;
    const LOGON32_PROVIDER_DEFAULT: u32 = 0;
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let user = wide(&std::env::var("USERNAME").ok()?);
    let domain = wide(&std::env::var("USERDOMAIN").unwrap_or_else(|_| ".".into()));
    let empty = wide("");
    let mut token: *mut c_void = std::ptr::null_mut();
    let signed_in = unsafe { LogonUserW(user.as_ptr(), domain.as_ptr(), empty.as_ptr(), LOGON32_LOGON_NETWORK, LOGON32_PROVIDER_DEFAULT, &mut token) };
    if signed_in != 0 {
        unsafe { CloseHandle(token) };
        return Some(false);
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(1326) => Some(true),
        Some(1327) => Some(false),
        _ => None,
    }
}

#[cfg(not(windows))]
fn protected() -> Option<bool> { None }

#[cfg(all(test, windows))]
mod tests {
    /// Asks about this PC's own account (run by hand: `cargo test windows_account -- --ignored --nocapture`); it counts
    /// as one failed sign-in when the account has a password.
    #[test]
    #[ignore]
    fn tells_this_accounts_password() {
        println!("protected: {:?}", super::protected());
    }
}
