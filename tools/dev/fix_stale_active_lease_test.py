from pathlib import Path

path = Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src" / "leaseGuard.test.ts"
path.write_text('''import { describe, expect, it } from "vitest";\nimport source from "./api.ts?raw";\n\ndescribe("GameAccess lease guard", () => {\n  it("blocks a second GameAccess lease only while a tracked Steam game session is active", () => {\n    expect(source).toContain("getSteamSessionStatus");\n    expect(source).toContain("session.appId && !session.done");\n    expect(source).toContain("Ya hay un juego en ejecución. Cerralo antes de iniciar otro.");\n  });\n\n  it("explicitly asks the backend to replace a stale active lease", () => {\n    expect(source).toContain("replace_existing: true");\n  });\n});\n''', encoding="utf-8")
print("lease guard test rewritten for Vite")
