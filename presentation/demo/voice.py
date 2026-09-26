#!/usr/bin/env python3
"""Polly Arthur (neural, en-GB): one mp3 + one speech-mark file per scene.

    python3 voice.py            synthesize every scene into out/demo/vo/
Writes vo/<scene>.mp3, vo/<scene>.marks.json and vo/durations.json.
"""
import json
import pathlib
import subprocess
from concurrent.futures import ThreadPoolExecutor

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "out" / "demo" / "vo"
REGION = "eu-west-2"

# scene id, first bar (1-based), last bar, spoken text (numbers spelled as said)
SCENES = json.loads((HERE / "script.json").read_text())


def polly(sid, text):
    ssml = f"<speak>{text}</speak>"
    base = ["aws", "polly", "synthesize-speech", "--region", REGION, "--engine", "neural",
            "--voice-id", "Arthur", "--language-code", "en-GB", "--text-type", "ssml", "--text", ssml]
    subprocess.run(base + ["--output-format", "mp3", str(OUT / f"{sid}.mp3")], check=True, capture_output=True)
    subprocess.run(base[:3] + ["--speech-mark-types", "sentence", "word"] + base[3:] +
                   ["--output-format", "json", str(OUT / f"{sid}.marks.json")], check=True, capture_output=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                str(OUT / f"{sid}.mp3")], check=True, capture_output=True, text=True).stdout)
    return sid, dur


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(6) as ex:
        res = dict(ex.map(lambda s: polly(s["id"], s["ssml"]), SCENES))
    report = {}
    for s in SCENES:
        slot = (s["bars"][1] - s["bars"][0] + 1) * 2.0
        report[s["id"]] = {"dur": round(res[s["id"]], 3), "slot": slot, "fits": res[s["id"]] <= slot - 0.3}
        print(f'{s["id"]:4} {res[s["id"]]:6.2f}s / {slot:5.1f}s  {"ok" if report[s["id"]]["fits"] else "OVERRUN"}')
    (OUT / "durations.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
