use std::{env, ffi::OsString, fs, path::PathBuf};

use tauri::{
    webview::{DownloadEvent, PageLoadEvent, WebviewWindowBuilder},
    Manager, WebviewUrl,
};

const DEFAULT_VIKING_URL: &str = "https://vikingfile.com/f/YLF8EL0zTY";

fn download_dir() -> PathBuf {
    env::var_os("VIKING_PROBE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::temp_dir().join("gameaccess-viking-probe"))
}

fn main() {
    let source_url = env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_VIKING_URL.to_string());
    let target_dir = download_dir();
    fs::create_dir_all(&target_dir).expect("could not create ViKiNG probe download directory");

    println!("VIKING_PROBE source={source_url}");
    println!("VIKING_PROBE download_dir={}", target_dir.display());
    println!("VIKING_PROBE note=The page is loaded in a normal visible Tauri/WebView2 session. The probe does not automate or bypass Cloudflare challenges.");

    tauri::Builder::default()
        .setup(move |app| {
            let external_url = source_url
                .parse()
                .map_err(|err| format!("invalid ViKiNG URL: {err}"))?;
            let download_target = target_dir.clone();

            let _probe = WebviewWindowBuilder::new(
                app,
                "viking-probe",
                WebviewUrl::External(external_url),
            )
            .title("GameAccess - ViKiNG download probe")
            .inner_size(960.0, 720.0)
            .resizable(true)
            .on_page_load(|_, payload| {
                let phase = match payload.event() {
                    PageLoadEvent::Started => "started",
                    PageLoadEvent::Finished => "finished",
                };
                println!("VIKING_PROBE page_{phase} url={}", payload.url());
            })
            .on_download(move |_, event| {
                match event {
                    DownloadEvent::Requested { url, destination } => {
                        let file_name = destination
                            .file_name()
                            .map(OsString::from)
                            .unwrap_or_else(|| OsString::from("viking-download.bin"));
                        let chosen_destination = download_target.join(file_name);
                        println!(
                            "VIKING_PROBE download_requested url={} destination={}",
                            url,
                            chosen_destination.display()
                        );
                        *destination = chosen_destination;
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        println!(
                            "VIKING_PROBE download_finished success={} url={} path={}",
                            success,
                            url,
                            path.display()
                        );
                    }
                    _ => {}
                }
                true
            })
            .build()?;

            if let Some(main_window) = app.get_webview_window("main") {
                main_window.destroy()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ViKiNG WebView probe");
}
