import os
import threading
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

import requests

from steam_switch import switch_to_remembered_account, visible_steam_texts

API = os.environ.get("GAMEACCESS_API", "http://127.0.0.1:8000")
USER_ID = int(os.environ.get("GAMEACCESS_USER_ID", "1"))


class Launcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("gameAccess")
        self.geometry("760x540")
        self.resizable(True, True)
        self.games = []
        self.current_lease_id = None
        self.current_account_label = None

        header = ttk.Frame(self, padding=16)
        header.pack(fill="x")
        ttk.Label(header, text="gameAccess", font=("Segoe UI", 20, "bold")).pack(side="left")
        self.credits_label = ttk.Label(header, text="Credits: ...")
        self.credits_label.pack(side="right")

        controls = ttk.Frame(self, padding=(16, 0, 16, 8))
        controls.pack(fill="x")
        ttk.Label(controls, text="Session minutes:").pack(side="left")
        self.minutes = tk.IntVar(value=60)
        ttk.Spinbox(controls, from_=5, to=1440, textvariable=self.minutes, width=8).pack(side="left", padx=8)
        ttk.Button(controls, text="Refresh", command=self.refresh).pack(side="right")

        self.tree = ttk.Treeview(self, columns=("availability", "price"), show="tree headings", height=15)
        self.tree.heading("#0", text="Game")
        self.tree.heading("availability", text="Available")
        self.tree.heading("price", text="Credits/hour")
        self.tree.column("#0", width=380)
        self.tree.column("availability", width=120, anchor="center")
        self.tree.column("price", width=140, anchor="center")
        self.tree.pack(fill="both", expand=True, padx=16, pady=8)

        footer = ttk.Frame(self, padding=16)
        footer.pack(fill="x")
        self.play_btn = ttk.Button(footer, text="Lease & Play", command=self.lease_selected)
        self.play_btn.pack(side="left")
        self.release_btn = ttk.Button(footer, text="Release current session", command=self.release_current)
        self.release_btn.pack(side="left", padx=8)
        ttk.Button(footer, text="Test Steam switch", command=self.test_steam_switch).pack(side="left", padx=8)
        ttk.Button(footer, text="Earn 100 demo credits", command=self.earn_demo).pack(side="right")

        self.status = ttk.Label(self, text="Ready", padding=(16, 0, 16, 12))
        self.status.pack(fill="x")

        self.refresh()

    def api(self, method, path, **kwargs):
        try:
            response = requests.request(method, API + path, timeout=8, **kwargs)
            if not response.ok:
                detail = response.json().get("detail", response.text)
                raise RuntimeError(detail)
            return response.json()
        except Exception as exc:
            raise RuntimeError(f"API error: {exc}") from exc

    def refresh(self):
        try:
            user = self.api("GET", f"/users/{USER_ID}")
            self.credits_label.config(text=f"Credits: {user['credits']}")
            self.games = self.api("GET", "/catalog")
            self.tree.delete(*self.tree.get_children())
            for game in self.games:
                self.tree.insert(
                    "",
                    "end",
                    iid=str(game["id"]),
                    text=game["name"],
                    values=(f"{game['copies_available']}/{game['copies_total']}", game["credit_cost_per_hour"]),
                )
            self.status.config(text="Catalog refreshed")
        except Exception as exc:
            self.status.config(text=str(exc))

    def _run_steam_switch(self, account_label: str):
        self.status.config(text=f"Switching Steam to {account_label}...")

        def work():
            result = switch_to_remembered_account(account_label)
            self.after(0, lambda: self._steam_switch_finished(result))

        threading.Thread(target=work, daemon=True).start()

    def _steam_switch_finished(self, result):
        if result.ok:
            self.status.config(text=result.message)
            messagebox.showinfo("Steam ready", result.message)
        else:
            self.status.config(text=f"Steam switch failed: {result.message}")
            messagebox.showwarning("Steam switch", result.message)

    def test_steam_switch(self):
        texts = visible_steam_texts()
        hint = ""
        if texts:
            hint = "\n\nVisible Steam text now:\n" + "\n".join(texts[:12])
        account = simpledialog.askstring(
            "Steam remembered account",
            "Enter the account label exactly as Steam shows it in the remembered-account chooser.\n"
            "gameAccess will close Steam, reopen it, and click that already-authorized account."
            + hint,
        )
        if account:
            self._run_steam_switch(account.strip())

    def lease_selected(self):
        selected = self.tree.selection()
        if not selected:
            messagebox.showinfo("gameAccess", "Select a game first.")
            return
        game_id = int(selected[0])
        try:
            lease = self.api(
                "POST",
                "/leases",
                json={"user_id": USER_ID, "game_id": game_id, "minutes": int(self.minutes.get())},
            )
            self.current_lease_id = lease["lease_id"]
            self.current_account_label = lease["account"]["label"]
            self.status.config(
                text=f"Lease #{lease['lease_id']} reserved: {lease['game']['name']} via {self.current_account_label}"
            )

            use_switch = messagebox.askyesno(
                "Start Steam session",
                "The game lease is reserved.\n\n"
                "gameAccess can now close your current Steam session and select the remembered provider account "
                f"'{self.current_account_label}' from Steam's own account chooser.\n\n"
                "No password or Steam Guard secret is read by gameAccess. Continue?",
            )
            if use_switch:
                self._run_steam_switch(self.current_account_label)
            self.refresh()
        except Exception as exc:
            messagebox.showerror("Could not lease", str(exc))

    def release_current(self):
        if not self.current_lease_id:
            messagebox.showinfo("gameAccess", "No current lease in this launcher session.")
            return
        try:
            result = self.api("POST", f"/leases/{self.current_lease_id}/release")
            self.status.config(text=f"Lease released: {result['status']}")
            self.current_lease_id = None
            self.current_account_label = None
            self.refresh()
        except Exception as exc:
            messagebox.showerror("Release failed", str(exc))

    def earn_demo(self):
        try:
            result = self.api(
                "POST",
                "/credits",
                json={"user_id": USER_ID, "amount": 100, "reason": "rewarded-demo-action"},
            )
            self.status.config(text=f"Reward credited. Balance: {result['credits']}")
            self.refresh()
        except Exception as exc:
            messagebox.showerror("Credit failed", str(exc))


if __name__ == "__main__":
    Launcher().mainloop()
