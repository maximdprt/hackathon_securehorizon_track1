"""The voice over of a film: each line spoken by ElevenLabs (text to speech), placed at its time, over a quiet bed of
music (video/audio.py's pad and effects, lowered under the voice). No word goes on screen.

    ELEVENLABS_API_KEY=... .venv/bin/python video/voice.py video/poc_voice.json <music.wav> <out.wav> [cacheDir]

The spec: {"voice": id, "model": id, "end": seconds, "lines": [[start, text], ...]}. Each line is fetched once and kept
in cacheDir (by its text), so a timing change costs no new characters. A line that would run into the next one is
reported, never cut.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

spec_path, music, out = sys.argv[1], sys.argv[2], sys.argv[3]
cache = Path(sys.argv[4] if len(sys.argv) > 4 else Path(out).parent / "voice_cache")
cache.mkdir(parents=True, exist_ok=True)
spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
key = os.environ["ELEVENLABS_API_KEY"]


def speak(text: str) -> Path:
    f = cache / (hashlib.sha1(f"{spec['voice']}|{spec['model']}|{text}".encode()).hexdigest()[:16] + ".mp3")
    if not f.exists():
        body = json.dumps({"text": text, "model_id": spec["model"],
                           "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}}).encode()
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{spec['voice']}?output_format=mp3_44100_128",
                                     data=body, headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
        with urllib.request.urlopen(req, timeout=120) as r:
            f.write_bytes(r.read())
    return f


def duration(f: Path) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                                capture_output=True, text=True, check=True).stdout)


lines = [(float(t), text, speak(text)) for t, text in spec["lines"]]
for i, (t, text, f) in enumerate(lines):
    d = duration(f)
    nxt = lines[i + 1][0] if i + 1 < len(lines) else spec["end"]
    flag = "  << runs into the next line" if t + d > nxt - 0.15 else ""
    print(f"{t:6.1f} -> {t + d:6.1f}  ({d:4.1f} s)  {text[:60]}{flag}")

inputs = ["-i", music]
chains, labels = [], []
for i, (t, _, f) in enumerate(lines, start=1):
    inputs += ["-i", str(f)]
    ms = int(t * 1000)
    chains.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
    labels.append(f"[v{i}]")
graph = ";".join(chains) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:normalize=0,volume=1.0[voice];"
# the music ducks under the voice
graph += f"[voice]apad=whole_dur={spec['end']},asplit=2[vo][sc];[0:a]aresample=48000,volume=0.55[bed];[bed][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];"
graph += "[duck][vo]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.9,loudnorm=I=-16:TP=-1.5:LRA=11[out]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-ar", "48000", "-t", str(spec["end"]), out], check=True)
print("wrote", out)
