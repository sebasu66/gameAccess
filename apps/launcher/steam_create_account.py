from __future__ import annotations

import argparse
import getpass
import secrets
import string
import sys
import time
from dataclasses import dataclass
from typing import Iterable

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.select import Select
from selenium.webdriver.support.ui import WebDriverWait

JOIN_URL = "https://store.steampowered.com/join/?l=spanish"


@dataclass
class Credentials:
    email: str
    account_name: str
    password: str


def generate_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%_-"
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(ch.islower() for ch in value)
            and any(ch.isupper() for ch in value)
            and any(ch.isdigit() for ch in value)
            and any(not ch.isalnum() for ch in value)
        ):
            return value


def first(driver, selectors: Iterable[tuple[str, str]], timeout: float = 2.0):
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        for by, selector in selectors:
            try:
                elements = driver.find_elements(by, selector)
                for element in elements:
                    if element.is_displayed():
                        return element
            except Exception as exc:  # page can re-render between calls
                last_error = exc
        time.sleep(0.15)
    if last_error:
        raise last_error
    return None


def wait_first(driver, selectors: Iterable[tuple[str, str]], timeout: float = 30.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        element = first(driver, selectors, timeout=0.4)
        if element is not None:
            return element
        time.sleep(0.2)
    raise TimeoutException(f"No apareció ninguno de los selectores esperados: {list(selectors)}")


def set_text(element, value: str) -> None:
    element.click()
    element.clear()
    element.send_keys(value)


def click_if_present(driver, selectors: Iterable[tuple[str, str]], timeout: float = 1.5) -> bool:
    element = first(driver, selectors, timeout=timeout)
    if element is None:
        return False
    try:
        element.click()
        return True
    except Exception:
        driver.execute_script("arguments[0].click();", element)
        return True


def choose_country(driver, country: str | None) -> None:
    if not country:
        return
    select_element = first(
        driver,
        [
            (By.ID, "country"),
            (By.NAME, "country"),
            (By.CSS_SELECTOR, "select[name*='country' i]"),
        ],
        timeout=2.0,
    )
    if select_element is None:
        return
    select = Select(select_element)
    wanted = country.strip().casefold()
    for option in select.options:
        if option.text.strip().casefold() == wanted:
            select.select_by_visible_text(option.text)
            return
    # Accept common country-code inputs too, e.g. AR.
    try:
        select.select_by_value(country.upper())
    except Exception:
        print(f"[aviso] No pude seleccionar el país '{country}'. Steam dejó su valor actual.")


def fill_email_step(driver, email: str, country: str | None) -> None:
    email_box = wait_first(
        driver,
        [
            (By.ID, "email"),
            (By.NAME, "email"),
            (By.CSS_SELECTOR, "input[type='email']"),
        ],
        timeout=30,
    )
    set_text(email_box, email)

    repeat = first(
        driver,
        [
            (By.ID, "reenter_email"),
            (By.NAME, "reenter_email"),
            (By.CSS_SELECTOR, "input[name*='reenter' i]"),
        ],
        timeout=2,
    )
    if repeat is not None:
        set_text(repeat, email)

    choose_country(driver, country)

    agree = first(
        driver,
        [
            (By.ID, "i_agree_check"),
            (By.NAME, "i_agree_check"),
            (By.CSS_SELECTOR, "input[type='checkbox']"),
        ],
        timeout=2,
    )
    if agree is not None and not agree.is_selected():
        try:
            agree.click()
        except Exception:
            driver.execute_script("arguments[0].click();", agree)


def account_name_field(driver):
    return first(
        driver,
        [
            (By.ID, "accountname"),
            (By.NAME, "accountname"),
            (By.CSS_SELECTOR, "input[name*='accountname' i]"),
        ],
        timeout=0.5,
    )


def wait_for_verified_email(driver, timeout: int = 900):
    print("\nSteam puede pedir CAPTCHA y verificación por email.")
    print("Completá cualquier CAPTCHA en la ventana del navegador y abrí el enlace que Steam envíe al email.")
    print("No cierres esta ventana; el script seguirá cuando aparezca el formulario de usuario/contraseña.\n")

    # Clicking Continue is deliberately best-effort. If a CAPTCHA blocks it, the user solves it visibly.
    click_if_present(
        driver,
        [
            (By.ID, "createAccountButton"),
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.CSS_SELECTOR, "input[type='submit']"),
        ],
        timeout=1.0,
    )

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        field = account_name_field(driver)
        if field is not None:
            return field
        time.sleep(1.0)
    raise TimeoutException("Pasó el tiempo máximo esperando la verificación de email de Steam.")


def fill_credentials_step(driver, account_name: str, password: str) -> None:
    account = account_name_field(driver) or wait_first(
        driver,
        [(By.ID, "accountname"), (By.NAME, "accountname")],
        timeout=30,
    )
    set_text(account, account_name)

    password_box = wait_first(
        driver,
        [
            (By.ID, "password"),
            (By.NAME, "password"),
            (By.CSS_SELECTOR, "input[type='password']"),
        ],
        timeout=15,
    )
    set_text(password_box, password)

    repeat = first(
        driver,
        [
            (By.ID, "reenter_password"),
            (By.NAME, "reenter_password"),
            (By.CSS_SELECTOR, "input[name*='reenter' i][type='password']"),
        ],
        timeout=2,
    )
    if repeat is not None:
        set_text(repeat, password)


def create_driver(browser: str):
    if browser == "edge":
        options = webdriver.EdgeOptions()
        options.add_argument("--start-maximized")
        return webdriver.Edge(options=options)

    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")
    return webdriver.Chrome(options=options)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Asistente visible con Selenium para crear UNA cuenta de Steam. "
            "Completa formularios, pero deja CAPTCHA y verificación de email al humano."
        )
    )
    parser.add_argument("--email", help="Email a usar. Steam admite varias cuentas asociadas al mismo email.")
    parser.add_argument("--account-name", help="Nombre deseado para la cuenta Steam.")
    parser.add_argument("--password", help="Contraseña. Si se omite, se pide sin eco; --generate-password crea una fuerte.")
    parser.add_argument("--generate-password", action="store_true", help="Generar una contraseña aleatoria fuerte.")
    parser.add_argument("--country", default="Argentina", help="País mostrado en el formulario, por defecto Argentina.")
    parser.add_argument("--browser", choices=["chrome", "edge"], default="chrome")
    parser.add_argument("--verify-timeout", type=int, default=900, help="Segundos para esperar la verificación manual por email.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    email = (args.email or input("Email: ")).strip()
    account_name = (args.account_name or input("Nombre de cuenta Steam: ")).strip()
    if not email or not account_name:
        print("Email y nombre de cuenta son obligatorios.", file=sys.stderr)
        return 2

    if args.generate_password:
        password = generate_password()
        print(f"Contraseña generada: {password}")
        print("Guardala en tu gestor de contraseñas; gameAccess no la escribe en ningún archivo.")
    else:
        password = args.password or getpass.getpass("Contraseña Steam: ")

    credentials = Credentials(email=email, account_name=account_name, password=password)
    driver = create_driver(args.browser)

    try:
        driver.get(JOIN_URL)
        fill_email_step(driver, credentials.email, args.country)
        wait_for_verified_email(driver, timeout=args.verify_timeout)
        fill_credentials_step(driver, credentials.account_name, credentials.password)

        print("\nUsuario y contraseña cargados.")
        print("Revisá la ventana y pulsá el botón final de Steam. Si Steam pide otra validación, completala manualmente.")
        input("Cuando la cuenta esté creada, presioná ENTER acá para cerrar Selenium... ")
        return 0
    except KeyboardInterrupt:
        print("\nCancelado por el usuario.")
        return 130
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
