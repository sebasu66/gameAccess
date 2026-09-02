#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{thread, time::Duration};

fn main() {
    if let Err(err) = gameaccess_desktop::local_bridge::start() {
        eprintln!("{err}");
        std::process::exit(1);
    }
    loop { thread::sleep(Duration::from_secs(3600)); }
}
