from __future__ import annotations

import json
import queue
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk


class FreeVikingWizard(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("GameAccess — FREE Torrent → ViKiNG")
        self.geometry("860x650")
        self.minsize(760, 560)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.proc: subprocess.Popen[str] | None = None
        self.source_var = tk.StringVar()
        self.selector_var = tk.StringVar(value="largest")
        self.status_var = tk.StringVar(value="Ready — WebTorrent → anonymous ViKiNG")
        self.final_link_var = tk.StringVar()

        self._build()
        self.after(100, self._drain)

    @property
    def worker_dir(self) -> Path:
        return Path(__file__).resolve().parent

    def _build(self) -> None:
        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(8, weight=1)

        ttk.Label(root, text="Torrent → ViKiNG", font=("", 16, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(root, text="WebTorrent + anonymous ViKiNG. No Real-Debrid, premium account, or token.").grid(row=1, column=0, sticky="w", pady=(4, 16))

        ttk.Label(root, text="Torrent source: magnet, local .torrent, or .torrent URL").grid(row=2, column=0, sticky="w")
        source_row = ttk.Frame(root)
        source_row.grid(row=3, column=0, sticky="ew", pady=(5, 10))
        source_row.columnconfigure(0, weight=1)
        ttk.Entry(source_row, textvariable=self.source_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(source_row, text="Browse .torrent…", command=self._browse_torrent).grid(row=0, column=1, padx=(8, 0))

        row = ttk.Frame(root)
        row.grid(row=4, column=0, sticky="ew")
        ttk.Label(row, text="File selector:").pack(side="left")
        ttk.Entry(row, textvariable=self.selector_var, width=24).pack(side="left", padx=(8, 14))
        self.start_button = ttk.Button(row, text="Upload to ViKiNG", command=self._start)
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(row, text="Stop", command=self._stop, state="disabled")
        self.stop_button.pack(side="left", padx=(8, 0))

        ttk.Separator(root).grid(row=5, column=0, sticky="ew", pady=16)
        ttk.Label(root, textvariable=self.status_var).grid(row=6, column=0, sticky="w")

        result = ttk.Frame(root)
        result.grid(row=7, column=0, sticky="ew", pady=(8, 10))
        result.columnconfigure(0, weight=1)
        ttk.Entry(result, textvariable=self.final_link_var, state="readonly").grid(row=0, column=0, sticky="ew")
        ttk.Button(result, text="Copy link", command=self._copy).grid(row=0, column=1, padx=(8, 0))

        self.log = tk.Text(root, wrap="word", state="disabled")
        self.log.grid(row=8, column=0, sticky="nsew")

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
            self.status_var.set("Paste a magnet/URL or choose a local .torrent file.")
            return
        self._launch(["--source", source, "--file", self.selector_var.get().strip() or "largest"])

    def _launch(self, args: list[str]) -> None:
        if self.proc and self.proc.poll() is None:
            return
        self.final_link_var.set("")
        self.status_var.set("Starting WebTorrent → ViKiNG transfer…")
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

            t1 = threading.Thread(target=pump, args=(proc.stderr,), daemon=True)
            t1.start()
            stdout = proc.stdout.read() if proc.stdout else ""
            code = proc.wait()
            t1.join(timeout=1)
            if stdout.strip():
                self.events.put(("log", stdout.strip()))
            if code == 0:
                try:
                    data = json.loads(stdout)
                    link = data.get("url") or ""
                    self.events.put(("done", link))
                except Exception:
                    self.events.put(("done", ""))
            else:
                self.events.put(("error", f"Transfer exited with code {code}"))
        except Exception as exc:
            self.events.put(("error", str(exc)))
        finally:
            self.proc = None

    def _stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            self.status_var.set("Stopping…")

    def _copy(self) -> None:
        value = self.final_link_var.get().strip()
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
                    link = str(value)
                    self.final_link_var.set(link)
                    self.status_var.set("Complete — ViKiNG link ready" if link else "Complete — see log for result")
                    self._set_running(False)
                elif kind == "error":
                    self.status_var.set(f"Failed: {value}")
                    self._set_running(False)
        except queue.Empty:
            pass
        self.after(100, self._drain)


if __name__ == "__main__":
    FreeVikingWizard().mainloop()
