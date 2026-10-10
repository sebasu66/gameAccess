import base64
import io
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import pipeline


def wav_bytes():
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b"\x00\x00" * 24000)
    return out.getvalue()


class PipelineTests(unittest.TestCase):
    def test_unary_wav_is_preserved_and_pcm_gets_a_real_container(self):
        raw = wav_bytes()
        result = {"steps": [{"type": "model_output", "content": [
            {"type": "audio", "mime_type": "audio/wav", "data": base64.b64encode(raw).decode()}]}]}
        self.assertEqual(pipeline.decode_audio(result), raw)
        result["steps"][0]["content"][0].update(mime_type="audio/l16; rate=24000", data=base64.b64encode(b"\x00\x00" * 24000).decode())
        with wave.open(io.BytesIO(pipeline.decode_audio(result)), "rb") as wav:
            self.assertEqual(wav.getframerate(), 24000)
            self.assertEqual(wav.getnframes(), 24000)

    def test_missing_audio_or_fake_wav_fails(self):
        with self.assertRaises(ValueError):
            pipeline.decode_audio({"steps": []})
        with self.assertRaises(ValueError):
            pipeline.decode_audio({"steps": [{"type": "model_output", "content": [
                {"type": "audio", "data": base64.b64encode(b"not wav").decode()}]}]})

    def test_voice_cache_invalidates_when_narration_changes(self):
        response = {"steps": [{"type": "model_output", "content": [
            {"type": "audio", "data": base64.b64encode(wav_bytes()).decode()}]}]}
        episode = {"locale": "es"}
        section = {"id": "hook", "text": "Texto literal."}
        with tempfile.TemporaryDirectory() as temp, patch.object(pipeline, "request_json", return_value=response) as api:
            path = Path(temp) / "hook.wav"
            pipeline.synthesize(section, episode, path, "never_logged")
            pipeline.synthesize(section, episode, path, "never_logged")
            self.assertEqual(api.call_count, 1)
            body = api.call_args.args[1]
            self.assertEqual(body["input"][0]["content"][0]["text"], section["text"])
            self.assertIn("annotations", body["input"][0]["content"][0])
            pipeline.synthesize({**section, "text": "Texto diferente."}, episode, path, "never_logged")
            self.assertEqual(api.call_count, 2)

    def test_caption_estimates_stay_inside_actual_audio(self):
        cues = pipeline.captions("Primera oración. Segunda oración más larga.", 2.0, 8.5)
        self.assertEqual(cues[0][0], 2)
        self.assertAlmostEqual(cues[-1][1], 10.5)
        self.assertEqual(cues[0][1], cues[1][0])
        self.assertEqual(pipeline.timestamp(3661.234), "01:01:01.234")

    def test_short_footage_is_rejected_instead_of_looped(self):
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, "clip.mp4").touch()
            with patch.object(pipeline, "duration", return_value=5):
                with self.assertRaises(ValueError):
                    pipeline.media_input({"path": "clip.mp4", "start": 2}, Path(temp), 4)

    def test_unsafe_duplicate_sections_are_rejected(self):
        episode = {"format_version": 1, "locale": "es", "app_id": 4078430,
                   "sections": [{"id": "../escape", "text": "Texto"}]}
        with self.assertRaises(ValueError):
            pipeline.validate_episode(episode)
        episode["sections"] = [{"id": "hook", "text": "Texto"}] * 2
        with self.assertRaises(ValueError):
            pipeline.validate_episode(episode)


if __name__ == "__main__":
    unittest.main()
