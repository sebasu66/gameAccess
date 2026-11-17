from pathlib import Path
import subprocess

repo = Path(r'C:\DEV\Game Access Dev')
launcher = repo / 'START_GAMEACCESS_DEV_LAB.cmd'
flags = subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP
proc = subprocess.Popen(['cmd.exe', '/c', str(launcher)], cwd=str(repo), creationflags=flags, close_fds=True)
print(f'Game Access Dev Lab visible console started as PID {proc.pid}')
