fn main() {
    // The window and the .exe carry icons/icon.ico as a compiled resource; tauri-build does not watch it, so a new icon
    // would keep the old one until something else made this script run again.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
