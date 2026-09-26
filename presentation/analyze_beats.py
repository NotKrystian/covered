#!/usr/bin/env python3
"""Beat grid + UI sound placement for the Covered product film (numpy only).

  python3 analyze_beats.py scan FILE...           tempo of each candidate track
  python3 analyze_beats.py build SONG.mp3         trim a 12-bar loop starting on a
                                                  downbeat, synthesize UI sounds,
                                                  mix them onto measured beat peaks
  python3 analyze_beats.py cut power|flames [F]   measure tempo + downbeats + energy,
                                                  suggest a 20-32 s section, write
                                                  cuts/<cut>.json and the mixed audio
  python3 analyze_beats.py click power|flames     same, on a placeholder click track
  python3 analyze_beats.py bundle                 rebuild cuts/cuts.js from cuts/*.json

Song: "House Vibes" by Alejandro Magaña (A. M.), Mixkit #129,
https://assets.mixkit.co/music/129/129.mp3 (listed at mixkit.co/free-stock-music/tag/house/),
Mixkit Stock Music Free License (https://mixkit.co/license/#musicFree). Save it as
assets/source/mixkit-house-vibes-129.mp3 and run `build` to regenerate the WAVs.

Tempo: log-magnitude STFT -> half-wave-rectified spectral flux (onset strength)
-> autocorrelation with a weak log-normal prior around 120 BPM -> fine comb
search over period and phase. Downbeat: the beat phase (mod 4) where the
beat-synchronous spectrum changes most (sections turn over on bar lines).
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

SR_AN = 22050          # analysis rate
SR_OUT = 48000         # output rate
N_FFT = 2048
HOP = 128              # 5.8 ms onset resolution
BARS = 12
BEATS = BARS * 4
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")


def decode(path, sr, channels=1):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", str(channels), "-ar", str(sr),
         "-f", "f32le", "-"],
        check=True, capture_output=True).stdout
    y = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return y.reshape(-1, channels) if channels > 1 else y


def stft_mag(y, n_fft=N_FFT, hop=HOP):
    pad = n_fft // 2
    y = np.pad(y, (pad, pad))
    n = 1 + (len(y) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    win = np.hanning(n_fft)
    return np.abs(np.fft.rfft(y[idx] * win, axis=1))  # frame k centred at k*hop/sr


def onset_envelope(y, sr, fmax=None):
    mag = stft_mag(y)
    if fmax:
        mag = mag[:, : int(fmax / (sr / N_FFT))]
    logm = np.log1p(100.0 * mag)
    flux = np.zeros(len(logm))
    flux[1:] = np.maximum(0.0, np.diff(logm, axis=0)).sum(axis=1)
    fps = sr / HOP
    w = int(fps * 0.4)
    local = np.convolve(flux, np.ones(w) / w, mode="same")
    env = np.maximum(0.0, flux - local)
    return env / (env.max() + 1e-9), fps, logm


def coarse_bpm(env, fps):
    x = env - env.mean()
    n = 1 << int(np.ceil(np.log2(2 * len(x))))
    f = np.fft.rfft(x, n)
    ac = np.fft.irfft(f * np.conj(f))[: len(x)]
    lags = np.arange(1, len(ac))
    bpm = 60.0 * fps / lags
    ok = (bpm > 60) & (bpm < 200)
    prior = np.exp(-0.5 * (np.log2(bpm / 120.0) / 0.9) ** 2)
    score = np.where(ok, ac[1:] * prior, -np.inf)
    i = int(np.argmax(score))
    if 0 < i < len(score) - 1 and np.isfinite(score[i - 1]) and np.isfinite(score[i + 1]):
        a, b, c = score[i - 1], score[i], score[i + 1]
        i = i + 0.5 * (a - c) / (a - 2 * b + c)
    return 60.0 * fps / (i + 1)


def comb(env, fps, period, t0, t1):
    """Best phase + mean onset strength of a click train with this period over [t0, t1)."""
    phases = np.arange(0.0, period, 0.002)
    k = np.arange(int((t1 - t0) / period))
    times = t0 + phases[:, None] + k[None, :] * period
    vals = np.interp(times * fps, np.arange(len(env)), env)
    s = vals.mean(axis=1)
    j = int(np.argmax(s))
    return phases[j] + t0, s[j]


def fine_tempo(env, fps, bpm0):
    dur = len(env) / fps
    t0, t1 = min(4.0, dur * 0.1), dur - 2.0
    best = None
    for span, step in ((3.0, 0.02), (0.06, 0.001)):
        centre = bpm0 if best is None else best[0]
        for bpm in np.arange(centre - span, centre + span + step / 2, step):
            ph, s = comb(env, fps, 60.0 / bpm, t0, t1)
            if best is None or s > best[2]:
                best = (bpm, ph, s)
    bpm, phase, _ = best
    period = 60.0 / bpm
    phase = phase % period
    return bpm, phase


def beat_features(logm, fps, beats):
    """Mean log-spectrum per beat in 24 coarse bands."""
    edges = np.unique(np.geomspace(2, logm.shape[1] - 1, 25).astype(int))
    bands = np.stack([logm[:, a:b].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])], 1)
    fr = (beats * fps).astype(int)
    fr = np.clip(fr, 0, len(bands) - 1)
    feats = np.stack([bands[a:b].mean(axis=0) if b > a else bands[a]
                      for a, b in zip(fr[:-1], fr[1:])])
    return feats


def analyse(path):
    y = decode(path, SR_AN)
    env, fps, logm = onset_envelope(y, SR_AN)
    bpm0 = coarse_bpm(env, fps)
    bpm, phase = fine_tempo(env, fps, bpm0)
    return dict(y=y, env=env, fps=fps, logm=logm, bpm0=bpm0, bpm=bpm, phase=phase,
                dur=len(y) / SR_AN)


def scan(paths):
    for p in paths:
        a = analyse(p)
        tag = "  <-- in range" if 118 <= a["bpm"] <= 122 else ""
        print(f"{os.path.basename(p):>12}  coarse {a['bpm0']:7.2f}  fine {a['bpm']:8.3f}"
              f"  dur {a['dur']:6.1f}s{tag}")


# ---------------------------------------------------------------- UI sounds

def env_exp(n, tau, sr=SR_OUT):
    return np.exp(-np.arange(n) / (tau * sr))


def attack(n, a=0.0015, sr=SR_OUT):
    k = np.minimum(1.0, np.arange(n) / max(1, a * sr))
    return k


def onepole_hp(x, fc, sr=SR_OUT):
    a = np.exp(-2 * np.pi * fc / sr)
    out = np.zeros_like(x)
    prev_x = prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = a * (prev_y + v - prev_x)
        prev_x = v
        out[i] = prev_y
    return out


def bandnoise(n, lo, hi, rng, sr=SR_OUT):
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / sr)
    spec[(f < lo) | (f > hi)] = 0
    x = np.fft.irfft(spec, n)
    return x / (np.abs(x).max() + 1e-9)


def snd_tap(rng):
    n = int(0.05 * SR_OUT)
    t = np.arange(n) / SR_OUT
    body = np.sin(2 * np.pi * 1900 * t) * env_exp(n, 0.006)
    thud = np.sin(2 * np.pi * 420 * t) * env_exp(n, 0.012) * 0.6
    noise = bandnoise(n, 2500, 9000, rng) * env_exp(n, 0.002) * 0.5
    return (body + thud + noise) * attack(n)


def snd_side_click(rng):
    n = int(0.07 * SR_OUT)
    t = np.arange(n) / SR_OUT
    low = np.sin(2 * np.pi * 150 * t) * env_exp(n, 0.018)
    mid = np.sin(2 * np.pi * 900 * t) * env_exp(n, 0.005) * 0.5
    snap = bandnoise(n, 3000, 12000, rng) * env_exp(n, 0.0015) * 0.8
    return (low + mid + snap) * attack(n, 0.0008)


def snd_check(rng):
    n = int(0.6 * SR_OUT)
    t = np.arange(n) / SR_OUT
    out = np.zeros(n)
    for f0, delay, amp in ((1318.5, 0.0, 1.0), (1975.5, 0.075, 0.8)):
        d = int(delay * SR_OUT)
        m = n - d
        tt = t[:m]
        tone = (np.sin(2 * np.pi * f0 * tt) + 0.18 * np.sin(2 * np.pi * 2 * f0 * tt))
        out[d:] += amp * tone * env_exp(m, 0.14) * attack(m, 0.002)
    return out


def snd_ping(rng):
    n = int(0.5 * SR_OUT)
    t = np.arange(n) / SR_OUT
    f = 1760.0 * np.exp(-t * 1.2)  # slight downward glide: a price drop
    ph = 2 * np.pi * np.cumsum(f) / SR_OUT
    tone = np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    return tone * env_exp(n, 0.12) * attack(n, 0.002)


def snd_tick(rng):
    n = int(0.02 * SR_OUT)
    t = np.arange(n) / SR_OUT
    return (np.sin(2 * np.pi * 3200 * t) * env_exp(n, 0.0025)
            + bandnoise(n, 4000, 10000, rng) * env_exp(n, 0.001) * 0.3) * attack(n, 0.0005)


SOUNDS = {"tap": snd_tap, "side": snd_side_click, "check": snd_check,
          "ping": snd_ping, "tick": snd_tick}
LEVEL_DB = {"tap": -17, "side": -13, "check": -15, "ping": -16, "tick": -24}

# (film beat index from 0, sub-beat offset in beats, sound, gain dB)
# beat index i <-> grid label bar.beat with i = (bar-1)*4 + (beat-1)
EVENTS = [
    (1, 0.0, "tap", 0),        # 1.2 finger taps send
    (16, 0.0, "tap", 0),       # 5.1 finger presses "pay up to"
    (21, 0.0, "tap", 0),       # 6.2 finger taps Approve
    (24, 0.0, "side", 0),      # 7.1 side button, first press
    (25, 0.0, "side", -1),     # 7.2 second press
    (27, 0.0, "check", 0),     # 7.4 check
    (29, 0.0, "tick", 0),      # 8.2 wallet counts down
    (29, 0.25, "tick", -4),
    (29, 0.5, "tick", -8),
    (30, 0.0, "tap", -2),      # 8.3 tap Orders tab
    (37, 0.0, "ping", 0),      # 10.2 clear-out alert
    (38, 0.0, "tick", 0),      # 10.3 four match chips tick
    (38, 0.25, "tick", -1),
    (38, 0.5, "tick", -2),
    (38, 0.75, "tick", -3),
    (41, 0.0, "tick", 0),      # 11.2 = £195.00
    (43, 0.0, "tick", 0),      # 11.4 wallet counts to £2.00
    (43, 0.25, "tick", -4),
    (45, 0.0, "tick", 0),      # 12.2 money kept counts up
    (45, 0.25, "tick", -4),
    (45, 0.5, "tick", -8),
]


def write_wav(path, x, sr=SR_OUT):
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[1] if x.ndim > 1 else 1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def pick_start(a, n_beats_needed):
    """Downbeat phase + a start downbeat whose 12 bars are full and loop back well."""
    period = 60.0 / a["bpm"]
    beats = a["phase"] + period * np.arange(int((a["dur"] - a["phase"]) / period))
    feats = beat_features(a["logm"], a["fps"], beats)
    nov = np.r_[0.0, np.linalg.norm(np.diff(feats, axis=0), axis=1)]
    onset_at = np.interp(beats * a["fps"], np.arange(len(a["env"])), a["env"])
    phase_score = [nov[r::4].mean() + 0.5 * onset_at[r::4].mean() for r in range(4)]
    r = int(np.argmax(phase_score))
    loud = feats.mean(axis=1)
    best = None
    for s in range(r, len(feats) - n_beats_needed - 4, 4):
        seg = loud[s:s + n_beats_needed]
        loop = np.linalg.norm(feats[s:s + 4] - feats[s + n_beats_needed:s + n_beats_needed + 4])
        score = seg.mean() - 0.6 * seg.std() - 0.15 * loop + 0.05 * nov[s]
        if best is None or score > best[0]:
            best = (score, s, loop)
    _, s, loop = best
    return dict(downbeat_phase=r, phase_scores=phase_score, start_beat=s,
                start_time=float(beats[s]), loop_distance=float(loop), period=period,
                beats=beats)


def build(song):
    a = analyse(song)
    bpm, period = a["bpm"], 60.0 / a["bpm"]
    print(f"measured tempo {bpm:.3f} BPM (coarse {a['bpm0']:.2f}), beat {period * 1000:.2f} ms")
    if not 118 <= bpm <= 122:
        sys.exit("tempo out of 118-122 range; pick another track")
    st = pick_start(a, BEATS)
    t_start = st["start_time"]
    print(f"downbeat phase {st['downbeat_phase']}  scores {np.round(st['phase_scores'], 3)}")
    print(f"start beat {st['start_beat']} at {t_start:.4f}s  loop distance {st['loop_distance']:.3f}")

    # Grid: 48 beats of the measured tempo. The film is exactly 24.000 s, so the
    # audio is time-stretched by 120/bpm (pitch preserved) to put 48 measured
    # beats on exactly 24.000 s; the grid is then 0.5 s per beat.
    stretch = 120.0 / bpm
    film = 24.0
    src_len = BEATS * period
    xf = 0.25  # loop crossfade (s) across the downbeat of bar 1
    tmp = os.path.join(ASSETS, "_seg.wav")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{t_start:.6f}", "-t", f"{src_len + xf + 1.0:.6f}",
         "-i", song, "-af", f"atempo={stretch:.8f}", "-ar", str(SR_OUT), "-ac", "2", tmp],
        check=True)
    y = decode(tmp, SR_OUT, channels=2)
    os.remove(tmp)
    n = int(round(film * SR_OUT))
    nx = int(xf * SR_OUT)
    out = y[:n].copy()
    fade = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, nx))[:, None]  # 0 -> 1
    out[:nx] = out[:nx] * fade + y[n:n + nx] * (1 - fade)
    out *= 0.84 / (np.abs(out).max() + 1e-9)
    write_wav(os.path.join(ASSETS, "song-loop.wav"), out)

    # Measured beat peaks inside the trimmed loop (onset envelope of the loop itself).
    mono = out.mean(axis=1)
    an = np.interp(np.arange(0, len(mono), SR_OUT / SR_AN), np.arange(len(mono)), mono)
    env, fps, _ = onset_envelope(an, SR_AN)
    grid = np.arange(BEATS) * (film / BEATS)
    peaks = []
    for g in grid:
        lo, hi = int((g - 0.04) * fps), int((g + 0.04) * fps) + 1
        lo = max(lo, 0)
        seg = env[lo:hi]
        k = lo + int(np.argmax(seg)) if len(seg) else int(g * fps)
        peaks.append(k / fps if seg.size and seg.max() > 0.05 else g)
    peaks = np.array(peaks)
    dev = (peaks - grid) * 1000
    print(f"beat peaks vs grid: mean {dev.mean():+.1f} ms, max |dev| {np.abs(dev).max():.1f} ms")

    rng = np.random.default_rng(4821)
    ui = np.zeros(n)
    placed = []
    for bi, sub, name, gain in EVENTS:
        base = peaks[bi] if sub == 0 else grid[bi] + (peaks[bi] - grid[bi])
        t = base + sub * (film / BEATS)
        s = SOUNDS[name](rng)
        s = s / (np.abs(s).max() + 1e-9) * 10 ** ((LEVEL_DB[name] + gain) / 20)
        i0 = int(round(t * SR_OUT))
        m = min(len(s), n - i0)
        ui[i0:i0 + m] += s[:m]
        placed.append(dict(beat=f"{bi // 4 + 1}.{bi % 4 + 1}", sub=sub, sound=name,
                           t=round(t, 4)))
        path = os.path.join(ASSETS, "ui", f"{name}.wav")
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            write_wav(path, s / (np.abs(s).max() + 1e-9) * 0.8)
    mix = out + ui[:, None]
    mix *= 0.9 / max(0.9, np.abs(mix).max())
    write_wav(os.path.join(ASSETS, "mix.wav"), mix)

    meta = dict(song=os.path.basename(song), bpm_measured=round(bpm, 3),
                bpm_coarse=round(a["bpm0"], 2), stretch=round(stretch, 6),
                source_start_s=round(t_start, 4), source_len_s=round(src_len, 4),
                film_s=film, beat_s=film / BEATS, loop_crossfade_s=xf,
                peak_dev_ms_mean=round(float(dev.mean()), 2),
                peak_dev_ms_max=round(float(np.abs(dev).max()), 2),
                peaks=[round(float(p), 4) for p in peaks], sounds=placed)
    with open(os.path.join(ASSETS, "beats.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"wrote song-loop.wav, mix.wav, beats.json ({len(placed)} UI sounds)")


# ---------------------------------------------------------------- tempo-mapped cuts
#
#   python3 analyze_beats.py cut power assets/music/power.mp3
#   python3 analyze_beats.py click power           (placeholder click track, no song)
#
# The film is written in story beats (12 bars of 4). A cut maps story beats to song
# beats (`unit` song beats per story beat, doubled inside `stretch_bars`) and song
# beats to seconds (measured `beat_times`). This mirrors tOf() in covered-film.html.

CUTS_DIR = os.path.join(HERE, "cuts")
OUT_DIR = os.path.join(HERE, "out")
DENSE_BARS = [3, 5, 7, 11]  # case drop, the drag flip, the double-click check, the £195 sum
CUT_SPECS = {
    # placeholder tempos are only used until the user's file is in assets/music/
    "power": dict(title='"POWER", Kanye West', loop=True, punch=True, story_beats=48, outro=None,
                  placeholder_bpm=77.0, bpm_range=(60, 100)),
    "flames": dict(title='"Dancing in the Flames", The Weeknd', loop=False, punch=False, story_beats=64,
                   outro=dict(end_bar=17, tail_s=0.6), placeholder_bpm=120.0, bpm_range=(90, 180)),
}
MUSIC_EXTS = (".mp3", ".m4a", ".wav", ".aac")
# story beat of each big hit, and how long after that beat the visible hit lands
HIT_STORY = {"case": (8.0, 0.0), "flip": (17.25, 0.045), "check": (27.0, 0.0), "sum": (41.0, 0.0)}
OUTRO_HITS = {"mark": (56.0, 0.0), "final": (64.0, 0.0)}


def rate_at(cut, k):
    return cut["unit"] * (2 if (k // 4 + 1) in cut["stretch_bars"] else 1)


def song_beat(cut, s):
    if s < 0:
        return s * rate_at(cut, 0)
    k = int(np.floor(s))
    return sum(rate_at(cut, i) for i in range(k)) + (s - k) * rate_at(cut, k)


def beat_sec(cut, x):
    bt = cut.get("beat_times")
    if not bt:
        return x * 60.0 / (cut.get("grid_bpm") or cut["bpm"])
    n = len(bt) - 1
    i = max(0, min(n - 1, int(np.floor(x))))
    return bt[i] + (x - i) * (bt[i + 1] - bt[i])


def t_of(cut, s):
    base = beat_sec(cut, song_beat(cut, s))
    for h in cut.get("hits", {}).values():
        d = h["t"] - beat_sec(cut, song_beat(cut, h["story_beat"]))
        base += d * max(0.0, 1 - abs(s - h["story_beat"]))
    return base


def choose_layout(spec, spb):
    """One event per beat or per half-beat (optionally doubling the dense bars) so the
    story lands in 20-32 s in whole bars; nearest to 26 s wins, per-beat on ties."""
    options = []
    for unit in (1.0, 0.5):
        for stretch in ([], DENSE_BARS):
            cut = dict(unit=unit, stretch_bars=stretch)
            beats = song_beat(cut, spec["story_beats"])
            dur = beats * spb
            if abs(beats / 4 - round(beats / 4)) < 1e-9 and 20 <= dur <= 32.05:
                options.append((abs(dur - 26) + (0 if unit == 1 else 0.01) + 0.005 * len(stretch), unit, stretch, beats, dur))
    if not options:
        sys.exit(f"no layout fits 20-32 s at {60 / spb:.1f} BPM")
    _, unit, stretch, beats, dur = min(options)
    return unit, stretch, int(round(beats)), dur


def bar_energy(a, downbeats, period):
    """Per-bar loudness (dB RMS, normalised 0..1) and bar-to-bar novelty."""
    y, sr = a["y"], SR_AN
    e = []
    for d in downbeats:
        seg = y[int(d * sr):int((d + 4 * period) * sr)]
        e.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else -90)
    e = np.array(e)
    lo, hi = np.percentile(e, 5), e.max()
    en = np.clip((e - lo) / (hi - lo + 1e-9), 0, 1)
    nov = np.r_[0, np.abs(np.diff(en))]
    return en, nov


def suggest_sections(a, bars, period, r):
    """Score every downbeat as a section start: loud inside, a jump in from the bars
    before (a chorus or a drop), no dips, and on a 4-bar phrase boundary."""
    beats = a["phase"] + period * np.arange(int((a["dur"] - a["phase"]) / period))
    downbeats = beats[r::4]
    en, nov = bar_energy(a, downbeats, period)
    anchor = int(np.argmax(nov))  # the biggest section change defines the phrase grid
    cands = []
    for s in range(0, len(downbeats) - bars - 1):
        inside = en[s:s + bars]
        before = en[max(0, s - 4):s].mean() if s > 0 else 0.0
        build = en[s:s + 2].mean() - before
        score = inside.mean() + 0.6 * max(0.0, build) + 0.3 * inside.min() - 0.5 * inside.std()
        cands.append(dict(bar=s, start=float(downbeats[s]), end=float(downbeats[s] + bars * 4 * period),
                          score=float(score), energy=float(inside.mean()), build=float(build),
                          mid_phrase=bool((s - anchor) % 4 != 0)))
    cands.sort(key=lambda c: -c["score"])
    return cands, downbeats


def attack_bias(a, period, n=32):
    """Spectral flux on a 93 ms window peaks before a decaying hit's attack. Measure that
    bias against the sample-accurate attack (steepest rise of the low-band envelope)."""
    y, sr = a["y"], SR_AN
    spec = np.fft.rfft(y)
    spec[np.fft.rfftfreq(len(y), 1 / sr) > 1500] = 0
    low = np.abs(np.fft.irfft(spec, len(y)))
    w = int(0.003 * sr)
    envt = np.convolve(low, np.ones(w) / w, mode="same")
    slope = np.diff(envt)
    beats = a["phase"] + period * np.arange(int((a["dur"] - a["phase"]) / period))
    mid = beats[len(beats) // 4: len(beats) // 4 + n]
    devs = []
    for g in mid:
        lo, hi = int((g - 0.08) * sr), int((g + 0.08) * sr)
        if lo > 0 and hi < len(slope):
            devs.append((lo + int(np.argmax(slope[lo:hi]))) / sr - g)
    return float(np.median(devs)) if devs else 0.0


def measured_beats(a, start, n, period):
    """Beat times from the start downbeat, each nudged to its onset peak (±40 ms) when
    the onset is clear, deviations smoothed so tempo drift is followed but jitter is not."""
    env, fps = a["env"], a["fps"]
    grid = start + period * np.arange(n + 1)
    dev = np.zeros(n + 1)
    for i, g in enumerate(grid):
        lo, hi = max(0, int((g - 0.04) * fps)), int((g + 0.04) * fps) + 1
        seg = env[lo:hi]
        if len(seg) and seg.max() > 0.15:
            dev[i] = (lo + int(np.argmax(seg))) / fps - g
    sm = np.array([np.median(dev[max(0, i - 2):i + 3]) for i in range(n + 1)])
    t = grid + sm
    return (t - t[0]).tolist()


def pin_hits(a, cut, start, names):
    """Move each big hit onto the strongest onset within ±0.3 beat of where the grid puts it."""
    env, fps = a["env"], a["fps"]
    spb = 60.0 / cut["bpm"]
    hits = {}
    for name, (sb, lead) in names.items():
        tg = t_of(dict(cut, hits={}), sb) + lead
        lo, hi = max(0, int((start + tg - 0.3 * spb) * fps)), int((start + tg + 0.3 * spb) * fps) + 1
        seg = env[lo:hi]
        if not len(seg):
            continue
        k = lo + int(np.argmax(seg))
        at_grid = env[min(len(env) - 1, int((start + tg) * fps))]
        if seg.max() > 1.3 * max(at_grid, 0.05):
            hits[name] = dict(story_beat=sb, t=round(k / fps - start - lead, 4), onset=round(float(seg.max()), 3))
    return hits


def write_bundle():
    cuts = {}
    for f in sorted(os.listdir(CUTS_DIR)):
        if f.endswith(".json"):
            with open(os.path.join(CUTS_DIR, f)) as fh:
                cuts[f[:-5]] = json.load(fh)
    with open(os.path.join(CUTS_DIR, "cuts.js"), "w") as fh:
        fh.write("// generated by analyze_beats.py from cuts/*.json; loaded by covered-film.html\n")
        fh.write("window.COVERED_CUTS = " + json.dumps(cuts, indent=1) + ";\n")


def mix_cut(cut, song_seg, dur, loop, xf=0.25):
    """UI sounds on the cut's tempo map, each on its local beat peak, mixed into the song."""
    n = int(round(dur * SR_OUT))
    out = song_seg[:n].copy()
    if loop:
        nx = int(xf * SR_OUT)
        fade = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, nx))[:, None]
        out[:nx] = out[:nx] * fade + song_seg[n:n + nx] * (1 - fade)
    else:
        nf = int(min(0.6, dur / 4) * SR_OUT)
        out[-nf:] *= np.linspace(1, 0, nf)[:, None]
    out *= 0.84 / (np.abs(out).max() + 1e-9)
    rng = np.random.default_rng(4821)
    ui = np.zeros(n)
    placed = []
    for sb, sub, name, gain in EVENTS:
        t = t_of(cut, sb + sub)
        s = SOUNDS[name](rng)
        s = s / (np.abs(s).max() + 1e-9) * 10 ** ((LEVEL_DB[name] + gain) / 20)
        i0 = int(round(t * SR_OUT))
        m = min(len(s), n - i0)
        if m > 0:
            ui[i0:i0 + m] += s[:m]
            placed.append(dict(story_beat=sb + sub, sound=name, t=round(t, 4)))
    mix = out + ui[:, None]
    mix *= 0.9 / max(0.9, np.abs(mix).max())
    return mix, placed


def find_song(name):
    folder = os.path.join(ASSETS, "music")
    stems = {"power": ("power",), "flames": ("dancing-in-the-flames", "flames")}[name]
    for stem in stems:
        for ext in MUSIC_EXTS:
            p = os.path.join(folder, stem + ext)
            if os.path.exists(p):
                return p
    return None


def cut_cmd(name, path=None, placeholder=False):
    spec = CUT_SPECS[name]
    path = path or find_song(name)
    if not path:
        sys.exit(f"no song for {name}: put it in assets/music/ (see CUT_SPECS) or run `click {name}`")
    a = analyse(path)
    # beat phase from the low band (kick, bass, snare body): hi-hats on the offbeats
    # otherwise pull the grid half a beat early
    a["env"], _, _ = onset_envelope(a["y"], SR_AN, fmax=1500)
    lo, hi = spec["bpm_range"]
    bpm = a["bpm"]
    while bpm < lo:
        bpm *= 2
    while bpm > hi:
        bpm /= 2
    a["bpm"], a["phase"] = fine_tempo(a["env"], a["fps"], bpm)
    period = 60.0 / a["bpm"]
    bias = attack_bias(a, period)
    a["phase"] = (a["phase"] + bias) % period
    print(f"onset-to-attack bias {bias * 1000:+.1f} ms (grid moved onto the attacks)")
    st = pick_start(a, 8)
    r = st["downbeat_phase"]
    unit, stretch, song_beats, dur = choose_layout(spec, period)
    bars = song_beats // 4
    cands, _ = suggest_sections(a, bars, period, r)
    print(f"{spec['title']}: {a['bpm']:.3f} BPM (coarse {a['bpm0']:.2f}), downbeat phase {r}")
    print(f"layout: {'one event per beat' if unit == 1 else 'one event per half-beat'}"
          f"{', dense bars ' + str(stretch) + ' at double length' if stretch else ''}: "
          f"{song_beats} song beats = {bars} bars = {dur:.2f} s")
    print(" rank  start_s  end_s    bar  score  energy  build  phrase")
    for i, c in enumerate(cands[:8]):
        print(f" {i + 1:>4}  {c['start']:7.2f}  {c['end']:7.2f}  {c['bar']:>4}  {c['score']:.3f}  {c['energy']:.3f}"
              f"  {c['build']:+.3f}  {'MID-PHRASE' if c['mid_phrase'] else 'ok'}")
    pick = next((c for c in cands if not c["mid_phrase"]), cands[0])
    print(f"chosen: bar {pick['bar']}  {pick['start']:.3f}-{pick['end']:.3f} s")
    extra = 8 if spec["outro"] else 2
    bt = measured_beats(a, pick["start"], song_beats + extra, period)
    cut = dict(name=name, title=spec["title"], placeholder=placeholder, audio_source=os.path.relpath(path, HERE),
               bpm=round(a["bpm"], 3), offset_s=round(pick["start"], 4), beats_per_bar=4, unit=unit,
               stretch_bars=stretch, beat_times=[round(x, 4) for x in bt], loop=spec["loop"], punch=spec["punch"],
               outro=spec["outro"], section=dict(start_s=round(pick["start"], 4), end_s=round(pick["end"], 4), bars=bars),
               candidates=[{k: (round(v, 3) if isinstance(v, float) else v) for k, v in c.items()} for c in cands[:8]], hits={})
    if not placeholder:
        cut["hits"] = pin_hits(a, cut, pick["start"], {**HIT_STORY, **(OUTRO_HITS if spec["outro"] else {})})
        print("hits pinned to onsets:", {k: v["t"] for k, v in cut["hits"].items()})
    film_dur = t_of(cut, 48) if spec["loop"] else t_of(cut, (spec["outro"]["end_bar"] - 1) * 4) + spec["outro"]["tail_s"]
    # audio: section (+ loop crossfade tail), stereo 48 kHz, UI sounds on the tempo map
    derived = os.path.join(OUT_DIR, "click") if placeholder else os.path.join(ASSETS, "music", "derived")
    os.makedirs(derived, exist_ok=True)
    tmp = os.path.join(derived, f"_{name}_seg.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{pick['start']:.6f}", "-t", f"{film_dur + 1.5:.6f}",
                    "-i", path, "-ar", str(SR_OUT), "-ac", "2", tmp], check=True)
    seg = decode(tmp, SR_OUT, channels=2)
    os.remove(tmp)
    if len(seg) < int((film_dur + (0.25 if spec["loop"] else 0)) * SR_OUT):
        sys.exit("section runs past the end of the song")
    mix, placed = mix_cut(cut, seg, film_dur, spec["loop"])
    mix_path = os.path.join(derived, f"{name}-mix.wav")
    write_wav(mix_path, mix)
    cut.update(duration_s=round(film_dur, 4), mix=os.path.relpath(mix_path, HERE), sounds=placed)
    os.makedirs(CUTS_DIR, exist_ok=True)
    with open(os.path.join(CUTS_DIR, f"{name}.json"), "w") as fh:
        json.dump(cut, fh, indent=1)
    write_bundle()
    print(f"wrote cuts/{name}.json (film {film_dur:.2f} s), {os.path.relpath(mix_path, HERE)}")


def click_cmd(name):
    """Placeholder: a synthetic click track at the placeholder tempo, with a soft intro,
    a loud chorus, a quieter verse and a second chorus, so the section picker has work to do."""
    spec = CUT_SPECS[name]
    bpm = spec["placeholder_bpm"]
    period = 60.0 / bpm
    plan = [0.22] * 8 + [1.0] * 16 + [0.5] * 8 + [1.0] * 16 + [0.22] * 8
    n = int((len(plan) * 4 + 2) * period * SR_OUT)
    y = np.zeros(n)
    rng = np.random.default_rng(77)
    kick = lambda: (np.sin(2 * np.pi * 55 * np.arange(int(0.18 * SR_OUT)) / SR_OUT * (1 + 2 * env_exp(int(0.18 * SR_OUT), 0.02)))
                    * env_exp(int(0.18 * SR_OUT), 0.06))
    for bar, g in enumerate(plan):
        for k in range(4):
            t = (bar * 4 + k) * period
            i = int(t * SR_OUT)
            kk = kick() * g * (1.0 if k == 0 else 0.7)
            y[i:i + len(kk)] += kk[: max(0, min(len(kk), n - i))]
            h = bandnoise(int(0.03 * SR_OUT), 6000, 14000, rng) * env_exp(int(0.03 * SR_OUT), 0.008) * 0.25 * g
            j = int((t + period / 2) * SR_OUT)
            y[j:j + len(h)] += h[: max(0, min(len(h), n - j))]
    y = np.stack([y, y], 1) * 0.8 / (np.abs(y).max() + 1e-9)
    os.makedirs(os.path.join(OUT_DIR, "click"), exist_ok=True)
    path = os.path.join(OUT_DIR, "click", f"{name}-click.wav")
    write_wav(path, y)
    print(f"placeholder click track {bpm:g} BPM: {os.path.relpath(path, HERE)}")
    cut_cmd(name, path, placeholder=True)


if __name__ == "__main__":
    cmds = ("scan", "build", "cut", "click", "bundle")
    if len(sys.argv) < 2 or sys.argv[1] not in cmds or (sys.argv[1] != "bundle" and len(sys.argv) < 3):
        sys.exit(__doc__)
    if sys.argv[1] == "scan":
        scan(sys.argv[2:])
    elif sys.argv[1] == "build":
        build(sys.argv[2])
    elif sys.argv[1] == "cut":
        cut_cmd(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif sys.argv[1] == "click":
        click_cmd(sys.argv[2])
    else:
        write_bundle()
