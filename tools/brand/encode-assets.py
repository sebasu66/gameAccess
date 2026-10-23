"""Encode the recorder archive into transparent VP9 assets outside the checkout."""
import argparse
import json
import shutil
import subprocess
import tarfile
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--recording", type=Path, required=True)
args = parser.parse_args()
root = args.recording.resolve()
frames = root / "frames"
frames.mkdir(exist_ok=True)
with tarfile.open(root / "gameaccess-animation-frames.tar") as archive:
    archive.extractall(frames, filter="data")
assets = root / "assets"
assets.mkdir(exist_ok=True)
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    raise SystemExit("ffmpeg is required")
settings = [
    ("loop", "logo-entry-loop.webm", 640, 24),
    ("loop", "logo-header-loop.webm", 192, 20),
    ("intro", "logo-intro.webm", None, 20),
    ("dock", "logo-to-header.webm", None, 20),
]
for clip, name, width, quality in settings:
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-framerate", "30",
               "-i", str(frames / clip / "frame_%05d.png")]
    if width:
        command += ["-vf", f"scale={width}:{width}:flags=lanczos"]
    command += ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0",
                "-crf", str(quality), "-deadline", "good", "-cpu-used", "4",
                "-row-mt", "1", "-threads", "4", "-auto-alt-ref", "0", "-an",
                str(assets / name)]
    print(f"Encoding {name}", flush=True)
    subprocess.run(command, check=True)
Image.open(frames / "loop" / "frame_00000.png").resize((640, 640), Image.Resampling.LANCZOS).save(assets / "logo-entry-poster.png")
# The small dock poster remains aligned with the header's established destination.
Image.open(frames / "dock" / "frame_00089.png").crop((22, 12, 106, 96)).save(assets / "logo-header-poster.png")
report = {
    "source": "tools/brand/animation-studio.html",
    "depthRange": "camera distance +/- 15 world units",
    "fps": 30, "entryResolution": [640, 640],
    "loopFrames": 858, "alpha": True,
    "assets": {p.name: p.stat().st_size for p in assets.iterdir()}
}
(root / "encoding-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
