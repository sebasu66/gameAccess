from __future__ import annotations

import json
import queue
import threading
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk

from transfer_core import (
    CancelledError,
    TransferOrchestrator,
    default_fileq_api_key,
    default_real_debrid_token,
    default_viking_user_hash,
)


class TorrentTransferApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("GameAccess — Torrent → File Host Prototype")
        self.geometry("900x720")
        self.minsize(760, 620)

        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.cancel_event = threading.Event()
        self.worker: threading.Thread | None = None

        self.source_var = tk.StringVar()
        self.destination_var = tk.StringVar(value="ViKiNG FiLE (anonymous)")
        self.selection_var = tk.StringVar(value="Largest file")
        self.rd_token_var = tk.StringVar(value=default_real_debrid_token())
        self.viking_hash_var = tk.StringVar(value=default_viking_user_hash())
        self.fileq_key_var = tk.StringVar(value=default_fileq_api_key())
        self.stage_var = tk.StringVar(value="Idle")
        self.progress_var = tk.DoubleVar(value=0)
        self.result_urls: list[str] = []

        self._build()
        self.after(100, self._drain_events)

    def _build(self) -> None:
        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(6, weight=1)

        ttk.Label(root, text="Torrent source", font=("", 11, "bold")).grid(row=0, column=0, sticky="w")
        source_row = ttk.Frame(root)
        source_row.grid(row=1, column=0, sticky="ew", pady=(6, 12))
        source_row.columnconfigure(0, weight=1)
        ttk.Entry(source_row, textvariable=self.source_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(source_row, text="Browse .torrent…", command=self._browse).grid(row=0, column=1, padx=(8, 0))
        ttk.Label(
            root,
            text="Paste a magnet link or a local .torrent path. The torrent payload is fetched by Real-Debrid, not by this PC.",
        ).grid(row=2, column=0, sticky="w", pady=(0, 14))

        options = ttk.LabelFrame(root, text="Transfer options", padding=10)
        options.grid(row=3, column=0, sticky="ew")
        for c in (1, 3):
            options.columnconfigure(c, weight=1)

        ttk.Label(options, text="Destination").grid(row=0, column=0, sticky="w", padx=(0, 8))
        dest = ttk.Combobox(
            options,
            textvariable=self.destination_var,
            state="readonly",
            values=["ViKiNG FiLE (anonymous)", "FileQ"],
        )
        dest.grid(row=0, column=1, sticky="ew")
        dest.bind("<<ComboboxSelected>>", lambda _e: self._update_destination_hint())

        ttk.Label(options, text="Torrent files").grid(row=0, column=2, sticky="w", padx=(18, 8))
        ttk.Combobox(
            options,
            textvariable=self.selection_var,
            state="readonly",
            values=["Largest file", "All files"],
        ).grid(row=0, column=3, sticky="ew")

        ttk.Label(options, text="Real-Debrid token").grid(row=1, column=0, sticky="w", pady=(10, 0), padx=(0, 8))
        ttk.Entry(options, textvariable=self.rd_token_var, show="•").grid(row=1, column=1, columnspan=3, sticky="ew", pady=(10, 0))

        ttk.Label(options, text="ViKiNG user hash (optional)").grid(row=2, column=0, sticky="w", pady=(8, 0), padx=(0, 8))
        self.viking_entry = ttk.Entry(options, textvariable=self.viking_hash_var)
        self.viking_entry.grid(row=2, column=1, sticky="ew", pady=(8, 0))

        ttk.Label(options, text="FileQ API key").grid(row=2, column=2, sticky="w", pady=(8, 0), padx=(18, 8))
        self.fileq_entry = ttk.Entry(options, textvariable=self.fileq_key_var, show="•")
        self.fileq_entry.grid(row=2, column=3, sticky="ew", pady=(8, 0))

        self.destination_hint = ttk.Label(
            options,
            text="ViKiNG supports documented anonymous remote URL upload; user hash is optional.",
        )
        self.destination_hint.grid(row=3, column=0, columnspan=4, sticky="w", pady=(8, 0))

        action_row = ttk.Frame(root)
        action_row.grid(row=4, column=0, sticky="ew", pady=14)
        self.start_button = ttk.Button(action_row, text="Start server-to-server transfer", command=self._start)
        self.start_button.pack(side="left")
        self.cancel_button = ttk.Button(action_row, text="Cancel", command=self._cancel, state="disabled")
        self.cancel_button.pack(side="left", padx=(8, 0))
        ttk.Button(action_row, text="Copy final link(s)", command=self._copy_results).pack(side="right")

        status_box = ttk.LabelFrame(root, text="Current status", padding=10)
        status_box.grid(row=5, column=0, sticky="ew")
        status_box.columnconfigure(0, weight=1)
        ttk.Label(status_box, textvariable=self.stage_var).grid(row=0, column=0, sticky="w")
        self.progress = ttk.Progressbar(status_box, variable=self.progress_var, maximum=100)
        self.progress.grid(row=1, column=0, sticky="ew", pady=(8, 0))

        logs = ttk.LabelFrame(root, text="Transfer log / final links", padding=8)
        logs.grid(row=6, column=0, sticky="nsew", pady=(14, 0))
        logs.columnconfigure(0, weight=1)
        logs.rowconfigure(0, weight=1)
        self.log = tk.Text(logs, wrap="word", height=16, state="disabled")
        self.log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(logs, command=self.log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scroll.set)

        ttk.Label(
            root,
            text="Credentials are kept only in memory. You can also set REAL_DEBRID_TOKEN, FILEQ_API_KEY, or VIKING_USER_HASH in your environment.",
        ).grid(row=7, column=0, sticky="w", pady=(10, 0))

    def _browse(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose torrent",
            filetypes=[("Torrent files", "*.torrent"), ("All files", "*.*")],
        )
        if path:
            self.source_var.set(path)

    def _update_destination_hint(self) -> None:
        if self.destination_var.get().startswith("FileQ"):
            self.destination_hint.configure(
                text="FileQ requires an account API key. Its free registered tier documents 5 GB max files and 20-day retention after last download."
            )
        else:
            self.destination_hint.configure(
                text="ViKiNG supports documented anonymous remote URL upload; regular files are deleted 15 days after last download."
            )

    def _append(self, line: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", f"[{timestamp}] {line}\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _start(self) -> None:
        source = self.source_var.get().strip()
        token = self.rd_token_var.get().strip()
        destination = self.destination_var.get()
        viking_hash = self.viking_hash_var.get().strip()
        fileq_key = self.fileq_key_var.get().strip()
        selection_mode = "all" if self.selection_var.get() == "All files" else "largest"
        if not source:
            messagebox.showerror("Missing torrent", "Paste a magnet link or choose a .torrent file.")
            return
        if not token:
            messagebox.showerror("Missing Real-Debrid token", "A Real-Debrid API token is required for the torrent prototype.")
            return
        if destination == "FileQ" and not fileq_key:
            messagebox.showerror("Missing FileQ key", "FileQ remote upload requires your FileQ API key.")
            return

        self.cancel_event.clear()
        self.result_urls = []
        self.progress_var.set(0)
        self.stage_var.set("Starting…")
        self.start_button.configure(state="disabled")
        self.cancel_button.configure(state="normal")
        self._append("Starting transfer. No torrent/file bytes should be downloaded through this application.")

        def status_callback(event: dict) -> None:
            self.events.put(("status", event))

        def work() -> None:
            try:
                orchestrator = TransferOrchestrator(
                    token,
                    destination,
                    viking_user_hash=viking_hash,
                    fileq_api_key=fileq_key,
                )
                result = orchestrator.run(
                    source,
                    selection_mode=selection_mode,
                    callback=status_callback,
                    cancel_event=self.cancel_event,
                )
                self.events.put(("done", result))
            except CancelledError as exc:
                self.events.put(("cancelled", str(exc)))
            except Exception as exc:
                self.events.put(("error", f"{type(exc).__name__}: {exc}"))

        self.worker = threading.Thread(target=work, daemon=True)
        self.worker.start()

    def _cancel(self) -> None:
        self.cancel_event.set()
        self.cancel_button.configure(state="disabled")
        self._append("Cancellation requested. The current remote HTTP request may finish before cancellation takes effect.")

    def _copy_results(self) -> None:
        if not self.result_urls:
            messagebox.showinfo("No final links", "No completed destination links are available yet.")
            return
        self.clipboard_clear()
        self.clipboard_append("\n".join(self.result_urls))
        self.update()
        self._append("Final link(s) copied to clipboard.")

    def _finish_ui(self) -> None:
        self.start_button.configure(state="normal")
        self.cancel_button.configure(state="disabled")

    def _drain_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "status":
                    event = dict(payload)
                    self.stage_var.set(str(event.get("message") or event.get("stage") or "Working…"))
                    if event.get("progress") is not None:
                        self.progress_var.set(float(event["progress"]))
                    self._append(str(event.get("message") or event))
                elif kind == "done":
                    result = dict(payload)
                    files = result.get("files") or []
                    self.result_urls = [str(item.get("url")) for item in files if item.get("url")]
                    self.stage_var.set(f"Complete — {len(self.result_urls)} final link(s)")
                    self.progress_var.set(100)
                    self._append("TRANSFER COMPLETE")
                    for item in files:
                        self._append(f"{item.get('filename')}: {item.get('url')}")
                    self._append("Result JSON: " + json.dumps(result, ensure_ascii=False))
                    self._finish_ui()
                elif kind == "cancelled":
                    self.stage_var.set("Cancelled")
                    self._append(str(payload))
                    self._finish_ui()
                elif kind == "error":
                    self.stage_var.set("Failed")
                    self._append(str(payload))
                    self._finish_ui()
                    messagebox.showerror("Transfer failed", str(payload))
        except queue.Empty:
            pass
        self.after(100, self._drain_events)


if __name__ == "__main__":
    TorrentTransferApp().mainloop()
