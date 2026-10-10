#!/usr/bin/env python3
"""GameAccess editorial video production. Python stdlib + FFmpeg, operator-only."""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import math
import os
import re
import subprocess
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = "gemini-3.8-flash-tts"
STYLE = "Spanish Latin American neutral accent. Warm, clear, practical game presenter. Natural medium pace. Read the transcript exactly, without adding words."
IDS = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def request_json(url, body=None, key=None):
    headers = {"User-Agent": "GameAccess-Editorial/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if key:
        headers["x-goog-api-key"] = key
    request = urllib.request.Request(url, None if body is None else json.dumps(body).encode(), headers)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never print headers, credential values, or the full remote request.
        raise RuntimeError(f"Provider returned HTTP {error.code} for {urllib.parse.urlsplit(url).hostname}") from None


def clean_text(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))).strip()


def collect(app_id, output):
    store_url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=spanish"
    response = request_json(store_url).get(str(app_id), {})
    if not response.get("success"):
        raise ValueError("Steam did not return a released game record.")
    data = response["data"]
    params = urllib.parse.urlencode({"json": 1, "language": "all", "purchase_type": "steam",
                                    "review_type": "all", "filter": "all", "num_per_page": 1})
    reviews_url = f"https://store.steampowered.com/appreviews/{app_id}?{params}"
    reviews = request_json(reviews_url)
    if reviews.get("success") != 1:
        raise ValueError("Steam review request failed; do not invent a rating.")
    summary = reviews.get("query_summary", {})
    total = summary.get("total_reviews", 0)
    requirements = data.get("pc_requirements")
    if not isinstance(requirements, dict):
        requirements = {}
    facts = {"app_id": app_id, "name": data["name"], "platform": "PC",
             "checked_at": datetime.now(timezone.utc).isoformat(),
             "short_description": clean_text(data.get("short_description")),
             "release": data.get("release_date"), "categories": data.get("categories", []),
             "genres": data.get("genres", []), "supported_languages": clean_text(data.get("supported_languages")),
             "pc_requirements": {k: clean_text(v) for k, v in requirements.items()},
             "age_ratings": data.get("ratings", {}),
             "reviews": {"positive_percent": round(summary["total_positive"] * 100 / total) if total else None,
                         "count": total, "label": summary.get("review_score_desc"),
                         "scope": "all languages; Steam purchases; all review types; overall"},
             "sources": [{"label": "Steam Store", "url": store_url}, {"label": "Steam reviews", "url": reviews_url}],
             "editorial": {"play_with": None, "distinctive_features": [], "co_optimus_url": None},
             "official_movies": data.get("movies", []), "screenshots": data.get("screenshots", [])}
    write_json(output, facts)
    return facts


def validate_episode(episode):
    if episode.get("format_version") != 1 or episode.get("locale") not in ("es", "en"):
        raise ValueError("Episode requires format_version=1 and locale es/en.")
    if not isinstance(episode.get("app_id"), int) or episode["app_id"] < 1:
        raise ValueError("Use the real positive Steam AppID.")
    sections = episode.get("sections", [])
    if not sections:
        raise ValueError("At least one narrated section is required.")
    seen = set()
    for section in sections + ([episode["closing"]] if episode.get("closing") else []):
        ident = section.get("id", "")
        if not IDS.fullmatch(ident) or ident in seen:
            raise ValueError("Section IDs must be unique safe slugs.")
        seen.add(ident)
        if not clean_text(section.get("text")):
            raise ValueError(f"Missing literal narration for {ident}.")
    if episode.get("gameplay") and float(episode["gameplay"].get("duration", 0)) <= 0:
        raise ValueError("Gameplay must have a positive duration.")
    music = episode.get("music")
    if music:
        if not isinstance(music, dict):
            raise ValueError("Music must be an object with a path or preset.")
        if not music.get("path") and music.get("preset", "racing") != "racing":
            raise ValueError("Unknown music preset; use racing or a local music path.")
        bpm = float(music.get("bpm", 126))
        if not math.isfinite(bpm) or not 60 <= bpm <= 180:
            raise ValueError("Music bpm must be between 60 and 180.")


def draft(facts, output):
    """Produce an editable factual draft; audience recommendations need editorial evidence."""
    rating = facts["reviews"]
    text = (f"En Steam tiene un {rating['positive_percent']} por ciento de reseñas positivas, "
            f"sobre {rating['count']} opiniones de compradores en Steam."
            if rating["positive_percent"] is not None else "Todavía no hay suficientes reseñas para informar una valoración.")
    audience = facts.get("editorial", {}).get("play_with")
    sections = [
        {"id": "hook", "title": facts["name"], "text": f"Hoy en Game Access: {facts['name']}. Veamos qué ofrece y cómo se juega."},
        {"id": "about", "title": "Qué ofrece", "text": facts["short_description"]},
        {"id": "reviews", "title": "Valoración en Steam", "text": text},
    ]
    if audience:
        sections.append({"id": "players", "title": "Con quién jugar", "text": audience})
    for i, feature in enumerate(facts.get("editorial", {}).get("distinctive_features", [])):
        sections.append({"id": f"feature-{i + 1}", "title": "Para tener en cuenta", "text": feature})
    sections.append({"id": "gameplay", "title": "Gameplay", "text": "Ahora mirá cómo se juega, para decidir si es para vos."})
    episode = {"format_version": 1, "app_id": facts["app_id"], "name": facts["name"], "locale": "es",
               "facts_checked_at": facts["checked_at"], "sources": facts["sources"],
               "model": MODEL, "voice": "Kore", "style": STYLE,
               "sections": sections, "gameplay": None, "editorial_reviewed": False}
    write_json(output, episode)


def decode_audio(response):
    blocks = [content for step in response.get("steps", []) if step.get("type") == "model_output"
              for content in step.get("content", []) if content.get("type") == "audio"]
    if not blocks:
        raise ValueError("Gemini returned no audio.")
    block = blocks[-1]
    audio = base64.b64decode(block["data"], validate=True)
    mime = block.get("mime_type", "audio/wav")
    if mime.startswith("audio/wav"):
        if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
            raise ValueError("Provider labelled audio WAV but returned an invalid container.")
        return audio
    if mime.startswith("audio/l16"):
        import io
        match = re.search(r"rate=(\d+)", mime)
        rate = int(match.group(1)) if match else 24000
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(audio)
        return buffer.getvalue()
    raise ValueError(f"Unsupported audio MIME: {mime}")


def synthesize(section, episode, path, key):
    style = section.get("style") or episode.get("style") or (STYLE if episode["locale"] == "es" else "Warm, clear game presenter. Natural medium pace. Read the transcript exactly.")
    body = {"model": episode.get("model", MODEL), "input": [{"type": "user_input", "content": [
        {"type": "text", "text": section["text"], "annotations": [{"type": "speech_metadata", "style": style}]}]}],
        "response_format": {"type": "audio", "mime_type": "audio/wav"},
        "generation_config": {"speech_config": [{"voice": episode.get("voice", "Kore")}]}}
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    cache = path.with_suffix(".sha256")
    if path.exists() and cache.exists() and cache.read_text() == fingerprint:
        return
    audio = decode_audio(request_json("https://generativelanguage.googleapis.com/v1beta/interactions", body, key))
    # Validate before replacing an existing generated voice.
    import io
    with wave.open(io.BytesIO(audio), "rb") as wav:
        if wav.getnframes() == 0:
            raise ValueError("Empty TTS audio.")
    path.write_bytes(audio)
    cache.write_text(fingerprint)


def run(*args, cwd=None):
    return subprocess.run([str(arg) for arg in args], check=True, cwd=cwd,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")


def duration(path):
    result = run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path)
    seconds = float(json.loads(result.stdout)["format"]["duration"])
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError(f"Invalid media duration: {path.name}")
    return seconds


def timestamp(seconds, separator="."):
    milliseconds = round(seconds * 1000)
    hours, rest = divmod(milliseconds, 3600000)
    minutes, rest = divmod(rest, 60000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}{separator}{millis:03}"


def captions(text, start, speech_duration):
    # Sentence timings are proportional estimates within exact section audio boundaries.
    sentences = re.split(r"(?<=[.!?])\s+", clean_text(text))
    weights = sum(len(s) for s in sentences)
    cues = []
    for sentence in sentences:
        end = start + speech_duration * len(sentence) / weights
        cues.append((start, end, "\n".join(textwrap.wrap(sentence, 46))))
        start = end
    return cues


def media_input(media, base, seconds):
    path = (base / media["path"]).resolve()
    if not path.is_file():
        raise ValueError(f"Missing media file: {path}")
    if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
        return ["-loop", "1", "-i", path]
    if media.get("repeat_background"):
        return ["-stream_loop", "-1", "-i", path]
    offset = float(media.get("start", 0))
    if offset < 0 or duration(path) + 0.05 < offset + seconds:
        raise ValueError(f"Clip {path.name} is too short. Select another clip; footage is not repeated to extend it.")
    return ["-ss", str(offset), "-i", path]


def operator_key():
    """Prefer the operator's Windows vault entry; otherwise use configured environment."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class Credential(ctypes.Structure):
            _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
                        ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
                        ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
                        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wintypes.DWORD),
                        ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                        ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]
        api = ctypes.WinDLL("advapi32", use_last_error=True)
        api.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 ctypes.POINTER(ctypes.POINTER(Credential))]
        api.CredReadW.restype = wintypes.BOOL
        api.CredFree.argtypes = [ctypes.c_void_p]
        api.CredFree.restype = None
        pointer = ctypes.POINTER(Credential)()
        if api.CredReadW("GameAccess/GeminiAPIKey", 1, 0, ctypes.byref(pointer)):
            try:
                record = pointer.contents
                return ctypes.string_at(record.CredentialBlob, record.CredentialBlobSize).decode("utf-8")
            finally:
                api.CredFree(pointer)
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def trim_logo_sound(source, output):
    """Remove only detected trailing silence, retaining a short natural decay."""
    seconds = duration(source)
    detection = run("ffmpeg", "-hide_banner", "-i", source, "-af",
                    "silencedetect=noise=-50dB:d=0.3", "-f", "null", "-")
    starts = re.findall(r"silence_start: ([\d.]+)", detection.stderr)
    ends = re.findall(r"silence_end: ([\d.]+)", detection.stderr)
    if starts and ends and float(ends[-1]) >= seconds - .05:
        seconds = min(seconds, float(starts[-1]) + .12)
    run("ffmpeg", "-y", "-v", "error", "-i", source, "-t", str(seconds),
        "-af", f"afade=t=out:st={max(0, seconds - .08)}:d=0.08,loudnorm=I=-18:TP=-2:LRA=11",
        "-ar", "48000", "-ac", "2", output)
    return duration(output)


def brand_background(episode, base, width, height, start=0):
    path = episode.get("brand", {}).get("background")
    if path:
        path = (base / path).resolve()
        if not path.is_file():
            raise ValueError(f"Missing supplied brand background: {path}")
        return ["-stream_loop", "-1", "-ss", str(start), "-i", path]
    return ["-f", "lavfi", "-i", f"color=c=0x111416:s={width}x{height}:r=30"]


def brand_segment(output, target, vf, encoding, episode, base, height):
    from design import brand_text
    intro = ROOT / "apps/desktop/public/brand/logo-intro.webm"
    config = read_json(ROOT / "apps/desktop/public/brand/opening-audio.json")
    sound = ROOT / "apps/desktop/public" / config["src"].lstrip("/")
    trimmed = output / "logo-sound.wav"
    seconds = math.ceil(trim_logo_sound(sound, trimmed) * 30) / 30
    width = height * 16 // 9
    letters = output / "brand-center.png"
    brand_text(letters, height, center=True)
    graph = (f"[0:v]{vf},colorchannelmixer=rr=0.65:gg=0.65:bb=0.65[bg];"
             f"[1:v]scale={width}:{height},format=rgba,tpad=stop_mode=clone:stop_duration={seconds}[logo];"
             "[3:v]format=rgba,fade=t=in:st=2.4:d=0.5:alpha=1[letters];"
             "[bg][logo]overlay=shortest=1[mark];[mark][letters]overlay=shortest=1[screen]")
    # Force the VP9 decoder that preserves alpha; the default native decoder discards it.
    run("ffmpeg", "-y", "-v", "error", *brand_background(episode, base, width, height),
        "-c:v", "libvpx-vp9", "-i", intro, "-i", trimmed, "-loop", "1", "-i", letters,
        "-t", str(seconds), "-filter_complex", graph, "-map", "[screen]", "-map", "2:a",
        "-af", "apad", *encoding, target)
    return duration(target)


def docking_segment(output, vf, encoding, episode, base, height, start):
    from design import brand_text
    width = height * 16 // 9
    letters = output / "brand-corner.png"
    brand_text(letters, height)
    target = output / "000-docking.mp4"
    graph = (f"[0:v]{vf},colorchannelmixer=rr=0.65:gg=0.65:bb=0.65[bg];"
             f"[1:v]scale={width}:{height},format=rgba[logo];"
             "[2:v]format=rgba,fade=t=in:st=1.9:d=0.7:alpha=1[letters];"
             "[bg][logo]overlay=shortest=1[mark];[mark][letters]overlay=shortest=1[screen]")
    run("ffmpeg", "-y", "-v", "error", *brand_background(episode, base, width, height, start),
        "-c:v", "libvpx-vp9", "-i", ROOT / "apps/desktop/public/brand/logo-to-header.webm",
        "-loop", "1", "-i", letters, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-t", "3", "-filter_complex", graph, "-map", "[screen]", "-map", "3:a", *encoding, target)
    return target


def persistent_brand(source, output, height, start):
    from design import brand_text
    letters = output.parent / "brand-corner.png"
    brand_text(letters, height)
    size = round(60 * height / 1080)
    x, y = 34 * height / 1080, 24 * height / 1080
    graph = (f"[1:v]scale={size}:{size},format=rgba,setpts=PTS-STARTPTS+{start}/TB[logo];"
             f"[0:v][logo]overlay=x={x}:y={y}:enable='gte(t,{start})':eof_action=repeat[mark];"
             f"[mark][2:v]overlay=enable='gte(t,{start})':eof_action=repeat[screen]")
    run("ffmpeg", "-y", "-v", "error", "-i", source, "-stream_loop", "-1", "-c:v", "libvpx-vp9",
        "-i", ROOT / "apps/desktop/public/brand/logo-header-loop.webm", "-loop", "1", "-i", letters,
        "-filter_complex", graph, "-map", "[screen]", "-map", "0:a", "-c:v", "libx264", "-preset", "fast",
        "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", str(duration(source)), output)


def mix_music(source, output, episode, windows, total):
    config = episode.get("music")
    if not config:
        return run("ffmpeg", "-y", "-v", "error", "-i", source, "-c", "copy", "-movflags", "+faststart", output)
    if config.get("path"):
        music = Path(config["path"])
    else:
        from music import compose
        music = compose(output.parent / "original-racing-bed.wav", bpm=float(config.get("bpm", 126)))
    gain = float(config.get("gain_db", -8))
    if not -30 <= gain <= 0:
        raise ValueError("Music gain_db must be between -30 and 0.")
    if any(end <= start for start, end in windows):
        raise ValueError("The music bed requires a positive narration span.")
    envelope = "+".join(f"if(between(t,{start},{end}),min(1,min((t-{start})/0.7,({end}-t)/0.8)),0)"
                        for start, end in windows)
    graph = (f"[0:a]asplit=2[voice][key];[1:a]loudnorm=I=-20:TP=-2:LRA=9,volume={gain}dB,"
             f"atrim=duration={total},volume='{envelope}':eval=frame,apad[bed];"
             "[bed][key]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=250[ducked];"
             "[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.94:level=false[mix]")
    run("ffmpeg", "-y", "-v", "error", "-i", source, "-stream_loop", "-1", "-i", music,
        "-filter_complex", graph, "-map", "0:v", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac",
        "-ar", "48000", "-ac", "2", "-t", str(total), "-movflags", "+faststart", output)


def render(episode_path, output, preview=False, height=1080):
    episode_path = Path(episode_path).resolve()
    episode = read_json(episode_path)
    validate_episode(episode)
    if not preview and not episode.get("editorial_reviewed"):
        raise ValueError("Review sources, narration and media, then set editorial_reviewed=true.")
    all_sections = episode["sections"] + ([episode["closing"]] if episode.get("closing") else [])
    if not preview and any(not s.get("media", {}).get("path") for s in all_sections):
        raise ValueError("Select a local image/clip for every section before production render.")
    key = operator_key()
    if not key:
        raise ValueError("Configure GEMINI_API_KEY in the operator environment.")
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    width = height * 16 // 9
    # Portable Windows FFmpeg builds often ship without Fontconfig configuration.
    font = ":fontfile='C\\:/Windows/Fonts/segoeui.ttf'" if os.name == "nt" else ""
    vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x111416,setsar=1,fps=30"
    encoding = ["-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"]
    segments, timeline, cues = [], [], []
    intro_out = output / "000-intro.mp4"
    brand_segment(output, intro_out, vf, encoding, episode, episode_path.parent, height)
    segments.append(intro_out)
    cursor = duration(intro_out)
    music_start = cursor
    timeline.append({"id": "brand", "title": "GameAccess", "start": 0, "end": cursor})
    dock = docking_segment(output, vf, encoding, episode, episode_path.parent, height, cursor)
    actual = duration(dock)
    timeline.append({"id": "brand-docking", "title": "GameAccess", "start": cursor, "end": cursor + actual})
    segments.append(dock)
    cursor += actual
    corner_start = cursor

    def append_narration(section, index):
        nonlocal cursor
        wav = output / f"{section['id']}.wav"
        synthesize(section, episode, wav, key)
        speech = duration(wav)
        seconds = math.ceil((speech + 0.25) * 30) / 30
        slate = output / f"{section['id']}.txt"
        slate.write_text("\n".join(textwrap.wrap(section.get("title", section["id"]), 38)),
                         encoding="utf-8", newline="\n")
        if preview:
            overlay = vf + f",drawbox=x=iw/12:y=ih/3:w=8:h=ih/3:color=0xff6a00:t=fill,drawtext=textfile='{slate.name}'{font}:fontcolor=white:fontsize={height//14}:x=w/8:y=(h-text_h)/2,drawtext=text='GAMEACCESS - MUESTRA DE FORMATO'{font}:fontcolor=0xff8c3a:fontsize={height//32}:x=w/8:y=h-h/8"
        inputs = (["-f", "lavfi", "-i", f"color=c=0x111416:s={width}x{height}:r=30"]
                  if preview and not section.get("media") else media_input(section["media"], episode_path.parent, seconds))
        target = output / f"{index:03}-{section['id']}.mp4"
        if preview:
            art_input, visual = [], ["-map", "0:v", "-vf", overlay]
        else:
            from design import card
            artwork = output / f"{section['id']}-card.png"
            card(episode, section, index, artwork, height)
            art_input = ["-loop", "1", "-framerate", "30", "-i", artwork]
            graph = f"[0:v]{vf}[base];[2:v]format=rgba,fade=t=in:d=0.35:alpha=1[card];[base][card]overlay=x='48*(1-min(t/0.35,1))':y=0:shortest=1[screen]"
            visual = ["-filter_complex", graph, "-map", "[screen]"]
        run("ffmpeg", "-y", "-v", "error", *inputs, "-i", wav, *art_input, "-t", str(seconds),
            *visual, "-map", "1:a", "-af", "apad,loudnorm=I=-16:TP=-1.5:LRA=11",
            *encoding, target.name, cwd=output)
        actual = duration(target)
        timeline.append({"id": section["id"], "title": section.get("title", section["id"]),
                         "start": cursor, "end": cursor + actual, "speech_duration": speech})
        cues.extend(captions(section["text"], cursor, speech))
        cursor += actual
        segments.append(target)
    for index, section in enumerate(episode["sections"], 1):
        append_narration(section, index)
    music_end = cursor
    music_windows = [(music_start, music_end)]
    if episode.get("gameplay"):
        gameplay = episode["gameplay"]
        seconds = float(gameplay["duration"])
        inputs = media_input(gameplay, episode_path.parent, seconds)
        target = output / "999-gameplay.mp4"
        audio = json.loads(run("ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                              "stream=index", "-of", "json", (episode_path.parent / gameplay["path"]).resolve()).stdout)["streams"]
        extra = [] if audio else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        from design import card
        artwork = output / "extended-card.png"
        card(episode, {"title": gameplay.get("title", "Gameplay"),
                       "eyebrow": gameplay.get("credit", "")}, 0, artwork, height, extended=True)
        art_index = 1 if audio else 2
        graph = f"[0:v]{vf}[base];[{art_index}:v]format=rgba[card];[base][card]overlay=shortest=1[screen]"
        run("ffmpeg", "-y", "-v", "error", *inputs, *extra, "-loop", "1", "-framerate", "30", "-i", artwork,
            "-t", str(seconds), "-filter_complex", graph, "-map", "[screen]", "-map", "0:a" if audio else "1:a",
            "-af", "loudnorm=I=-18:TP=-2:LRA=11", *encoding, target)
        actual = duration(target)
        timeline.append({"id": "extended-gameplay", "title": "Gameplay extendido", "start": cursor, "end": cursor + actual})
        cursor += actual
        segments.append(target)
    if episode.get("closing"):
        closing_start = cursor
        append_narration(episode["closing"], len(episode["sections"]) + 1)
        music_windows.append((closing_start, cursor))
    if episode.get("outro"):
        target = output / "1000-outro.mp4"
        brand_segment(output, target, vf, encoding, episode, episode_path.parent, height)
        actual = duration(target)
        timeline.append({"id": "brand-outro", "title": "GameAccess", "start": cursor, "end": cursor + actual})
        cursor += actual
        segments.append(target)
    playlist = output / "concat.txt"
    playlist.write_text("\n".join(f"file '{p.name}'" for p in segments), encoding="utf-8")
    final = output / f"{episode['app_id']}-{episode['locale']}{'-preview' if preview else ''}.mp4"
    assembled = output / "assembled.mp4"
    run("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "1", "-i", playlist, "-c", "copy", assembled)
    if episode.get("music", {}).get("path"):
        episode["music"]["path"] = str((episode_path.parent / episode["music"]["path"]).resolve())
    branded = output / "branded.mp4"
    persistent_brand(assembled, branded, height, corner_start)
    mix_music(branded, final, episode, music_windows, duration(branded))
    write_json(output / "timeline.json", {"format_version": 1, "app_id": episode["app_id"], "locale": episode["locale"],
                                       "preview": preview, "demo": bool(episode.get("demo")),
                                       "music_window": [music_start, music_end] if episode.get("music") else None,
                                       "music_windows": music_windows if episode.get("music") else [],
                                       "duration": duration(final), "sections": timeline})
    (output / "captions.vtt").write_text("WEBVTT\n\n" + "\n\n".join(
        f"{timestamp(a)} --> {timestamp(b)}\n{text}" for a, b, text in cues) + "\n", encoding="utf-8")
    chapters = "\n".join(f"{int(s['start'])//60:02}:{int(s['start'])%60:02} {clean_text(s['title'])}" for s in timeline)
    sources = "\n".join(f"{s['label']}: {s['url']}" for s in episode.get("sources", []))
    (output / "youtube-description.txt").write_text(
        f"{episode['name']} | Qué ofrece y cómo se juega | GameAccess\n\n{chapters}\n\n"
        f"Datos consultados: {episode.get('facts_checked_at', 'Muestra de formato')}\n{sources}\n"
        f"\n{episode.get('production_note', '')}\n"
        "\nSubtítulos: revisar tiempos aproximados de cada oración antes de publicar.\n", encoding="utf-8")
    print(json.dumps({"video": str(final), "duration": duration(final), "preview": preview}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    collect_cmd = sub.add_parser("collect")
    collect_cmd.add_argument("app_id", type=int)
    collect_cmd.add_argument("--output", required=True)
    draft_cmd = sub.add_parser("draft")
    draft_cmd.add_argument("facts")
    draft_cmd.add_argument("--output", required=True)
    render_cmd = sub.add_parser("render")
    render_cmd.add_argument("episode")
    render_cmd.add_argument("--output", required=True)
    render_cmd.add_argument("--preview", action="store_true")
    render_cmd.add_argument("--height", type=int, choices=[720, 1080], default=1080)
    args = parser.parse_args()
    try:
        if args.command == "collect":
            collect(args.app_id, args.output)
        elif args.command == "draft":
            draft(read_json(args.facts), args.output)
        else:
            render(args.episode, args.output, args.preview, args.height)
    except subprocess.CalledProcessError as error:
        print(f"Media tool failed: {error.stderr[-2000:]}", file=sys.stderr)
        return 1
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
