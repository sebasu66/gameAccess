"""Generate an original instrumental bed, with no external music samples."""
import wave
from pathlib import Path

import numpy as np


def compose(output, bpm=126, bars=16):
    rate = 48000
    beat = 60 / bpm
    length = bars * 4 * beat
    result = np.zeros((round(length * rate), 2), dtype=np.float64)
    rng = np.random.default_rng(4078430)

    def add(sound, time, gain=1, pan=0):
        offset = round(time * rate)
        count = min(len(sound), len(result) - offset)
        if count > 0:
            result[offset:offset + count, 0] += sound[:count] * gain * (1 - pan) ** .5
            result[offset:offset + count, 1] += sound[:count] * gain * (1 + pan) ** .5

    def tone(midi, seconds, pluck=True):
        t = np.arange(round(seconds * rate)) / rate
        hz = 440 * 2 ** ((midi - 69) / 12)
        oscillator = np.sin(2 * np.pi * hz * t) + .24 * np.sin(4 * np.pi * hz * t)
        envelope = (1 - np.exp(-t * 95)) * (np.exp(-t * 7) if pluck else np.minimum(1, (seconds - t) * 8))
        return oscillator * envelope

    progression = [(38, (62, 65, 69)), (34, (58, 62, 65)), (41, (65, 69, 72)), (36, (60, 64, 67))]
    for bar in range(bars):
        root, chord = progression[(bar // 2) % len(progression)]
        for step in range(8):
            when = (bar * 4 + step / 2) * beat
            t = np.arange(round(.22 * rate)) / rate
            hat = rng.normal(size=len(t))
            hat = np.concatenate(([0], np.diff(hat))) * np.exp(-t * 70)
            add(hat, when, .018 if step % 2 == 0 else .025, .35)
            add(tone(chord[(step + bar) % 3] + 12, beat * .8), when, .047, (-.4 if step % 2 else .4))
            if step % 2 == 0:
                phase = 2 * np.pi * (45 * t + 95 / 32 * (1 - np.exp(-32 * t)))
                add(np.sin(phase) * np.exp(-t * 19), when, .25)
                add(tone(root, beat * .65), when + beat * .12, .13)
            if step in (2, 6):
                noise = rng.normal(size=len(t))
                clap = (noise - np.convolve(noise, np.ones(15) / 15, mode="same")) * np.exp(-t * 28)
                add(clap, when, .065, -.15)
        for note in chord:
            add(tone(note, 4 * beat, False), bar * 4 * beat, .019, -.2)
    result = np.tanh(result * 1.4)
    result *= .78 / max(np.max(np.abs(result)), .01)
    fade = min(round(.025 * rate), len(result))
    result[:fade] *= np.linspace(0, 1, fade)[:, None]
    result[-fade:] *= np.linspace(1, 0, fade)[:, None]
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes((result * 32767).astype("<i2").tobytes())
    return output
