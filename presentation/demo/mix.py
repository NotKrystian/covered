#!/usr/bin/env python3
"""Mix the demo soundtrack and mux it onto the rendered picture.

House Vibes from its 16.08 s downbeat, ducked ~12 dB under Arthur (sidechaincompress, 150 ms attack /
400 ms release), UI ticks on the taps, 1.5 s fade on the phrase end, two-pass loudnorm to -16 LUFS / -1.5 dBTP.

    python3 demo/mix.py            -> out/demo/mix.wav and out/covered-demo.mp4 (needs out/demo/video.mp4)
"""
import json
import pathlib
import re
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "out" / "demo"
SONG = ROOT / "assets" / "source" / "mixkit-house-vibes-129.mp3"
DOWNBEAT = 16.08
DUR = 120.0


def main():
    tl = json.loads((HERE / "timeline.js").read_text().split("=", 1)[1].rstrip().rstrip(";"))
    html = (HERE / "demo.html").read_text()
    taps = [float(m) for m in re.findall(r"\[(\d+\.\d+), \d+, \d+\]", html.split("const TAPS = ")[1].split(";")[0])]
    taps.append(float(re.search(r"land: ([\d.]+)", html).group(1)))
    cues = [("check.wav", 65.4), ("ping.wav", tl["scenes"]["s7"]["words"][4][0])]

    inputs = ["-i", str(SONG)]
    scenes = list(tl["scenes"].items())
    for sid, _ in scenes:
        inputs += ["-i", str(OUT / "vo" / f"{sid}.mp3")]
    inputs += ["-i", str(ROOT / "assets" / "ui" / "tap.wav")]
    for f, _ in cues:
        inputs += ["-i", str(ROOT / "assets" / "ui" / f)]
    fmt = "aformat=sample_rates=48000:channel_layouts=stereo"
    # the song is 114 s: from the 16.08 s downbeat, play 24 bars, then repeat from bar 13 (phrase-aligned)
    # to song 112.08 s, which lands the film's last bar on a phrase end
    a0, a1, b0 = DOWNBEAT, DOWNBEAT + 48, DOWNBEAT + 24
    xf = 0.02
    fc = [f"[0:a]{fmt},asplit=2[s1][s2]",
          f"[s1]atrim=start={a0}:end={a1 + xf},asetpts=PTS-STARTPTS[m1]",
          f"[s2]atrim=start={b0}:end={b0 + DUR - 48 + 1},asetpts=PTS-STARTPTS[m2]",
          f"[m1][m2]acrossfade=d={xf}:c1=tri:c2=tri,atrim=duration={DUR},asetpts=N/SR/TB,volume=-5dB[mus]"]
    for i, (sid, sc) in enumerate(scenes, start=1):
        ms = int(round(sc["t0"] * 1000))
        fc.append(f"[{i}:a]{fmt},adelay={ms}:all=1,volume=2dB[v{i}]")
    fc.append("".join(f"[v{i}]" for i in range(1, len(scenes) + 1)) + f"amix=inputs={len(scenes)}:normalize=0,asplit=2[vo][sc]")
    ti = len(scenes) + 1
    fc.append(f"[{ti}:a]{fmt},asplit={len(taps)}" + "".join(f"[tp{k}]" for k in range(len(taps))))
    for k, t in enumerate(taps):
        fc.append(f"[tp{k}]adelay={int(t * 1000)}:all=1[td{k}]")
    for j, (_, t) in enumerate(cues):
        fc.append(f"[{ti + 1 + j}:a]{fmt},adelay={int(t * 1000)}:all=1[cu{j}]")
    fc.append("".join(f"[td{k}]" for k in range(len(taps))) + "".join(f"[cu{j}]" for j in range(len(cues)))
              + f"amix=inputs={len(taps) + len(cues)}:normalize=0,volume=-17dB[tk]")
    fc.append(f"[sc]apad=whole_dur={DUR}[scp]")
    fc.append("[mus][scp]sidechaincompress=threshold=0.02:ratio=8:attack=150:release=400:makeup=1[duck]")
    fc.append(f"[duck]afade=t=out:st={DUR - 1.5}:d=1.5[musf]")
    fc.append(f"[musf][vo][tk]amix=inputs=3:normalize=0,atrim=duration={DUR}[mix]")
    pre = OUT / "premix.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[mix]", "-c:a", "pcm_s24le", str(pre)], check=True)

    ln = "loudnorm=I=-16:TP=-2:LRA=11"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(pre), "-af", ln + ":print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
    two = (f"{ln}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
           f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    mix = OUT / "mix.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(pre), "-af", two + ",aresample=192000,alimiter=limit=0.708:attack=1:release=50:level=false,aresample=48000", "-c:a", "pcm_s24le", str(mix)], check=True)

    video = OUT / "video.mp4"
    final = ROOT / "out" / "covered-demo.mp4"
    if video.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(mix), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "256k", "-t", str(DUR), "-movflags", "+faststart", str(final)], check=True)
        print("wrote", final)
    print("taps", taps)


if __name__ == "__main__":
    main()
