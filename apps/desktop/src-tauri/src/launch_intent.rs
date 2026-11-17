use std::sync::Mutex;
static PENDING: Mutex<Option<u32>> = Mutex::new(None);
pub fn parse(args: &[String]) -> Option<u32> {
    args.windows(2).find(|pair| pair[0] == "--launch-game")
        .and_then(|pair| pair[1].parse::<u32>().ok()).filter(|id| *id > 0)
}
pub fn receive(args: &[String]) {
    if let Some(id) = parse(args) { if let Ok(mut pending) = PENDING.lock() { *pending = Some(id); } }
}
#[tauri::command]
pub fn take_launch_request() -> Result<Option<u32>, String> {
    Ok(PENDING.lock().map_err(|_| "Launch request is unavailable")?.take())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_arguments_accept_only_a_game_id() {
        assert_eq!(parse(&["ga.exe".into(),"--launch-game".into(),"1426210".into()]),Some(1426210));
        for value in ["0","-1","../game.exe","1 & calc","4294967296"] {
            assert_eq!(parse(&["ga.exe".into(),"--launch-game".into(),value.into()]),None);
        }
    }
}
