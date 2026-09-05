from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "apps" / "api" / "app" / "main.py"
API = ROOT / "apps" / "desktop" / "src" / "api.ts"
BACKEND_TEST = ROOT / "apps" / "api" / "tests" / "test_lease_replacement.py"
DESKTOP_TEST = ROOT / "apps" / "desktop" / "src" / "leaseGuard.test.ts"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    MAIN,
    '''class LeaseRequest(BaseModel):\n    user_id: int\n    game_id: int\n    minutes: int = Field(ge=5, le=24 * 60)\n''',
    '''class LeaseRequest(BaseModel):\n    user_id: int\n    game_id: int\n    minutes: int = Field(ge=5, le=24 * 60)\n    replace_existing: bool = False\n''',
)

replace_once(
    MAIN,
    '''    if active_for_user:\n        raise HTTPException(409, "user already has an active lease")\n''',
    '''    if active_for_user:\n        if not req.replace_existing:\n            raise HTTPException(409, "user already has an active lease")\n        active_for_user.status = LeaseStatus.released\n        stale_account = session.get(ProviderAccount, active_for_user.account_id)\n        if stale_account and stale_account.status == AccountStatus.leased:\n            stale_account.status = AccountStatus.free\n            session.add(stale_account)\n        session.add(active_for_user)\n        session.commit()\n''',
)

replace_once(
    API,
    'import { getLocalSteamPool, getSteamStoreMetadata, switchSteamAccount, loginProviderSteam } from "./native";',
    'import { getLocalSteamPool, getSteamStoreMetadata, getSteamSessionStatus, switchSteamAccount, loginProviderSteam } from "./native";',
)

replace_once(
    API,
    '''  const lease = await request<LeaseResponse>("/leases", { method: "POST", body: JSON.stringify({ user_id: 1, game_id: gameId, minutes }) });''',
    '''  const session = await getSteamSessionStatus().catch(() => null);\n  if (session && session.appId && !session.done && session.phase !== "idle") {\n    throw new Error("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");\n  }\n\n  const lease = await request<LeaseResponse>("/leases", {\n    method: "POST",\n    body: JSON.stringify({ user_id: 1, game_id: gameId, minutes, replace_existing: true }),\n  });''',
)

BACKEND_TEST.write_text('''from datetime import timedelta\n\nfrom fastapi import HTTPException\nfrom sqlmodel import Session, SQLModel, create_engine\n\nfrom app import main as core\n\n\ndef _seed(session: Session):\n    user = core.User(username="lease-replace-user", credits=1000)\n    first_game = core.Game(slug="first", name="First", credit_cost_per_hour=0)\n    second_game = core.Game(slug="second", name="Second", credit_cost_per_hour=0)\n    first_account = core.ProviderAccount(label="first-account", status=core.AccountStatus.leased)\n    second_account = core.ProviderAccount(label="second-account", status=core.AccountStatus.free)\n    session.add_all([user, first_game, second_game, first_account, second_account])\n    session.commit()\n    for item in [user, first_game, second_game, first_account, second_account]:\n        session.refresh(item)\n    session.add(core.AccountGame(account_id=first_account.id, game_id=first_game.id))\n    session.add(core.AccountGame(account_id=second_account.id, game_id=second_game.id))\n    old = core.Lease(\n        user_id=user.id,\n        game_id=first_game.id,\n        account_id=first_account.id,\n        starts_at=core.now_utc(),\n        expires_at=core.now_utc() + timedelta(hours=1),\n        credits_spent=0,\n    )\n    session.add(old)\n    session.commit()\n    session.refresh(old)\n    return user, second_game, first_account, second_account, old\n\n\ndef test_active_lease_still_conflicts_without_explicit_replace(tmp_path):\n    engine = create_engine(f"sqlite:///{tmp_path / 'lease-conflict.db'}")\n    SQLModel.metadata.create_all(engine)\n    with Session(engine) as session:\n        user, second_game, _, _, _ = _seed(session)\n        try:\n            core.create_lease(core.LeaseRequest(user_id=user.id, game_id=second_game.id, minutes=60), session)\n        except HTTPException as exc:\n            assert exc.status_code == 409\n        else:\n            raise AssertionError("expected active lease conflict")\n\n\ndef test_explicit_replace_releases_stale_lease_and_reuses_pool(tmp_path):\n    engine = create_engine(f"sqlite:///{tmp_path / 'lease-replace.db'}")\n    SQLModel.metadata.create_all(engine)\n    with Session(engine) as session:\n        user, second_game, first_account, second_account, old = _seed(session)\n        result = core.create_lease(\n            core.LeaseRequest(user_id=user.id, game_id=second_game.id, minutes=60, replace_existing=True),\n            session,\n        )\n        session.refresh(old)\n        session.refresh(first_account)\n        session.refresh(second_account)\n        assert old.status == core.LeaseStatus.released\n        assert first_account.status == core.AccountStatus.free\n        assert result["lease_id"] != old.id\n        created = session.get(core.Lease, result["lease_id"])\n        assert created is not None and created.status == core.LeaseStatus.active\n        assert second_account.status == core.AccountStatus.leased\n''', encoding="utf-8")

DESKTOP_TEST.write_text('''import { describe, expect, it } from "vitest";\nimport { readFileSync } from "node:fs";\n\nconst source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");\n\ndescribe("GameAccess lease guard", () => {\n  it("blocks a second GameAccess lease only while a tracked Steam game session is active", () => {\n    expect(source).toContain("getSteamSessionStatus");\n    expect(source).toContain("session.appId && !session.done");\n    expect(source).toContain("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");\n  });\n\n  it("explicitly asks the backend to replace a stale active lease", () => {\n    expect(source).toContain("replace_existing: true");\n  });\n});\n''', encoding="utf-8")

print("stale lease replacement patch written")
