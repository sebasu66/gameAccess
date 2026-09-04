import os
import threading
import tkinter as tk
from tkinter import messagebox, ttk

import requests

from steam_switch import list_remembered_accounts, switch_to_remembered_account

API = os.environ.get("GAMEACCESS_API", "http://127.0.0.1:38147")
USER_ID = int(os.environ.get("GAMEACCESS_USER_ID", "1"))


class Launcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("gameAccess")
        self.geometry("820x570")
        self.resizable(True, True)
        self.games = []
        self.current_lease_id = None
        self.current_account_label = None
        self.remembered_accounts = []

        header = ttk.Frame(self, padding=16)
        header.pack(fill="x")
        ttk.Label(header, text="gameAccess", font=("Segoe UI", 20, "bold")).pack(side="left")
        self.credits_label = ttk.Label(header, text="Créditos: ...")
        self.credits_label.pack(side="right")

        controls = ttk.Frame(self, padding=(16, 0, 16, 8))
        controls.pack(fill="x")
        ttk.Label(controls, text="Minutos de sesión:").pack(side="left")
        self.minutes = tk.IntVar(value=60)
        ttk.Spinbox(controls, from_=5, to=1440, textvariable=self.minutes, width=8).pack(side="left", padx=8)
        ttk.Button(controls, text="Actualizar", command=self.refresh).pack(side="right")

        self.tree = ttk.Treeview(self, columns=("availability", "price"), show="tree headings", height=15)
        self.tree.heading("#0", text="Juego")
        self.tree.heading("availability", text="Disponibles")
        self.tree.heading("price", text="Créditos/hora")
        self.tree.column("#0", width=420)
        self.tree.column("availability", width=130, anchor="center")
        self.tree.column("price", width=140, anchor="center")
        self.tree.pack(fill="both", expand=True, padx=16, pady=8)

        footer = ttk.Frame(self, padding=16)
        footer.pack(fill="x")
        self.play_btn = ttk.Button(footer, text="Reservar y jugar", command=self.lease_selected)
        self.play_btn.pack(side="left")
        self.release_btn = ttk.Button(footer, text="Liberar sesión", command=self.release_current)
        self.release_btn.pack(side="left", padx=8)
        ttk.Button(footer, text="Cuentas Steam", command=self.open_steam_accounts).pack(side="left", padx=8)
        ttk.Button(footer, text="+100 créditos demo", command=self.earn_demo).pack(side="right")

        self.status = ttk.Label(self, text="Listo", padding=(16, 0, 16, 12))
        self.status.pack(fill="x")

        self.refresh()

    def api(self, method, path, **kwargs):
        try:
            response = requests.request(method, API + path, timeout=8, **kwargs)
            if not response.ok:
                try:
                    detail = response.json().get("detail", response.text)
                except Exception:
                    detail = response.text
                raise RuntimeError(detail)
            return response.json()
        except requests.exceptions.ConnectionError as exc:
            raise RuntimeError("El servicio local de gameAccess no está iniciado (127.0.0.1:8000).") from exc
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"API error: {exc}") from exc

    def refresh(self):
        try:
            user = self.api("GET", f"/users/{USER_ID}")
            self.credits_label.config(text=f"Créditos: {user['credits']}")
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
            self.status.config(text="Catálogo actualizado")
        except Exception as exc:
            self.status.config(text=str(exc))

    # ---------------------------- Steam accounts ----------------------------
    def open_steam_accounts(self):
        self.status.config(text="Detectando cuentas recordadas por Steam...")

        def work():
            result, accounts = list_remembered_accounts(open_chooser=True)
            self.after(0, lambda: self._steam_accounts_ready(result, accounts))

        threading.Thread(target=work, daemon=True).start()

    def _steam_accounts_ready(self, result, accounts):
        if not result.ok:
            self.status.config(text=f"No se pudieron detectar las cuentas de Steam: {result.message}")
            messagebox.showwarning("Cuentas Steam", result.message)
            return
        self.remembered_accounts = accounts
        self.status.config(text=f"Steam: {len(accounts)} cuenta(s) recordada(s) detectada(s)")
        self._show_steam_accounts_window(accounts)

    def _show_steam_accounts_window(self, accounts):
        try:
            backend_accounts = self.api("GET", "/admin/accounts")
        except Exception as exc:
            messagebox.showerror("Cuentas Steam", str(exc))
            return

        win = tk.Toplevel(self)
        win.title("gameAccess — Inventario Steam local")
        win.geometry("760x510")
        win.minsize(700, 460)
        win.transient(self)

        body = ttk.Frame(win, padding=16)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text="Cuentas recordadas por Steam", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            body,
            text=(
                "Estas cuentas se leen únicamente de la pantalla visible de Steam. "
                "No se leen contraseñas, Steam Guard ni tokens. Seleccioná una cuenta y marcá qué juegos del catálogo posee."
            ),
            wraplength=710,
            justify="left",
        ).pack(anchor="w", pady=(3, 12))

        account_tree = ttk.Treeview(body, columns=("account",), show="tree headings", height=7)
        account_tree.heading("#0", text="Nombre visible")
        account_tree.heading("account", text="Nombre de cuenta")
        account_tree.column("#0", width=330)
        account_tree.column("account", width=330)
        account_tree.pack(fill="x")

        for index, account in enumerate(accounts):
            account_tree.insert("", "end", iid=str(index), text=account.display_name, values=(account.account_name,))

        games_frame = ttk.LabelFrame(body, text="Juegos que posee la cuenta seleccionada", padding=10)
        games_frame.pack(fill="both", expand=True, pady=(12, 0))
        games_list = tk.Listbox(games_frame, selectmode="multiple", exportselection=False, height=8)
        games_list.pack(fill="both", expand=True)
        for game in self.games:
            games_list.insert("end", game["name"])

        current_by_label = {str(row["label"]).casefold(): row for row in backend_accounts}

        def selected_account():
            selection = account_tree.selection()
            if not selection:
                return None
            return accounts[int(selection[0])]

        def load_account_games(_event=None):
            games_list.selection_clear(0, "end")
            account = selected_account()
            if account is None:
                return
            row = current_by_label.get(account.account_name.casefold()) or current_by_label.get(account.display_name.casefold())
            if not row:
                return
            owned_ids = {int(game["id"]) for game in row.get("games", [])}
            for index, game in enumerate(self.games):
                if int(game["id"]) in owned_ids:
                    games_list.selection_set(index)

        account_tree.bind("<<TreeviewSelect>>", load_account_games)
        if accounts:
            account_tree.selection_set("0")
            account_tree.focus("0")
            load_account_games()

        buttons = ttk.Frame(body)
        buttons.pack(fill="x", pady=(12, 0))

        def save_inventory():
            account = selected_account()
            if account is None:
                messagebox.showinfo("Inventario Steam", "Seleccioná una cuenta primero.", parent=win)
                return
            game_ids = [int(self.games[index]["id"]) for index in games_list.curselection()]
            try:
                result = self.api(
                    "POST",
                    "/admin/accounts/sync",
                    json={
                        "label": account.account_name,
                        "provider": "steam",
                        "game_ids": game_ids,
                        "notes": "Local Steam account discovered from the visible remembered-account chooser",
                    },
                )
                current_by_label[account.account_name.casefold()] = {
                    "label": account.account_name,
                    "games": [{"id": game_id} for game_id in game_ids],
                }
                self.refresh()
                messagebox.showinfo(
                    "Inventario guardado",
                    f"{account.display_name}: {len(game_ids)} juego(s) asociado(s).",
                    parent=win,
                )
            except Exception as exc:
                messagebox.showerror("Inventario Steam", str(exc), parent=win)

        def test_switch():
            account = selected_account()
            if account is None:
                messagebox.showinfo("Cuentas Steam", "Seleccioná una cuenta primero.", parent=win)
                return
            self._run_steam_switch(account.account_name)

        ttk.Button(buttons, text="Probar cambio a esta cuenta", command=test_switch).pack(side="left")
        ttk.Button(buttons, text="Guardar inventario", command=save_inventory).pack(side="right")
        ttk.Button(buttons, text="Cerrar", command=win.destroy).pack(side="right", padx=(0, 8))

    # ------------------------------ Steam switch ----------------------------
    def _run_steam_switch(self, account_label: str):
        self.status.config(text=f"Cambiando Steam a {account_label}...")

        def work():
            result = switch_to_remembered_account(account_label)
            self.after(0, lambda: self._steam_switch_finished(result))

        threading.Thread(target=work, daemon=True).start()

    def _steam_switch_finished(self, result):
        if result.ok:
            self.status.config(text=result.message)
            messagebox.showinfo("Steam listo", result.message)
        else:
            self.status.config(text=f"Falló el cambio de cuenta: {result.message}")
            messagebox.showwarning("Cambio de cuenta Steam", result.message)

    # -------------------------------- leases --------------------------------
    def lease_selected(self):
        selected = self.tree.selection()
        if not selected:
            messagebox.showinfo("gameAccess", "Seleccioná un juego primero.")
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
                text=f"Reserva #{lease['lease_id']}: {lease['game']['name']} — iniciando Steam"
            )

            use_switch = messagebox.askyesno(
                "Iniciar sesión temporal de Steam",
                "La reserva está lista.\n\n"
                "gameAccess cerrará o reutilizará la pantalla de selección de Steam y elegirá automáticamente "
                "la cuenta del inventario asignada a este juego.\n\n"
                "No se leen contraseñas ni secretos de Steam Guard. ¿Continuar?",
            )
            if use_switch:
                self._run_steam_switch(self.current_account_label)
            self.refresh()
        except Exception as exc:
            messagebox.showerror("No se pudo reservar", str(exc))

    def release_current(self):
        if not self.current_lease_id:
            messagebox.showinfo("gameAccess", "No hay una sesión activa en este launcher.")
            return
        try:
            result = self.api("POST", f"/leases/{self.current_lease_id}/release")
            self.status.config(text=f"Sesión liberada: {result['status']}")
            self.current_lease_id = None
            self.current_account_label = None
            self.refresh()
        except Exception as exc:
            messagebox.showerror("No se pudo liberar", str(exc))

    def earn_demo(self):
        try:
            result = self.api(
                "POST",
                "/credits",
                json={"user_id": USER_ID, "amount": 100, "reason": "rewarded-demo-action"},
            )
            self.status.config(text=f"Crédito demo agregado. Saldo: {result['credits']}")
            self.refresh()
        except Exception as exc:
            messagebox.showerror("No se pudo acreditar", str(exc))


if __name__ == "__main__":
    Launcher().mainloop()
