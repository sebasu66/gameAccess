from __future__ import annotations

import json
import os
import queue
import subprocess
import tempfile
import threading
import tkinter as tk
import urllib.parse
import urllib.request
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from transfer_core import CancelledError, TransferOrchestrator, default_real_debrid_token


MAX_TORRENT_METADATA_BYTES = 20 * 1024 * 1024


class VikingTransferWizard(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("GameAccess — Torrent ↔ ViKiNG test wizard")
        self.geometry("940x760")
        self.minsize(820, 650)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.upload_cancel = threading.Event()
        self.download_process: subprocess.Popen[str] | None = None

        self.source_var = tk.StringVar()
        self.rd_token_var = tk.StringVar(value=default_real_debrid_token())
        self.selection_var = tk.StringVar(value="Largest file")
        self.upload_status_var = tk.StringVar(value="Ready")
        self.upload_progress_var = tk.DoubleVar(value=0)
        self.final_link_var = tk.StringVar()

        self.download_link_var = tk.StringVar()
        default_download = Path.home() / "Downloads" / "viking-download.bin"
        self.download_path_var = tk.StringVar(value=str(default_download))
        self.download_status_var = tk.StringVar(value="Ready")
        self.download_bytes_var = tk.StringVar(value="0 bytes")

        self._build()
        self.after(100, self._drain_events)

    @property
    def repo_root(self) -> Path:
        return Path(__file__).resolve().parents[2]

    @property
    def probe_manifest(self) -> Path:
        return self.repo_root / "tools" / "viking-webview-probe" / "Cargo.toml"

    @property
    def probe_exe(self) -> Path:
        return (
            self.repo_root
            / "tools"
            / "viking-webview-probe"
            / "target"
            / "release"
            / "viking-webview-probe.exe"
        )

    def _build(self) -> None:
        wrapper = ttk.Frame(self, padding=14)
        wrapper.pack(fill="both", expand=True)
        wrapper.rowconfigure(1, weight=1)
        wrapper.columnconfigure(0, weight=1)

        ttk.Label(
            wrapper,
            text="Use only torrents/files you are authorized to download and redistribute.",
        ).grid(row=0, column=0, sticky="w", pady=(0, 10))

        self.tabs = ttk.Notebook(wrapper)
        self.tabs.grid(row=1, column=0, sticky="nsew")

        self.upload_tab = ttk.Frame(self.tabs, padding=14)
        self.download_tab = ttk.Frame(self.tabs, padding=14)
        self.tabs.add(self.upload_tab, text="1. Torrent → ViKiNG")
        self.tabs.add(self.download_tab, text="2. ViKiNG → local")

        self._build_upload_tab()
        self._build_download_tab()

    def _build_upload_tab(self) -> None:
        tab = self.upload_tab
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(8, weight=1)

        ttk.Label(tab, text="Torrent source", font=("", 11, "bold")).grid(
            row=0, column=0, sticky="w"
        )
        source_row = ttk.Frame(tab)
        source_row.grid(row=1, column=0, sticky="ew", pady=(6, 4))
        source_row.columnconfigure(0, weight=1)
        ttk.Entry(source_row, textvariable=self.source_var).grid(
            row=0, column=0, sticky="ew"
        )
        ttk.Button(source_row, text="Browse .torrent…", command=self._browse_torrent).grid(
            row=0, column=1, padx=(8, 0)
        )
        ttk.Label(
            tab,
            text="Accepts a magnet link, local .torrent file, or direct HTTP/HTTPS URL to a .torrent file.",
        ).grid(row=2, column=0, sticky="w", pady=(0, 12))

        auth = ttk.LabelFrame(tab, text="Real-Debrid", padding=10)
        auth.grid(row=3, column=0, sticky="ew")
        auth.columnconfigure(1, weight=1)
        ttk.Label(auth, text="API token").grid(row=0, column=0, sticky="w", padx=(0, 8))
        ttk.Entry(auth, textvariable=self.rd_token_var, show="•").grid(
            row=0, column=1, sticky="ew"
        )
        ttk.Label(auth, text="Files").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(
            auth,
            textvariable=self.selection_var,
            state="readonly",
            values=["Largest file", "All files"],
        ).grid(row=1, column=1, sticky="ew", pady=(8, 0))

        actions = ttk.Frame(tab)
        actions.grid(row=4, column=0, sticky="ew", pady=12)
        self.upload_button = ttk.Button(
            actions, text="Start upload to ViKiNG", command=self._start_upload
        )
        self.upload_button.pack(side="left")
        self.upload_cancel_button = ttk.Button(
            actions, text="Cancel", command=self._cancel_upload, state="disabled"
        )
        self.upload_cancel_button.pack(side="left", padx=(8, 0))

        result = ttk.LabelFrame(tab, text="Final ViKiNG link", padding=10)
        result.grid(row=5, column=0, sticky="ew")
        result.columnconfigure(0, weight=1)
        ttk.Entry(result, textvariable=self.final_link_var, state="readonly").grid(
            row=0, column=0, sticky="ew"
        )
        ttk.Button(result, text="Copy", command=self._copy_final_link).grid(
            row=0, column=1, padx=(8, 0)
        )
        ttk.Button(
            result,
            text="Use in Download tab",
            command=self._send_to_download_tab,
        ).grid(row=0, column=2, padx=(8, 0))

        status = ttk.LabelFrame(tab, text="Upload status", padding=10)
        status.grid(row=6, column=0, sticky="ew", pady=(12, 0))
        status.columnconfigure(0, weight=1)
        ttk.Label(status, textvariable=self.upload_status_var).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Progressbar(
            status, variable=self.upload_progress_var, maximum=100
        ).grid(row=1, column=0, sticky="ew", pady=(8, 0))

        logs = ttk.LabelFrame(tab, text="Upload log", padding=8)
        logs.grid(row=8, column=0, sticky="nsew", pady=(12, 0))
        logs.columnconfigure(0, weight=1)
        logs.rowconfigure(0, weight=1)
        self.upload_log = tk.Text(logs, wrap="word", state="disabled", height=15)
        self.upload_log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(logs, command=self.upload_log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.upload_log.configure(yscrollcommand=scroll.set)

    def _build_download_tab(self) -> None:
        tab = self.download_tab
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(7, weight=1)

        ttk.Label(tab, text="ViKiNG landing link", font=("", 11, "bold")).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Entry(tab, textvariable=self.download_link_var).grid(
            row=1, column=0, sticky="ew", pady=(6, 12)
        )

        ttk.Label(tab, text="Save as").grid(row=2, column=0, sticky="w")
        path_row = ttk.Frame(tab)
        path_row.grid(row=3, column=0, sticky="ew", pady=(6, 12))
        path_row.columnconfigure(0, weight=1)
        ttk.Entry(path_row, textvariable=self.download_path_var).grid(
            row=0, column=0, sticky="ew"
        )
        ttk.Button(path_row, text="Choose…", command=self._choose_download_path).grid(
            row=0, column=1, padx=(8, 0)
        )

        actions = ttk.Frame(tab)
        actions.grid(row=4, column=0, sticky="ew")
        self.download_button = ttk.Button(
            actions, text="Start automatic download", command=self._start_download
        )
        self.download_button.pack(side="left")
        self.download_cancel_button = ttk.Button(
            actions, text="Cancel", command=self._cancel_download, state="disabled"
        )
        self.download_cancel_button.pack(side="left", padx=(8, 0))

        status = ttk.LabelFrame(tab, text="Download status", padding=10)
        status.grid(row=5, column=0, sticky="ew", pady=(12, 0))
        status.columnconfigure(0, weight=1)
        ttk.Label(status, textvariable=self.download_status_var).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(status, textvariable=self.download_bytes_var).grid(
            row=1, column=0, sticky="w", pady=(6, 0)
        )
        self.download_progress = ttk.Progressbar(status, mode="indeterminate")
        self.download_progress.grid(row=2, column=0, sticky="ew", pady=(8, 0))

        logs = ttk.LabelFrame(tab, text="Download/WebView log", padding=8)
        logs.grid(row=7, column=0, sticky="nsew", pady=(12, 0))
        logs.columnconfigure(0, weight=1)
        logs.rowconfigure(0, weight=1)
        self.download_log = tk.Text(logs, wrap="word", state="disabled", height=17)
        self.download_log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(logs, command=self.download_log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.download_log.configure(yscrollcommand=scroll.set)

    def _append(self, widget: tk.Text, text: str) -> None:
        widget.configure(state="normal")
        widget.insert("end", text.rstrip() + "\n")
        widget.see("end")
        widget.configure(state="disabled")

    def _browse_torrent(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose torrent metadata",
            filetypes=[("Torrent files", "*.torrent"), ("All files", "*.*")],
        )
        if path:
            self.source_var.set(path)

    def _choose_download_path(self) -> None:
        initial = Path(self.download_path_var.get().strip() or "viking-download.bin")
        path = filedialog.asksaveasfilename(
            title="Save ViKiNG download as",
            initialdir=str(initial.parent) if initial.parent.exists() else None,
            initialfile=initial.name,
        )
        if path:
            self.download_path_var.set(path)

    def _copy_final_link(self) -> None:
        value = self.final_link_var.get().strip()
        if not value:
            return
        self.clipboard_clear()
        self.clipboard_append(value)
        self.update()

    def _send_to_download_tab(self) -> None:
        value = self.final_link_var.get().strip()
        if not value:
            messagebox.showinfo("No link yet", "Complete an upload first.")
            return
        self.download_link_var.set(value)
        self.tabs.select(self.download_tab)

    def _materialize_torrent_source(self, source: str) -> tuple[str, Path | None]:
        source = source.strip().strip('"')
        parsed = urllib.parse.urlsplit(source)
        if parsed.scheme.lower() not in {"http", "https"}:
            return source, None

        request = urllib.request.Request(
            source,
            headers={"User-Agent": "GameAccess-ViKiNG-Wizard/0.1"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_TORRENT_METADATA_BYTES:
                raise RuntimeError("Remote .torrent metadata is unexpectedly large.")
            payload = response.read(MAX_TORRENT_METADATA_BYTES + 1)

        if not payload:
            raise RuntimeError("Remote torrent URL returned an empty response.")
        if len(payload) > MAX_TORRENT_METADATA_BYTES:
            raise RuntimeError("Remote .torrent metadata exceeds the 20 MB safety limit.")

        fd, name = tempfile.mkstemp(prefix="gameaccess-", suffix=".torrent")
        os.close(fd)
        path = Path(name)
        path.write_bytes(payload)
        return str(path), path

    def _start_upload(self) -> None:
        source = self.source_var.get().strip()
        token = self.rd_token_var.get().strip()
        if not source:
            messagebox.showerror("Missing torrent", "Paste a magnet, .torrent path, or .torrent URL.")
            return
        if not token:
            messagebox.showerror("Missing token", "A Real-Debrid API token is required.")
            return

        selection = "all" if self.selection_var.get() == "All files" else "largest"
        self.upload_cancel.clear()
        self.upload_progress_var.set(0)
        self.upload_status_var.set("Starting…")
        self.final_link_var.set("")
        self.upload_button.configure(state="disabled")
        self.upload_cancel_button.configure(state="normal")

        def callback(event: dict) -> None:
            self.events.put(("upload_status", event))

        def work() -> None:
            temp_source: Path | None = None
            try:
                prepared, temp_source = self._materialize_torrent_source(source)
                if temp_source:
                    self.events.put(
                        ("upload_log", f"Downloaded torrent metadata only: {temp_source.name} ({temp_source.stat().st_size} bytes)")
                    )
                orchestrator = TransferOrchestrator(
                    token,
                    "ViKiNG FiLE (anonymous)",
                )
                result = orchestrator.run(
                    prepared,
                    selection_mode=selection,
                    callback=callback,
                    cancel_event=self.upload_cancel,
                )
                self.events.put(("upload_done", result))
            except CancelledError as exc:
                self.events.put(("upload_cancelled", str(exc)))
            except Exception as exc:
                self.events.put(("upload_error", f"{type(exc).__name__}: {exc}"))
            finally:
                if temp_source:
                    try:
                        temp_source.unlink(missing_ok=True)
                    except Exception:
                        pass

        threading.Thread(target=work, daemon=True).start()

    def _cancel_upload(self) -> None:
        self.upload_cancel.set()
        self.upload_cancel_button.configure(state="disabled")

    def _start_download(self) -> None:
        link = self.download_link_var.get().strip()
        destination = Path(self.download_path_var.get().strip()).expanduser()
        if not link.startswith(("https://vikingfile.com/", "https://vik1ngfile.site/")):
            messagebox.showerror("Invalid link", "Paste a ViKiNG landing link.")
            return
        if not destination.name:
            messagebox.showerror("Invalid destination", "Choose a destination file.")
            return

        destination.parent.mkdir(parents=True, exist_ok=True)
        self.download_button.configure(state="disabled")
        self.download_cancel_button.configure(state="normal")
        self.download_status_var.set("Preparing WebView probe…")
        self.download_bytes_var.set("0 bytes")
        self.download_progress.start(12)

        def work() -> None:
            try:
                probe = self.probe_exe
                if not probe.exists():
                    self.events.put(("download_log", "Probe executable missing; building release executable…"))
                    build = subprocess.run(
                        [
                            "cargo",
                            "build",
                            "--manifest-path",
                            str(self.probe_manifest),
                            "--release",
                        ],
                        cwd=self.repo_root,
                        text=True,
                        capture_output=True,
                    )
                    if build.stdout:
                        self.events.put(("download_log", build.stdout))
                    if build.stderr:
                        self.events.put(("download_log", build.stderr))
                    if build.returncode != 0 or not probe.exists():
                        raise RuntimeError(f"Could not build WebView probe (exit {build.returncode}).")

                report = destination.with_suffix(destination.suffix + ".viking-report.json")
                argv = [
                    str(probe),
                    "--url",
                    link,
                    "--timeout",
                    "600",
                    "--report",
                    str(report),
                    "--download",
                    str(destination),
                ]
                self.events.put(("download_log", "Launching visible automatic ViKiNG WebView…"))
                process = subprocess.Popen(
                    argv,
                    cwd=self.repo_root,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                self.download_process = process
                assert process.stdout is not None
                for line in process.stdout:
                    self.events.put(("download_log", line.rstrip()))
                    if "download-requested " in line:
                        self.events.put(("download_status", "Download requested by WebView2"))
                    if "download-progress " in line and " len=" in line:
                        try:
                            size = int(line.rsplit(" len=", 1)[1].strip())
                            self.events.put(("download_bytes", size))
                        except ValueError:
                            pass
                    if "download-finished " in line:
                        self.events.put(("download_status", "Finalizing download…"))
                code = process.wait()
                self.download_process = None

                report_data: dict = {}
                if report.exists():
                    try:
                        report_data = json.loads(report.read_text(encoding="utf-8"))
                    except Exception:
                        report_data = {}

                finished = report_data.get("download_finished") or {}
                success = bool(finished.get("success"))
                if code == 0 and success and destination.exists():
                    self.events.put(("download_done", destination))
                else:
                    raise RuntimeError(
                        f"Download did not complete successfully (probe exit={code}, success={finished.get('success')})."
                    )
            except Exception as exc:
                self.download_process = None
                self.events.put(("download_error", f"{type(exc).__name__}: {exc}"))

        threading.Thread(target=work, daemon=True).start()

    def _cancel_download(self) -> None:
        process = self.download_process
        if process and process.poll() is None:
            process.terminate()
        self.download_cancel_button.configure(state="disabled")

    @staticmethod
    def _format_bytes(value: int) -> str:
        size = float(value)
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if size < 1024 or unit == "TB":
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    def _upload_finished_ui(self) -> None:
        self.upload_button.configure(state="normal")
        self.upload_cancel_button.configure(state="disabled")

    def _download_finished_ui(self) -> None:
        self.download_progress.stop()
        self.download_button.configure(state="normal")
        self.download_cancel_button.configure(state="disabled")

    def _drain_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "upload_status":
                    event = dict(payload)
                    message = str(event.get("message") or event.get("stage") or "Working…")
                    self.upload_status_var.set(message)
                    if event.get("progress") is not None:
                        self.upload_progress_var.set(float(event["progress"]))
                    self._append(self.upload_log, message)
                elif kind == "upload_log":
                    self._append(self.upload_log, str(payload))
                elif kind == "upload_done":
                    result = dict(payload)
                    files = result.get("files") or []
                    first = files[0] if files else {}
                    link = str(first.get("url") or "")
                    filename = str(first.get("filename") or "viking-download.bin")
                    self.final_link_var.set(link)
                    self.upload_status_var.set(f"Complete — {len(files)} file(s)")
                    self.upload_progress_var.set(100)
                    self._append(self.upload_log, "UPLOAD COMPLETE")
                    for item in files:
                        self._append(
                            self.upload_log,
                            f"{item.get('filename')}: {item.get('url')}",
                        )
                    if link:
                        self.download_link_var.set(link)
                        self.download_path_var.set(str(Path.home() / "Downloads" / filename))
                    self._upload_finished_ui()
                elif kind == "upload_cancelled":
                    self.upload_status_var.set("Cancelled")
                    self._append(self.upload_log, str(payload))
                    self._upload_finished_ui()
                elif kind == "upload_error":
                    self.upload_status_var.set("Failed")
                    self._append(self.upload_log, str(payload))
                    self._upload_finished_ui()
                    messagebox.showerror("Upload failed", str(payload))
                elif kind == "download_log":
                    self._append(self.download_log, str(payload))
                elif kind == "download_status":
                    self.download_status_var.set(str(payload))
                elif kind == "download_bytes":
                    self.download_bytes_var.set(self._format_bytes(int(payload)))
                elif kind == "download_done":
                    path = Path(payload)
                    size = path.stat().st_size if path.exists() else 0
                    self.download_status_var.set("Complete")
                    self.download_bytes_var.set(self._format_bytes(size))
                    self._append(self.download_log, f"DOWNLOAD COMPLETE: {path} ({size} bytes)")
                    self._download_finished_ui()
                elif kind == "download_error":
                    self.download_status_var.set("Failed")
                    self._append(self.download_log, str(payload))
                    self._download_finished_ui()
                    messagebox.showerror("Download failed", str(payload))
        except queue.Empty:
            pass
        self.after(100, self._drain_events)


if __name__ == "__main__":
    VikingTransferWizard().mainloop()
