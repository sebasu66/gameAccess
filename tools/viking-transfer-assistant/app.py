from __future__ import annotations

import os
import queue
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

APP_DIR = Path(__file__).resolve().parent
REPO_ROOT = APP_DIR.parents[1]
TRANSFER_CORE_DIR = REPO_ROOT / "tools" / "torrent-transfer-prototype"
PROBE_EXE = (
    REPO_ROOT
    / "tools"
    / "viking-webview-probe"
    / "target"
    / "release"
    / "viking-webview-probe.exe"
)

sys.path.insert(0, str(TRANSFER_CORE_DIR))

from transfer_core import (  # noqa: E402
    CancelledError,
    TransferOrchestrator,
    default_real_debrid_token,
    default_viking_user_hash,
)

MAX_TORRENT_METADATA_BYTES = 10 * 1024 * 1024


def human_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def is_http_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(value)
        return parsed.scheme.lower() in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


def fetch_torrent_metadata(url: str, log) -> Path:
    """Download only a .torrent metadata file, never the torrent payload."""
    log(f"Fetching torrent metadata URL: {url}")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "GameAccess-ViKiNG-Transfer-Assistant/0.1"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        content_type = str(response.headers.get("Content-Type") or "").lower()
        body = response.read(MAX_TORRENT_METADATA_BYTES + 1)

    if len(body) > MAX_TORRENT_METADATA_BYTES:
        raise RuntimeError("Torrent metadata URL returned more than 10 MB; refusing to treat it as a .torrent file.")
    if not body:
        raise RuntimeError("Torrent metadata URL returned an empty response.")
    if "text/html" in content_type or body.lstrip().startswith((b"<html", b"<!doctype", b"<HTML", b"<!DOCTYPE")):
        raise RuntimeError(
            "That URL appears to be a web page, not a direct .torrent download. Paste the magnet link or the direct .torrent URL."
        )
    if not body.startswith(b"d"):
        raise RuntimeError("The downloaded data does not look like bencoded .torrent metadata.")

    handle = tempfile.NamedTemporaryFile(prefix="gameaccess-url-", suffix=".torrent", delete=False)
    try:
        handle.write(body)
        handle.flush()
        path = Path(handle.name)
    finally:
        handle.close()
    log(f"Torrent metadata ready: {path} ({human_bytes(path.stat().st_size)})")
    return path


class TransferAssistant(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("GameAccess — Torrent ↔ ViKiNG Test Assistant")
        self.geometry("980x760")
        self.minsize(820, 650)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.upload_cancel = threading.Event()
        self.upload_worker: threading.Thread | None = None
        self.download_worker: threading.Thread | None = None
        self.download_process: subprocess.Popen[str] | None = None

        self.source_var = tk.StringVar()
        self.selection_var = tk.StringVar(value="Largest file")
        self.rd_token_var = tk.StringVar(value=default_real_debrid_token())
        self.viking_hash_var = tk.StringVar(value=default_viking_user_hash())
        self.upload_stage_var = tk.StringVar(value="Idle")
        self.upload_progress_var = tk.DoubleVar(value=0)
        self.final_link_var = tk.StringVar()
        self.final_filename = ""

        self.download_url_var = tk.StringVar()
        self.download_dest_var = tk.StringVar(value=str(Path.home() / "Downloads" / "viking-download.bin"))
        self.download_stage_var = tk.StringVar(value="Idle")
        self.download_progress_var = tk.DoubleVar(value=0)

        self._build()
        self.after(100, self._drain_events)

    def _build(self) -> None:
        outer = ttk.Frame(self, padding=14)
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(1, weight=1)

        ttk.Label(
            outer,
            text="Two independent tests: upload a torrent to ViKiNG, then download a ViKiNG link to this PC.",
            font=("", 11, "bold"),
        ).grid(row=0, column=0, sticky="w", pady=(0, 10))

        notebook = ttk.Notebook(outer)
        notebook.grid(row=1, column=0, sticky="nsew")

        self.upload_tab = ttk.Frame(notebook, padding=14)
        self.download_tab = ttk.Frame(notebook, padding=14)
        notebook.add(self.upload_tab, text="1. Torrent → ViKiNG")
        notebook.add(self.download_tab, text="2. ViKiNG → PC")
        self.notebook = notebook

        self._build_upload_tab()
        self._build_download_tab()

        ttk.Label(
            outer,
            text="Use only files you are authorized to download, store, and redistribute.",
        ).grid(row=2, column=0, sticky="w", pady=(10, 0))

    def _build_upload_tab(self) -> None:
        tab = self.upload_tab
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(7, weight=1)

        ttk.Label(tab, text="Torrent source", font=("", 11, "bold")).grid(row=0, column=0, sticky="w")
        source_row = ttk.Frame(tab)
        source_row.grid(row=1, column=0, sticky="ew", pady=(6, 4))
        source_row.columnconfigure(0, weight=1)
        ttk.Entry(source_row, textvariable=self.source_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(source_row, text="Browse .torrent…", command=self._browse_torrent).grid(row=0, column=1, padx=(8, 0))

        ttk.Label(
            tab,
            text="Accepted: magnet link, local .torrent path, or direct http(s) URL to a .torrent file.",
        ).grid(row=2, column=0, sticky="w", pady=(0, 12))

        options = ttk.LabelFrame(tab, text="Upload options", padding=10)
        options.grid(row=3, column=0, sticky="ew")
        options.columnconfigure(1, weight=1)
        options.columnconfigure(3, weight=1)

        ttk.Label(options, text="Torrent files").grid(row=0, column=0, sticky="w", padx=(0, 8))
        ttk.Combobox(
            options,
            textvariable=self.selection_var,
            state="readonly",
            values=["Largest file", "All files"],
        ).grid(row=0, column=1, sticky="ew")

        ttk.Label(options, text="Destination").grid(row=0, column=2, sticky="w", padx=(18, 8))
        ttk.Label(options, text="ViKiNG FiLE (anonymous remote upload)").grid(row=0, column=3, sticky="w")

        ttk.Label(options, text="Real-Debrid token").grid(row=1, column=0, sticky="w", pady=(10, 0), padx=(0, 8))
        ttk.Entry(options, textvariable=self.rd_token_var, show="•").grid(
            row=1, column=1, columnspan=3, sticky="ew", pady=(10, 0)
        )

        ttk.Label(options, text="ViKiNG user hash (optional)").grid(row=2, column=0, sticky="w", pady=(8, 0), padx=(0, 8))
        ttk.Entry(options, textvariable=self.viking_hash_var).grid(
            row=2, column=1, columnspan=3, sticky="ew", pady=(8, 0)
        )

        actions = ttk.Frame(tab)
        actions.grid(row=4, column=0, sticky="ew", pady=12)
        self.upload_start_button = ttk.Button(actions, text="Start Torrent → ViKiNG", command=self._start_upload)
        self.upload_start_button.pack(side="left")
        self.upload_cancel_button = ttk.Button(actions, text="Cancel", command=self._cancel_upload, state="disabled")
        self.upload_cancel_button.pack(side="left", padx=(8, 0))

        final_box = ttk.LabelFrame(tab, text="Final ViKiNG link", padding=10)
        final_box.grid(row=5, column=0, sticky="ew")
        final_box.columnconfigure(0, weight=1)
        ttk.Entry(final_box, textvariable=self.final_link_var, state="readonly").grid(row=0, column=0, sticky="ew")
        ttk.Button(final_box, text="Copy", command=self._copy_final_link).grid(row=0, column=1, padx=(8, 0))
        ttk.Button(final_box, text="Use in Download tab", command=self._send_link_to_download).grid(row=0, column=2, padx=(8, 0))

        status = ttk.LabelFrame(tab, text="Upload status", padding=10)
        status.grid(row=6, column=0, sticky="ew", pady=(12, 0))
        status.columnconfigure(0, weight=1)
        ttk.Label(status, textvariable=self.upload_stage_var).grid(row=0, column=0, sticky="w")
        ttk.Progressbar(status, variable=self.upload_progress_var, maximum=100).grid(row=1, column=0, sticky="ew", pady=(8, 0))

        log_box = ttk.LabelFrame(tab, text="Upload log", padding=8)
        log_box.grid(row=7, column=0, sticky="nsew", pady=(12, 0))
        log_box.columnconfigure(0, weight=1)
        log_box.rowconfigure(0, weight=1)
        self.upload_log = tk.Text(log_box, wrap="word", state="disabled", height=15)
        self.upload_log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(log_box, command=self.upload_log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.upload_log.configure(yscrollcommand=scroll.set)

    def _build_download_tab(self) -> None:
        tab = self.download_tab
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(6, weight=1)

        ttk.Label(tab, text="ViKiNG file link", font=("", 11, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Entry(tab, textvariable=self.download_url_var).grid(row=1, column=0, sticky="ew", pady=(6, 12))

        dest_box = ttk.LabelFrame(tab, text="Local destination", padding=10)
        dest_box.grid(row=2, column=0, sticky="ew")
        dest_box.columnconfigure(0, weight=1)
        ttk.Entry(dest_box, textvariable=self.download_dest_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(dest_box, text="Choose…", command=self._browse_download_destination).grid(row=0, column=1, padx=(8, 0))

        actions = ttk.Frame(tab)
        actions.grid(row=3, column=0, sticky="ew", pady=12)
        self.download_start_button = ttk.Button(actions, text="Start automatic ViKiNG download", command=self._start_download)
        self.download_start_button.pack(side="left")
        self.download_cancel_button = ttk.Button(actions, text="Cancel", command=self._cancel_download, state="disabled")
        self.download_cancel_button.pack(side="left", padx=(8, 0))

        status = ttk.LabelFrame(tab, text="Download status", padding=10)
        status.grid(row=4, column=0, sticky="ew")
        status.columnconfigure(0, weight=1)
        ttk.Label(status, textvariable=self.download_stage_var).grid(row=0, column=0, sticky="w")
        self.download_progress = ttk.Progressbar(status, variable=self.download_progress_var, maximum=100, mode="determinate")
        self.download_progress.grid(row=1, column=0, sticky="ew", pady=(8, 0))

        ttk.Label(
            tab,
            text=f"Downloader: {PROBE_EXE}",
        ).grid(row=5, column=0, sticky="w", pady=(10, 0))

        log_box = ttk.LabelFrame(tab, text="Download log", padding=8)
        log_box.grid(row=6, column=0, sticky="nsew", pady=(12, 0))
        log_box.columnconfigure(0, weight=1)
        log_box.rowconfigure(0, weight=1)
        self.download_log = tk.Text(log_box, wrap="word", state="disabled", height=16)
        self.download_log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(log_box, command=self.download_log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.download_log.configure(yscrollcommand=scroll.set)

    def _timestamped_append(self, widget: tk.Text, line: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        widget.configure(state="normal")
        widget.insert("end", f"[{timestamp}] {line}\n")
        widget.see("end")
        widget.configure(state="disabled")

    def _upload_append(self, line: str) -> None:
        self._timestamped_append(self.upload_log, line)

    def _download_append(self, line: str) -> None:
        self._timestamped_append(self.download_log, line)

    def _browse_torrent(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose torrent",
            filetypes=[("Torrent files", "*.torrent"), ("All files", "*.*")],
        )
        if path:
            self.source_var.set(path)

    def _browse_download_destination(self) -> None:
        current = Path(self.download_dest_var.get().strip() or (Path.home() / "Downloads" / "viking-download.bin"))
        path = filedialog.asksaveasfilename(
            title="Choose download destination",
            initialdir=str(current.parent),
            initialfile=current.name,
        )
        if path:
            self.download_dest_var.set(path)

    def _copy_final_link(self) -> None:
        link = self.final_link_var.get().strip()
        if not link:
            messagebox.showinfo("No final link", "Complete an upload first.")
            return
        self.clipboard_clear()
        self.clipboard_append(link)
        self.update()
        self._upload_append("Final ViKiNG link copied to clipboard.")

    def _send_link_to_download(self) -> None:
        link = self.final_link_var.get().strip()
        if not link:
            messagebox.showinfo("No final link", "Complete an upload first.")
            return
        self.download_url_var.set(link)
        if self.final_filename:
            self.download_dest_var.set(str(Path.home() / "Downloads" / self.final_filename))
        self.notebook.select(self.download_tab)

    def _start_upload(self) -> None:
        source = self.source_var.get().strip()
        token = self.rd_token_var.get().strip()
        viking_hash = self.viking_hash_var.get().strip()
        selection_mode = "all" if self.selection_var.get() == "All files" else "largest"

        if not source:
            messagebox.showerror("Missing torrent", "Paste a magnet, local .torrent path, or direct .torrent URL.")
            return
        if not token:
            messagebox.showerror("Missing Real-Debrid token", "A Real-Debrid Premium API token is required by this prototype.")
            return

        self.upload_cancel.clear()
        self.upload_progress_var.set(0)
        self.upload_stage_var.set("Starting…")
        self.final_link_var.set("")
        self.final_filename = ""
        self.upload_start_button.configure(state="disabled")
        self.upload_cancel_button.configure(state="normal")
        self._upload_append("Starting Torrent → ViKiNG flow.")

        def status_callback(event: dict) -> None:
            self.events.put(("upload-status", event))

        def work() -> None:
            temporary_source: Path | None = None
            try:
                prepared_source = source
                if is_http_url(source):
                    temporary_source = fetch_torrent_metadata(
                        source,
                        lambda line: self.events.put(("upload-line", line)),
                    )
                    prepared_source = str(temporary_source)

                orchestrator = TransferOrchestrator(
                    token,
                    "ViKiNG FiLE (anonymous)",
                    viking_user_hash=viking_hash,
                )
                result = orchestrator.run(
                    prepared_source,
                    selection_mode=selection_mode,
                    callback=status_callback,
                    cancel_event=self.upload_cancel,
                )
                self.events.put(("upload-done", result))
            except CancelledError as exc:
                self.events.put(("upload-cancelled", str(exc)))
            except Exception as exc:
                self.events.put(("upload-error", f"{type(exc).__name__}: {exc}"))
            finally:
                if temporary_source:
                    try:
                        temporary_source.unlink(missing_ok=True)
                    except Exception:
                        pass

        self.upload_worker = threading.Thread(target=work, daemon=True)
        self.upload_worker.start()

    def _cancel_upload(self) -> None:
        self.upload_cancel.set()
        self.upload_cancel_button.configure(state="disabled")
        self._upload_append("Cancellation requested.")

    def _finish_upload_ui(self) -> None:
        self.upload_start_button.configure(state="normal")
        self.upload_cancel_button.configure(state="disabled")

    def _start_download(self) -> None:
        url = self.download_url_var.get().strip()
        destination = Path(self.download_dest_var.get().strip()).expanduser()

        if not is_http_url(url):
            messagebox.showerror("Invalid ViKiNG link", "Paste an http(s) ViKiNG file link.")
            return
        if not str(destination):
            messagebox.showerror("Missing destination", "Choose a local destination file.")
            return
        if not PROBE_EXE.is_file():
            messagebox.showerror(
                "Downloader not built",
                f"The Tauri downloader is missing:\n{PROBE_EXE}\n\nRun tools\\viking-transfer-assistant\\run.cmd; it builds the probe automatically.",
            )
            return
        if destination.exists() and not messagebox.askyesno("Overwrite file?", f"Replace existing file?\n{destination}"):
            return

        destination.parent.mkdir(parents=True, exist_ok=True)
        report_path = destination.with_name(destination.name + ".viking-report.json")
        self.download_progress.configure(mode="indeterminate")
        self.download_progress.start(12)
        self.download_progress_var.set(0)
        self.download_stage_var.set("Opening ViKiNG…")
        self.download_start_button.configure(state="disabled")
        self.download_cancel_button.configure(state="normal")
        self._download_append(f"Starting automatic download: {url}")
        self._download_append(f"Destination: {destination}")

        def work() -> None:
            success_marker = False
            try:
                argv = [
                    str(PROBE_EXE),
                    "--url",
                    url,
                    "--timeout",
                    "600",
                    "--report",
                    str(report_path),
                    "--download",
                    str(destination),
                ]
                process = subprocess.Popen(
                    argv,
                    cwd=str(REPO_ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                )
                self.download_process = process
                assert process.stdout is not None
                for raw in process.stdout:
                    line = raw.rstrip("\r\n")
                    if "download-finished" in line and "success=true" in line:
                        success_marker = True
                    self.events.put(("download-line", line))
                code = process.wait()
                size = destination.stat().st_size if destination.exists() else 0
                self.events.put(
                    (
                        "download-done",
                        {
                            "code": code,
                            "success": success_marker and destination.exists(),
                            "path": str(destination),
                            "size": size,
                            "report": str(report_path),
                        },
                    )
                )
            except Exception as exc:
                self.events.put(("download-error", f"{type(exc).__name__}: {exc}"))
            finally:
                self.download_process = None

        self.download_worker = threading.Thread(target=work, daemon=True)
        self.download_worker.start()

    def _cancel_download(self) -> None:
        process = self.download_process
        if process and process.poll() is None:
            try:
                process.terminate()
                self._download_append("Download process termination requested.")
            except Exception as exc:
                self._download_append(f"Could not terminate downloader: {exc}")
        self.download_cancel_button.configure(state="disabled")

    def _finish_download_ui(self) -> None:
        self.download_progress.stop()
        self.download_progress.configure(mode="determinate")
        self.download_start_button.configure(state="normal")
        self.download_cancel_button.configure(state="disabled")

    def _handle_download_line(self, line: str) -> None:
        self._download_append(line)
        if "title GA_PROBE:click:" in line:
            self.download_stage_var.set("Advancing ViKiNG download flow…")
        elif "download-requested" in line:
            self.download_stage_var.set("Downloading…")
        elif "download-progress" in line and " len=" in line:
            try:
                length = int(line.rsplit(" len=", 1)[1].split()[0])
                self.download_stage_var.set(f"Downloading — {human_bytes(length)} received")
            except Exception:
                pass
        elif "download-finished" in line and "success=true" in line:
            self.download_stage_var.set("Download complete")

    def _drain_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()

                if kind == "upload-line":
                    self._upload_append(str(payload))
                elif kind == "upload-status":
                    event = dict(payload)
                    message = str(event.get("message") or event.get("stage") or "Working…")
                    self.upload_stage_var.set(message)
                    if event.get("progress") is not None:
                        self.upload_progress_var.set(float(event["progress"]))
                    self._upload_append(message)
                elif kind == "upload-done":
                    result = dict(payload)
                    files = result.get("files") or []
                    if files:
                        first = files[0]
                        self.final_link_var.set(str(first.get("url") or ""))
                        self.final_filename = str(first.get("filename") or "")
                        self.download_url_var.set(self.final_link_var.get())
                        if self.final_filename:
                            self.download_dest_var.set(str(Path.home() / "Downloads" / self.final_filename))
                    self.upload_progress_var.set(100)
                    self.upload_stage_var.set(f"Complete — {len(files)} ViKiNG link(s)")
                    self._upload_append("UPLOAD COMPLETE")
                    for item in files:
                        self._upload_append(f"{item.get('filename')}: {item.get('url')}")
                    self._finish_upload_ui()
                elif kind == "upload-cancelled":
                    self.upload_stage_var.set("Cancelled")
                    self._upload_append(str(payload))
                    self._finish_upload_ui()
                elif kind == "upload-error":
                    self.upload_stage_var.set("Failed")
                    self._upload_append(str(payload))
                    self._finish_upload_ui()
                    messagebox.showerror("Upload failed", str(payload))

                elif kind == "download-line":
                    self._handle_download_line(str(payload))
                elif kind == "download-done":
                    info = dict(payload)
                    self._finish_download_ui()
                    if info.get("success"):
                        self.download_progress_var.set(100)
                        self.download_stage_var.set(
                            f"Complete — {human_bytes(int(info.get('size') or 0))}"
                        )
                        self._download_append(f"DOWNLOAD COMPLETE: {info.get('path')}")
                        self._download_append(f"Report: {info.get('report')}")
                    else:
                        self.download_stage_var.set(f"Failed — downloader exit code {info.get('code')}")
                        self._download_append("DOWNLOAD FAILED")
                        messagebox.showerror(
                            "Download failed",
                            f"The downloader did not report success.\nExit code: {info.get('code')}\nReport: {info.get('report')}",
                        )
                elif kind == "download-error":
                    self._finish_download_ui()
                    self.download_stage_var.set("Failed")
                    self._download_append(str(payload))
                    messagebox.showerror("Download failed", str(payload))
        except queue.Empty:
            pass
        self.after(100, self._drain_events)


if __name__ == "__main__":
    TransferAssistant().mainloop()
