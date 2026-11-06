//! Server-verified, bounded access to GameAccess services. No game DRM.
use serde_json::Value;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

const MAX_LEASE: u64 = 300;
const REFRESH: u64 = 60;
pub const DENIED: &str = "GAMEACCESS_ACCESS_DENIED";
pub const UNAVAILABLE: &str = "GAMEACCESS_ACCESS_UNAVAILABLE";
fn activity(message: String, level: &str) {
    let _ = crate::activity_log::append_narration_lines(vec![message], "ACCESS".into(), level.into());
}

#[derive(Clone)]
struct Lease {
    base: String, token: String,
    received: Instant, wall: SystemTime, ttl: Duration,
}
impl Lease {
    fn remaining(&self) -> Duration {
        let elapsed = self.received.elapsed().max(self.wall.elapsed().unwrap_or_default());
        self.ttl.saturating_sub(elapsed)
    }
}
#[derive(Default)]
/// `forget`: the end was asked for (the server said 401, or the app cleared the session), so the saved activation goes
/// too. A lease that only ran out (a renewal missed, the server unreachable for a while) ends access but keeps it: the
/// next check brings PLUS back (Seba, 2026-10-30: a moment without the server erased the activation).
struct State { lease: Option<Lease>, generation: u64, ended: bool, forget: bool }
static STATE: Mutex<State> = Mutex::new(State { lease: None, generation: 0, ended: false, forget: false });
static CHECK: OnceLock<Mutex<()>> = OnceLock::new();

fn trusted_base(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| UNAVAILABLE.to_string())?;
    let development = cfg!(debug_assertions) || option_env!("GAMEACCESS_ALLOW_LOCAL_ACTIVATION") == Some("1");
    let local = development && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    let configured = option_env!("GAMEACCESS_AUTHORITY_URL").unwrap_or("https://gameaccess-api-dev.onrender.com");
    let trusted_remote = url.as_str().trim_end_matches('/') == configured.trim_end_matches('/');
    // Loopback is the existing local development server. Production authority is pinned.
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() ||
        url.fragment().is_some() || !((url.scheme() == "https" && trusted_remote) || (url.scheme() == "http" && local)) {
        return Err(UNAVAILABLE.into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}
fn lifetime(status: &Value) -> Result<Duration, String> {
    if status["active"] != true { return Err(DENIED.into()); }
    let parse = |key: &str| chrono::DateTime::parse_from_rfc3339(status[key].as_str().unwrap_or(""))
        .map_err(|_| DENIED.to_string());
    let now = parse("server_time")?;
    let expiry = parse("expires_at")?;
    let lease_end = if status.get("lease_expires_at").is_some() { parse("lease_expires_at")?.min(expiry) } else { expiry };
    let ms = (lease_end - now).num_milliseconds().clamp(0, (MAX_LEASE * 1000) as i64);
    if ms == 0 { return Err(DENIED.into()); }
    Ok(Duration::from_millis(ms as u64))
}
pub fn clear() {
    if let Ok(mut state) = STATE.lock() {
        let was_active = state.lease.is_some();
        state.lease = None;
        state.generation = state.generation.wrapping_add(1);
        state.ended |= was_active;
        state.forget = true;
    }
}
/// What the server's admin console shows about this installation: app version and the PC's name.
fn client_description() -> String {
    let pc = std::env::var("COMPUTERNAME").unwrap_or_default();
    let name: String = pc.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect();
    format!("GameAccess/{} ({}; PC {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS, if name.is_empty() { "?" } else { &name })
}
pub fn check(base: &str, token: &str) -> Result<Value, String> {
    let _single = CHECK.get_or_init(|| Mutex::new(())).lock().map_err(|_| UNAVAILABLE.to_string())?;
    let base = trusted_base(base).map_err(|error| {activity(format!("Native access check rejected authority; local development enabled={}", cfg!(debug_assertions) || option_env!("GAMEACCESS_ALLOW_LOCAL_ACTIVATION") == Some("1")), "WARN"); error})?;
    if !(20..=200).contains(&token.len()) { return Err(DENIED.into()); }
    let generation = STATE.lock().map_err(|_| UNAVAILABLE.to_string())?.generation;
    let started = Instant::now();
    let mut builder = reqwest::blocking::Client::builder().timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none());
    if base.starts_with("http://") { builder = builder.no_proxy(); }
    let client = builder.build().map_err(|error| {activity(format!("Native access HTTP client failed: {error}"), "ERROR"); UNAVAILABLE.to_string()})?;
    let response = client.get(format!("{base}/activation/status")).bearer_auth(token)
        .header("X-GameAccess-Installation", crate::access_activation::installation_id()?)
        .header("X-GameAccess-Client", client_description())
        .header("Cache-Control", "no-store").send().map_err(|error| {activity(format!("Native access authority request failed: {error}"), "WARN"); UNAVAILABLE.to_string()})?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let detail = response.json::<Value>().ok().and_then(|v|v.get("detail").cloned()).unwrap_or(serde_json::json!({"reason":"unavailable"}));
        clear();
        return Err(format!("{DENIED}:{}", detail));
    }
    if !response.status().is_success() { activity(format!("Native access authority returned HTTP {}", response.status()), "WARN"); return Err(UNAVAILABLE.into()); }
    let status: Value = response.json().map_err(|_| UNAVAILABLE.to_string())?;
    let ttl = lifetime(&status).map_err(|error| {activity("Native access authority returned an invalid or expired grant".into(), "WARN"); error})?.saturating_sub(started.elapsed());
    if ttl.is_zero() { return Err(DENIED.into()); }
    let mut state = STATE.lock().map_err(|_| UNAVAILABLE.to_string())?;
    if generation != state.generation { return Err(DENIED.into()); }
    state.lease = Some(Lease { base, token: token.into(), received: Instant::now(), wall: SystemTime::now(), ttl });
    state.ended = false;
    drop(state);
    activity(format!("Native access verified; grant valid for {} seconds", ttl.as_secs()), "INFO");
    Ok(status)
}
/// Runs `cleanup` once per ended grant, independent of the React view; it is told whether the saved activation goes.
pub fn finish_ended(cleanup: impl FnOnce(bool)) {
    let Ok(mut state) = STATE.lock() else { return };
    if state.lease.as_ref().is_some_and(|lease| lease.remaining().is_zero()) {
        state.lease = None; state.generation = state.generation.wrapping_add(1); state.ended = true;
    }
    if state.ended {
        // Cleanup and emitting the event finish before another grant can be published.
        cleanup(state.forget);
        state.ended = false;
        state.forget = false;
    }
}
#[cfg(test)]
pub fn grant_fixture() {
    STATE.lock().unwrap().lease=Some(Lease{base:String::new(),token:String::new(),received:Instant::now(),wall:SystemTime::now(),ttl:Duration::from_secs(300)});
}
pub fn refresh_due() {
    let lease = STATE.lock().ok().and_then(|state| state.lease.clone());
    if let Some(lease) = lease {
        if lease.received.elapsed() >= Duration::from_secs(REFRESH) && !lease.remaining().is_zero() {
            let _ = check(&lease.base, &lease.token);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lease_is_bounded_by_server_expiry_and_five_minutes() {
        let status = serde_json::json!({"active":true,"server_time":"2026-10-10T00:00:00Z","expires_at":"2026-10-10T00:01:10Z"});
        assert_eq!(lifetime(&status).unwrap(), Duration::from_secs(70));
        let status = serde_json::json!({"active":true,"server_time":"2026-10-10T00:00:00Z","expires_at":"2030-10-10T00:00:00Z"});
        assert_eq!(lifetime(&status).unwrap(), Duration::from_secs(300));
    }
    #[test]
    fn invalid_expired_and_revoked_statuses_never_grant_access() {
        for status in [serde_json::json!({"active":false}),serde_json::json!({"active":true,"expires_at":"bad","server_time":"bad"}),serde_json::json!({"active":true,"server_time":"2026-10-10T00:01:00Z","expires_at":"2026-10-10T00:00:00Z"})] {
            assert!(lifetime(&status).is_err());
        }
    }
    #[test]
    fn cannot_replace_remote_authority_or_send_credentials_to_other_hosts() {
        assert!(trusted_base("https://attacker.example").is_err());
        assert!(trusted_base("http://gameaccess-api-dev.onrender.com").is_err());
        assert!(trusted_base("https://user:secret@gameaccess-api-dev.onrender.com").is_err());
        assert!(trusted_base("https://gameaccess-api-dev.onrender.com").is_ok());
    }
    #[test]
    fn elapsed_permission_cannot_be_extended_by_changing_ui_state() {
        let lease = Lease {base:String::new(),token:String::new(), received:Instant::now()-Duration::from_secs(6),wall:SystemTime::now(),ttl:Duration::from_secs(5)};
        assert!(lease.remaining().is_zero());
    }
}
