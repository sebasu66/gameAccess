use serde::Serialize;
use std::{
    fs::File,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    utils::config::WebviewUrl,
    webview::{DownloadEvent, PageLoadEvent, WebviewWindowBuilder},
};

const DEFAULT_URL: &str = "https://vikingfile.com/f/YLF8EL0zTY";

#[derive(Debug, Clone, Serialize)]
struct LoadRecord {
    event: String,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadRecord {
    url: String,
    path: Option<String>,
    success: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ProbeState {
    started_unix_ms: u128,
    initial_url: String,
    navigations: Vec<String>,
    titles: Vec<String>,
    page_loads: Vec<LoadRecord>,
    download_requested: Option<DownloadRecord>,
    download_finished: Option<DownloadRecord>,
    timed_out: bool,
}

impl ProbeState {
    fn new(initial_url: String) -> Self {
        Self {
            started_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            initial_url,
            navigations: Vec::new(),
            titles: Vec::new(),
            page_loads: Vec::new(),
            download_requested: None,
            download_finished: None,
            timed_out: false,
        }
    }
}

fn arg_value(flag: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| pair[1].clone())
}

fn write_report(state: &Arc<Mutex<ProbeState>>, path: &PathBuf) {
    let Ok(state) = state.lock() else {
        eprintln!("[probe] could not lock report state");
        return;
    };
    let Ok(file) = File::create(path) else {
        eprintln!("[probe] could not create report {}", path.display());
        return;
    };
    if let Err(error) = serde_json::to_writer_pretty(file, &*state) {
        eprintln!("[probe] could not serialize report: {error}");
    } else {
        println!("[probe] report={}", path.display());
    }
}

fn main() {
    let initial_url = arg_value("--url").unwrap_or_else(|| DEFAULT_URL.to_string());
    let timeout_secs = arg_value("--timeout")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(60);
    let report_path = arg_value("--report")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("viking-webview-probe.json"));
    let download_path = arg_value("--download")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("gameaccess-viking-probe-download.bin"));

    let parsed_url = initial_url
        .parse()
        .expect("--url must be an absolute http(s) URL");
    let state = Arc::new(Mutex::new(ProbeState::new(initial_url.clone())));

    println!("[probe] opening {initial_url}");
    println!("[probe] download destination={}", download_path.display());
    println!("[probe] timeout={timeout_secs}s");

    tauri::Builder::default()
        .setup(move |app| {
            let nav_state = Arc::clone(&state);
            let title_state = Arc::clone(&state);
            let load_state = Arc::clone(&state);
            let download_state = Arc::clone(&state);
            let download_finished_state = Arc::clone(&state);
            let timeout_state = Arc::clone(&state);
            let timeout_report = report_path.clone();
            let finished_report = report_path.clone();
            let requested_path = download_path.clone();
            let finished_handle = app.handle().clone();
            let timeout_handle = app.handle().clone();

            WebviewWindowBuilder::new(app, "viking-probe", WebviewUrl::External(parsed_url))
                .title("GameAccess - ViKiNG verification probe")
                .inner_size(760.0, 860.0)
                .center()
                .on_navigation(move |url| {
                    println!("[probe] navigation {url}");
                    if let Ok(mut state) = nav_state.lock() {
                        state.navigations.push(url.to_string());
                    }
                    true
                })
                .on_document_title_changed(move |_window, title| {
                    println!("[probe] title {title}");
                    if let Ok(mut state) = title_state.lock() {
                        state.titles.push(title);
                    }
                })
                .on_page_load(move |_window, payload| {
                    let event = match payload.event() {
                        PageLoadEvent::Started => "started",
                        PageLoadEvent::Finished => "finished",
                    };
                    println!("[probe] page-{event} {}", payload.url());
                    if let Ok(mut state) = load_state.lock() {
                        state.page_loads.push(LoadRecord {
                            event: event.to_string(),
                            url: payload.url().to_string(),
                        });
                    }
                })
                .on_download(move |_webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            println!("[probe] download-requested {url}");
                            *destination = requested_path.clone();
                            if let Ok(mut state) = download_state.lock() {
                                state.download_requested = Some(DownloadRecord {
                                    url: url.to_string(),
                                    path: Some(requested_path.to_string_lossy().to_string()),
                                    success: None,
                                });
                            }
                        }
                        DownloadEvent::Finished { url, path, success } => {
                            let path_text = path
                                .as_ref()
                                .map(|value| value.to_string_lossy().to_string());
                            println!(
                                "[probe] download-finished url={url} path={} success={success}",
                                path_text.as_deref().unwrap_or("<none>")
                            );
                            if let Ok(mut state) = download_finished_state.lock() {
                                state.download_finished = Some(DownloadRecord {
                                    url: url.to_string(),
                                    path: path_text,
                                    success: Some(success),
                                });
                            }
                            write_report(&download_finished_state, &finished_report);
                            finished_handle.exit(if success { 0 } else { 2 });
                        }
                        _ => {}
                    }
                    true
                })
                .build()?;

            thread::spawn(move || {
                thread::sleep(Duration::from_secs(timeout_secs));
                if let Ok(mut state) = timeout_state.lock() {
                    state.timed_out = true;
                }
                write_report(&timeout_state, &timeout_report);
                timeout_handle.exit(0);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ViKiNG WebView probe failed");
}
