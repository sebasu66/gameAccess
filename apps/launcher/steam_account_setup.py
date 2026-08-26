"""Manual Steam account setup helper for gameAccess.

Steam's current Subscriber Agreement explicitly prohibits automating the Steam
account creation process. This helper therefore does *not* click, submit,
solve CAPTCHA, verify email, or create the account for the user.

What it does safely:
- generate a candidate Steam account name;
- generate a strong random password locally;
- open Steam's official account creation page in the default browser;
- print the values once so the human can complete Steam's own signup flow;
- never write credentials to disk, Git, the gameAccess database, or logs.

After the account has been created manually and remembered in the local Steam
client, gameAccess's existing remembered-account/pool discovery can detect it.
"""

from __future__ import annotations

import argparse
import secrets
import string
import sys
import webbrowser
from dataclasses import dataclass

STEAM_JOIN_URL = "https://store.steampowered.com/join/?l=latam"


@dataclass(frozen=True)
class AccountCandidate:
    account_name: str
    password: str


def _safe_prefix(value: str) -> str:
    cleaned = "".join(ch.lower() for ch in value if ch.isalnum() or ch == "_")
    cleaned = cleaned.strip("_")
    return cleaned[:20] or "gameaccess"


def generate_account_name(prefix: str = "gameaccess") -> str:
    """Generate a human-readable candidate login name.

    Availability is ultimately decided by Steam during the manual signup flow.
    """
    prefix = _safe_prefix(prefix)
    suffix = secrets.token_hex(3)
    return f"{prefix}_{suffix}"


def generate_password(length: int = 22) -> str:
    """Generate a strong password using characters accepted by most forms."""
    length = max(16, min(length, 64))
    alphabet = string.ascii_letters + string.digits + "!@#$%*-_+"

    # Guarantee a mix instead of relying only on probability.
    required = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%*-_+"),
    ]
    remaining = [secrets.choice(alphabet) for _ in range(length - len(required))]
    chars = required + remaining
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def create_candidate(prefix: str, password_length: int) -> AccountCandidate:
    return AccountCandidate(
        account_name=generate_account_name(prefix),
        password=generate_password(password_length),
    )


def print_instructions(candidate: AccountCandidate) -> None:
    print()
    print("Steam account setup (manual)")
    print("=" * 34)
    print(f"Candidate account name : {candidate.account_name}")
    print(f"Generated password     : {candidate.password}")
    print()
    print("Complete these steps yourself in Steam's page:")
    print("  1. Enter and confirm the email address.")
    print("  2. Complete Steam's CAPTCHA / human verification.")
    print("  3. Accept Steam's terms if you agree with them.")
    print("  4. Verify the email from Steam.")
    print("  5. Use the candidate account name (or a Steam suggestion).")
    print("  6. Enter the generated password and finish signup.")
    print("  7. Log into the Steam client and choose to remember the account.")
    print()
    print("The password is intentionally not saved anywhere by this script.")
    print("If you close this terminal before storing it safely, it cannot be recovered.")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate local credentials and open Steam's official signup page. "
            "All Steam interaction remains manual."
        )
    )
    parser.add_argument(
        "--prefix",
        default="gameaccess",
        help="prefix for the candidate Steam login name (default: gameaccess)",
    )
    parser.add_argument(
        "--password-length",
        type=int,
        default=22,
        help="generated password length, clamped to 16-64 (default: 22)",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="do not open the Steam signup page",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    candidate = create_candidate(args.prefix, args.password_length)
    print_instructions(candidate)

    if not args.no_open:
        opened = webbrowser.open(STEAM_JOIN_URL, new=2)
        if not opened:
            print(f"Could not open the browser automatically. Open: {STEAM_JOIN_URL}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
