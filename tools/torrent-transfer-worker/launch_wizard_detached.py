from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


here = Path(__file__).resolve().parent
wizard = here / "free_wizard.py"
python = Path(sys.executable)
pythonw = python.with_name("pythonw.exe") if os.name == "nt" else python
executable = pythonw if pythonw.exists() else python

kwargs: dict[str, object] = {"cwd": here}
if os.name == "nt":
    kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    kwargs["close_fds"] = True
else:
    kwargs["start_new_session"] = True

subprocess.Popen([str(executable), str(wizard)], **kwargs)
print("wizard launched detached")
