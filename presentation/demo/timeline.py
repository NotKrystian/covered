#!/usr/bin/env python3
"""Speech marks -> demo/timeline.js: VO start per scene (bar downbeats), word times, subtitle lines.

Subtitles: one line at a time, <= 42 characters, spoken numbers shown the way the screen shows them.
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
VO = HERE.parent / "out" / "demo" / "vo"
BAR = 2.0
# VO bar per scene: the scene's first bar, except the end line which lands with the mark (bar 54)
VO_BAR = {"s1": 1, "s2": 4, "s3": 10, "s4": 14, "s5": 24, "s6": 32, "s7": 37, "s8": 44, "s9": 48, "s10": 50, "s11": 54}
SHOW = [  # spoken -> on screen; the spoken phrase is never split across two subtitle lines
    ("one thousand, two hundred and eighty-four pounds", "£1,284"),
    ("forty-two a month", "£42 a month"),
    ("twenty-two percent", "22%"),
    ("Twelve pounds sixty", "£12.60"),
    ("twenty-eight", "£28"), ("thirty-six", "£36"), ("your twenty-five", "your 25%"),
    ("Set fifteen", "Set 15%"), ("fourteen days", "14 days"), ("your eight", "your £8"),
    ("thirty-day", "30-day"),
]
MAX = 42


def show(s):
    for a, b in SHOW:
        s = s.replace(a, b)
    return s


def main():
    script = {s["id"]: s for s in json.loads((HERE / "script.json").read_text())}
    out = {"scenes": {}, "subs": []}
    for sid, bar in VO_BAR.items():
        t0 = (bar - 1) * BAR
        ssml = f"<speak>{script[sid]['ssml']}</speak>"
        marks = [json.loads(l) for l in (VO / f"{sid}.marks.json").read_text().splitlines() if l.strip()]
        words = [m for m in marks if m["type"] == "word"]
        ends = {m["end"] for m in marks if m["type"] == "sentence"}
        glue = []
        for a, _ in SHOW:
            for mm in re.finditer(re.escape(a), ssml):
                glue.append((mm.start(), mm.end()))
        glued = lambda i: any(g0 <= words[i]["start"] and words[i + 1]["end"] <= g1 for g0, g1 in glue)
        dur = json.loads((VO / "durations.json").read_text())[sid]["dur"]
        out["scenes"][sid] = {"t0": t0, "dur": dur, "words": [[round(t0 + w["time"] / 1000, 3), w["value"]] for w in words]}
        lines, cur = [], [0]
        for i in range(1, len(words)):
            a = words[cur[0]]["start"]
            prev_end = words[i - 1]["end"]
            sentence_end = any(prev_end <= e <= prev_end + 1 for e in ends)
            cand = show(ssml[a:words[i]["end"]])
            if glued(i - 1) or (len(cand) <= MAX - 1 and not (sentence_end and len(show(ssml[a:prev_end])) >= 14)):
                cur.append(i)
            else:
                lines.append(cur); cur = [i]
        lines.append(cur)
        span = lambda ln: show(ssml[words[ln[0]]["start"]:words[ln[-1]]["end"] + 1])
        for k in range(1, len(lines)):  # no orphan words: pull words down while the short line still fits
            while len(span(lines[k])) < 14 and len(lines[k - 1]) > 2 and len(span([lines[k - 1][-1]] + lines[k])) <= MAX \
                    and len(span(lines[k - 1][:-1])) >= len(span([lines[k - 1][-1]] + lines[k])) - 6 and not glued(lines[k - 1][-2]) \
                    and ssml[words[lines[k - 1][-1]]["end"]:words[lines[k - 1][-1]]["end"] + 1] not in ".?!":
                lines[k].insert(0, lines[k - 1].pop())
        for k, ln in enumerate(lines):
            a, b = words[ln[0]], words[ln[-1]]
            end_c = b["end"]
            while end_c < len(ssml) and ssml[end_c] in ".,:?!'":
                end_c += 1
            text = show(ssml[a["start"]:end_c]).strip()
            ts = t0 + a["time"] / 1000
            te = t0 + (words[lines[k + 1][0]]["time"] / 1000 if k + 1 < len(lines) else dur - 0.05)
            out["subs"].append([round(ts, 3), round(te, 3), text])
            assert len(text) <= MAX, (text, len(text), ln)
    (HERE / "timeline.js").write_text("window.TL = " + json.dumps(out, ensure_ascii=False) + ";\n")
    for s in out["subs"]:
        print(f"{s[0]:7.2f} {s[1]:7.2f} {s[2]}")


if __name__ == "__main__":
    main()
