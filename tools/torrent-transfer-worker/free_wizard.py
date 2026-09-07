from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk


def human_bytes(value: int | float) -> str:
    n = float(value)
    units = ["B", "KB", "MB", "GB", "TB"]
    index = 0
    while n >= 1024 and index < len(units) - 1:
        n /= 1024
        index += 1
    return f"{n:.1f} {units[index]}"


class FreeVikingWizard(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("GameAccess — WebTorrent → ViKiNG → FREE download")
        self.geometry("930x760")
        self.minsize(820, 650)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.proc: subprocess.Popen[str] | None = None
        self.download_proc: subprocess.Popen[str] | None = None
        self.download_window: tk.Toplevel | None = None
        self.download_target: Path | None = None
        self.download_report: Path | None = None
        self.download_total_bytes = 0
        self.download_last_bytes = 0
        self.download_last_time = 0.0
        self.download_cancelled = False
        self.download_finished = False
        self.link_sizes: dict[str, int] = {}

        self.source_var = tk.StringVar()
        self.selector_var = tk.StringVar(value="largest")
        self.parallel_var = tk.IntVar(value=1)
        self.status_var = tk.StringVar(value="Ready")
        self.viking_link_var = tk.StringVar()
        self.size_var = tk.StringVar(value="File size: unknown")

        self.download_file_var = tk.StringVar(value="Waiting for download…")
        self.download_total_var = tk.StringVar(value="Total: unknown")
        self.download_progress_var = tk.StringVar(value="Downloaded: 0 B")
        self.download_speed_var = tk.StringVar(value="Speed: 0 B/s")
        self.download_state_var = tk.StringVar(value="Waiting for ViKiNG download…")

        self._build()
        self.after(100, self._drain)

    @property
    def worker_dir(self) -> Path:
        return Path(__file__).resolve().parent

    @property
    def history_file(self) -> Path:
        return self.worker_dir / "uploaded_links.txt"

    @property
    def probe_exe(self) -> Path:
        return self.worker_dir.parent / "viking-webview-probe" / "target" / "release" / "viking-webview-probe.exe"

    def _build(self) -> None:
        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(13, weight=1)

        ttk.Label(root, text="WebTorrent → ViKiNG → FREE download", font=("", 16, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(root, text="No premium service. Magnet/local .torrent → WebTorrent → ViKiNG → normal free download flow.").grid(row=1, column=0, sticky="w", pady=(4, 16))

        ttk.Label(root, text="1. Torrent → ViKiNG", font=("", 11, "bold")).grid(row=2, column=0, sticky="w")
        ttk.Label(root, text="Torrent source: magnet link or local .torrent file").grid(row=3, column=0, sticky="w", pady=(5, 0))

        source_row = ttk.Frame(root)
        source_row.grid(row=4, column=0, sticky="ew", pady=(5, 10))
        source_row.columnconfigure(0, weight=1)
        ttk.Entry(source_row, textvariable=self.source_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(source_row, text="Browse .torrent…", command=self._browse_torrent).grid(row=0, column=1, padx=(8, 0))

        upload_row = ttk.Frame(root)
        upload_row.grid(row=5, column=0, sticky="ew")
        ttk.Label(upload_row, text="File selector:").pack(side="left")
        ttk.Entry(upload_row, textvariable=self.selector_var, width=20).pack(side="left", padx=(8, 14))
        ttk.Label(upload_row, text="Parallel parts:").pack(side="left")
        ttk.Spinbox(upload_row, from_=1, to=10, textvariable=self.parallel_var, width=4, state="readonly").pack(side="left", padx=(8, 14))
        self.start_button = ttk.Button(upload_row, text="Upload to ViKiNG", command=self._start)
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(upload_row, text="Stop", command=self._stop, state="disabled")
        self.stop_button.pack(side="left", padx=(8, 0))

        ttk.Label(root, textvariable=self.size_var).grid(row=6, column=0, sticky="w", pady=(8, 0))

        ttk.Separator(root).grid(row=7, column=0, sticky="ew", pady=16)

        ttk.Label(root, text="2. ViKiNG FREE landing → browser download", font=("", 11, "bold")).grid(row=8, column=0, sticky="w")
        ttk.Label(root, text="The download keeps the original filename and extension. You choose the destination folder before opening the ViKiNG flow.").grid(row=9, column=0, sticky="w", pady=(5, 5))

        download_row = ttk.Frame(root)
        download_row.grid(row=10, column=0, sticky="ew")
        download_row.columnconfigure(0, weight=1)
        ttk.Entry(download_row, textvariable=self.viking_link_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(download_row, text="Download…", command=self._open_download_flow).grid(row=0, column=1, padx=(8, 0))
        ttk.Button(download_row, text="Copy link", command=self._copy).grid(row=0, column=2, padx=(8, 0))

        ttk.Separator(root).grid(row=11, column=0, sticky="ew", pady=16)
        ttk.Label(root, textvariable=self.status_var).grid(row=12, column=0, sticky="w")

        self.log = tk.Text(root, wrap="word", state="disabled")
        self.log.grid(row=13, column=0, sticky="nsew", pady=(8, 0))

    def _browse_torrent(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose .torrent file",
            filetypes=[("Torrent files", "*.torrent"), ("All files", "*.*")],
        )
        if path:
            self.source_var.set(path)

    def _append(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text.rstrip() + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_running(self, running: bool) -> None:
        self.start_button.configure(state="disabled" if running else "normal")
        self.stop_button.configure(state="normal" if running else "disabled")

    def _start(self) -> None:
        source = self.source_var.get().strip()
        if not source:
            self.status_var.set("Paste a magnet link or choose a local .torrent file.")
            return
        if source.lower().startswith(("http://", "https://")):
            self.status_var.set("HTTP .torrent URLs are disabled. Use a magnet or local .torrent file.")
            return
        try:
            parallel = int(self.parallel_var.get())
        except (TypeError, ValueError):
            parallel = 1
        parallel = max(1, min(10, parallel))
        self.parallel_var.set(parallel)
        self.size_var.set("File size: resolving…")
        self._launch([
            "--source", source,
            "--file", self.selector_var.get().strip() or "largest",
            "--parallel", str(parallel),
        ])

    def _launch(self, args: list[str]) -> None:
        if self.proc and self.proc.poll() is None:
            return
        self.viking_link_var.set("")
        self.status_var.set("Running WebTorrent → ViKiNG transfer…")
        self._set_running(True)
        threading.Thread(target=self._run, args=(args,), daemon=True).start()

    def _run(self, args: list[str]) -> None:
        cmd = ["node", "cli-transfer.mjs", *args]
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=self.worker_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            self.proc = proc

            def pump(stream) -> None:
                if not stream:
                    return
                for line in stream:
                    self.events.put(("log", line.rstrip()))

            stderr_thread = threading.Thread(target=pump, args=(proc.stderr,), daemon=True)
            stderr_thread.start()
            stdout = proc.stdout.read() if proc.stdout else ""
            code = proc.wait()
            stderr_thread.join(timeout=1)
            if stdout.strip():
                self.events.put(("log", stdout.strip()))
            if code == 0:
                try:
                    data = json.loads(stdout)
                    self.events.put(("done", data))
                except Exception:
                    self.events.put(("error", "Transfer completed but returned invalid JSON."))
            else:
                self.events.put(("error", f"Transfer exited with code {code}"))
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.proc = None

    def _save_uploaded_link(self, source: str, link: str) -> None:
        with self.history_file.open("a", encoding="utf-8") as handle:
            handle.write(f"{source} > {link}\n")

    def _open_download_flow(self) -> None:
        url = self.viking_link_var.get().strip()
        if not url.startswith("https://vikingfile.com/f/"):
            self.status_var.set("Enter a normal ViKiNG landing URL (https://vikingfile.com/f/...).")
            return
        if not self.probe_exe.exists():
            self.status_var.set(f"Download probe executable not found: {self.probe_exe}")
            return
        if self.download_proc and self.download_proc.poll() is None:
            self.status_var.set("A download is already running.")
            return

        folder = filedialog.askdirectory(title="Choose download folder")
        if not folder:
            return

        report = self.worker_dir / "viking-free-download-report.json"
        try:
            report.unlink(missing_ok=True)
        except OSError:
            pass

        self.download_report = report
        self.download_target = None
        self.download_total_bytes = self.link_sizes.get(url, 0)
        self.download_last_bytes = 0
        self.download_last_time = time.monotonic()
        self.download_cancelled = False
        self.download_finished = False

        cmd = [
            str(self.probe_exe),
            "--url", url,
            "--timeout", "900",
            "--report", str(report),
            "--download-dir", folder,
        ]

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=self.probe_exe.parent,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            self.download_proc = proc
            self._show_download_dialog()
            threading.Thread(target=self._pump_download_process, args=(proc,), daemon=True).start()
            self.status_var.set("ViKiNG download flow opened.")
            self.after(300, self._poll_download_progress)
        except Exception as exc:
            self.status_var.set(f"Could not open download flow: {exc}")

    def _show_download_dialog(self) -> None:
        if self.download_window and self.download_window.winfo_exists():
            self.download_window.destroy()

        window = tk.Toplevel(self)
        self.download_window = window
        window.title("Download progress")
        window.geometry("560x250")
        window.resizable(False, False)
        window.protocol("WM_DELETE_WINDOW", self._cancel_download)

        frame = ttk.Frame(window, padding=16)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(0, weight=1)

        self.download_file_var.set("Waiting for download…")
        self.download_total_var.set(
            f"Total: {human_bytes(self.download_total_bytes)}"
            if self.download_total_bytes > 0 else "Total: unknown"
        )
        self.download_progress_var.set("Downloaded: 0 B")
        self.download_speed_var.set("Speed: 0 B/s")
        self.download_state_var.set("Waiting for ViKiNG download…")

        ttk.Label(frame, textvariable=self.download_file_var).grid(row=0, column=0, sticky="w")
        ttk.Label(frame, textvariable=self.download_total_var).grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Label(frame, textvariable=self.download_progress_var).grid(row=2, column=0, sticky="w", pady=(4, 0))
        ttk.Label(frame, textvariable=self.download_speed_var).grid(row=3, column=0, sticky="w", pady=(4, 8))

        self.download_bar = ttk.Progressbar(frame, maximum=100)
        self.download_bar.grid(row=4, column=0, sticky="ew", pady=(4, 8))
        if self.download_total_bytes <= 0:
            self.download_bar.configure(mode="indeterminate")
            self.download_bar.start(10)
        else:
            self.download_bar.configure(mode="determinate", value=0)

        ttk.Label(frame, textvariable=self.download_state_var).grid(row=5, column=0, sticky="w", pady=(4, 8))
        self.download_cancel_button = ttk.Button(frame, text="Cancel", command=self._cancel_download)
        self.download_cancel_button.grid(row=6, column=0, sticky="e")

    def _pump_download_process(self, proc: subprocess.Popen[str]) -> None:
        if proc.stdout:
            for line in proc.stdout:
                self.events.put(("download_log", line.rstrip()))
        code = proc.wait()
        self.events.put(("download_exit", code))

    def _read_download_report(self) -> dict:
        if not self.download_report or not self.download_report.exists():
            return {}
        try:
            return json.loads(self.download_report.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _poll_download_progress(self) -> None:
        if self.download_finished or self.download_cancelled:
            return

        report = self._read_download_report()
        requested = report.get("download_requested") or {}
        path_text = requested.get("path")
        if path_text:
            self.download_target = Path(path_text)
            self.download_file_var.set(f"File: {self.download_target.name}")
            self.download_state_var.set("Downloading…")

        current_bytes = 0
        if self.download_target:
            try:
                current_bytes = self.download_target.stat().st_size
            except OSError:
                current_bytes = 0

        now = time.monotonic()
        elapsed = max(0.001, now - self.download_last_time)
        delta = max(0, current_bytes - self.download_last_bytes)
        speed = delta / elapsed
        self.download_last_bytes = current_bytes
        self.download_last_time = now

        self.download_progress_var.set(f"Downloaded: {human_bytes(current_bytes)}")
        self.download_speed_var.set(f"Speed: {human_bytes(speed)}/s")

        if self.download_total_bytes > 0:
            percent = min(100.0, current_bytes * 100.0 / self.download_total_bytes)
            self.download_bar.configure(mode="determinate", value=percent)

        finished = report.get("download_finished") or {}
        if finished.get("success") is True:
            final_path = Path(finished.get("path")) if finished.get("path") else self.download_target
            self._finish_download(True, final_path)
            return
        if finished.get("success") is False:
            self._finish_download(False, self.download_target)
            return
        if report.get("timed_out"):
            self._finish_download(False, self.download_target, "Download timed out.")
            return

        self.after(500, self._poll_download_progress)

    def _finish_download(self, success: bool, path: Path | None, message: str | None = None) -> None:
        if self.download_finished:
            return
        self.download_finished = True
        if hasattr(self, "download_bar"):
            self.download_bar.stop()

        if success:
            final = str(path) if path else "downloaded file"
            self.download_state_var.set("Complete")
            self.status_var.set(f"Download complete: {final}")
            if path:
                try:
                    size = path.stat().st_size
                    self.download_progress_var.set(f"Downloaded: {human_bytes(size)}")
                    if self.download_total_bytes <= 0:
                        self.download_total_var.set(f"Total: {human_bytes(size)}")
                except OSError:
                    pass
            if hasattr(self, "download_bar"):
                self.download_bar.configure(mode="determinate", value=100)
        else:
            text = message or "Download failed."
            self.download_state_var.set(text)
            self.status_var.set(text)

        if hasattr(self, "download_cancel_button"):
            self.download_cancel_button.configure(text="Close", command=self._close_download_dialog)

    def _cancel_download(self) -> None:
        if self.download_finished:
            self._close_download_dialog()
            return
        self.download_cancelled = True
        if self.download_proc and self.download_proc.poll() is None:
            self.download_proc.terminate()
        if hasattr(self, "download_bar"):
            self.download_bar.stop()
        self.download_state_var.set("Cancelled")
        self.status_var.set("Download cancelled.")
        if hasattr(self, "download_cancel_button"):
            self.download_cancel_button.configure(text="Close", command=self._close_download_dialog)

    def _close_download_dialog(self) -> None:
        if self.download_window and self.download_window.winfo_exists():
            self.download_window.destroy()
        self.download_window = None

    def _stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            self.status_var.set("Stopping…")

    def _copy(self) -> None:
        value = self.viking_link_var.get().strip()
        if value:
            self.clipboard_clear()
            self.clipboard_append(value)
            self.update()

    def _drain(self) -> None:
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self._append(str(value))
                elif kind == "done":
                    data = value if isinstance(value, dict) else {}
                    link = str(data.get("url") or "")
                    source = str(data.get("source") or self.source_var.get().strip())
                    size = int(data.get("bytes") or 0)
                    self.viking_link_var.set(link)
                    if size > 0:
                        self.link_sizes[link] = size
                        self.size_var.set(f"File size: {human_bytes(size)}")
                    else:
                        self.size_var.set("File size: unknown")
                    if link:
                        try:
                            self._save_uploaded_link(source, link)
                            self._append(f"Saved mapping to {self.history_file}")
                        except OSError as exc:
                            self._append(f"Could not save mapping: {exc}")
                    self.status_var.set("Upload complete — ViKiNG landing URL ready." if link else "Upload complete — see log for result")
                    self._set_running(False)
                elif kind == "error":
                    self.status_var.set(f"Failed: {value}")
                    self._set_running(False)
                elif kind == "download_log":
                    self._append(str(value))
                elif kind == "download_exit":
                    if not self.download_finished and not self.download_cancelled:
                        report = self._read_download_report()
                        finished = report.get("download_finished") or {}
                        if finished.get("success") is True:
                            path = Path(finished.get("path")) if finished.get("path") else self.download_target
                            self._finish_download(True, path)
                        elif self.download_proc and self.download_proc.poll() is not None:
                            self._finish_download(False, self.download_target, f"Download process ended with code {value}.")
        except queue.Empty:
            pass
        self.after(100, self._drain)


if __name__ == "__main__":
    FreeVikingWizard().mainloop()
