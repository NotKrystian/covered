#!/usr/bin/env node
// Render the Covered product film with Playwright.
//
//   node render.mjs beats  [--cut c]            one PNG per story beat (+0.2 s) + contact sheet
//   node render.mjs outro  [--cut flames]       full-size outro frames, both logo options
//   node render.mjs frames [--cut c] t...       single PNGs at the given times
//   node render.mjs verify [--cut c]            purity (no state between frames) + loop / final-hit checks
//   node render.mjs full   [--cut c] [--out f] [--workers n]
//                                               60 fps mp4: 4 subframes per frame blended with tmix
//
// Cuts live in cuts/<cut>.json (bundled into cuts/cuts.js); the page maps story beats
// to seconds with the cut's tempo map and exposes window.seek(t) and window.FILM.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const FRAMES = path.join(HERE, "frames");
const PAGE = "file://" + path.join(HERE, "covered-film.html");
const FPS = 60, SUB = 4;
const W = 1920, H = 1080;

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i > 0 ? argv[i + 1] : d; };
const CUT = opt("cut", "mixkit");
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").startsWith("--"));
const cutJson = () => JSON.parse(fs.readFileSync(path.join(HERE, "cuts", `${CUT}.json`), "utf8"));
const outDir = () => (CUT === "mixkit" ? OUT : path.join(OUT, CUT));

async function openPage(browser, query = "") {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text()); });
  page.on("pageerror", e => console.error("[page error]", e.message));
  await page.goto(`${PAGE}?cut=${CUT}${query}`);
  const bad = await page.evaluate(() => window.filmReady);
  if (bad && bad.length) console.error("non-periodic tracks:", bad);
  const film = await page.evaluate(() => window.FILM);
  const cdp = await page.context().newCDPSession(page);
  // paint every photo-bearing state once so no capture sees a half-decoded image
  for (const k of [5.8, 8.4, 13.2, 20.8, 23.6, 28.6, 32.4, 39.2, 43.6, 0]) {
    await page.evaluate(s => window.seek(window.tOfStory(s)), k);
    await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  }
  return { page, cdp, film };
}

async function shot({ page, cdp }, t, file) {
  await page.evaluate(tt => window.seek(tt), t);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false });
  const buf = Buffer.from(data, "base64");
  if (file) fs.writeFileSync(file, buf);
  return buf;
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", c => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
  });
}

function sheetHeader(film) {
  const c = cutJson();
  const layout = film.unit === 1 ? "one event per beat" : "one event per half-beat";
  const stretch = film.stretch_bars.length ? `, story bars ${film.stretch_bars.join("/")} at double length` : "";
  const kind = film.loop ? `${film.period.toFixed(2)} s loop` : `${film.duration.toFixed(2)} s, logo outro`;
  const warn = film.placeholder ? `PLACEHOLDER TEMPO ${film.bpm.toFixed(1)} BPM (synthetic click track, song file not supplied)`
    : `${film.bpm.toFixed(2)} BPM measured`;
  return `${c.title || CUT} — ${warn} · ${layout}${stretch} · ${kind}`;
}

async function beats() {
  const dir = path.join(outDir(), "beats");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await openPage(browser);
  const times = ctx.film.beats.map(t => t + 0.2);
  if (ctx.film.outro) times.push(ctx.film.outro.final + 0.35);
  const files = [];
  for (let i = 0; i < times.length; i++) {
    const bar = Math.floor(i / 4) + 1, b = (i % 4) + 1;
    const lab = i < ctx.film.beats.length ? `${bar}.${b}` : "end";
    const name = `beat-${String(i + 1).padStart(2, "0")}-${lab}.png`;
    await shot(ctx, times[i], path.join(dir, name));
    files.push([name, lab, times[i]]);
  }
  // contact sheet: 8 tiles per row, each labelled with its story beat and time
  const header = CUT === "mixkit" ? "" : sheetHeader(ctx.film);
  const tiles = files.map(([f, lab, t]) =>
    `<div class="t"><img src="file://${path.join(dir, f)}"><b>${lab} · ${t.toFixed(2)}s</b></div>`).join("");
  const rows = Math.ceil(files.length / 8), headH = header ? 64 : 0;
  const sheet = await browser.newPage({ viewport: { width: 8 * 480, height: rows * 270 + headH }, deviceScaleFactor: 1 });
  const htmlFile = path.join(outDir(), "contact-sheet.html");
  fs.writeFileSync(htmlFile, `<html><body style="margin:0;background:#000">
    <style>.g{display:grid;grid-template-columns:repeat(8,480px)}.t{position:relative;width:480px;height:270px}.t img{width:480px;height:270px;display:block}
    .t b{position:absolute;left:6px;top:6px;font:700 20px Arial;color:#fff;background:rgba(0,0,0,.65);padding:2px 7px;border-radius:4px}
    .h{height:${headH}px;display:flex;align-items:center;padding:0 22px;font:700 28px Arial;color:#111;background:${ctx.film.placeholder ? "#ffd84d" : "#ebe8e2"}}</style>
    ${header ? `<div class="h">${header}</div>` : ""}<div class="g">${tiles}</div></body></html>`);
  await sheet.goto("file://" + htmlFile);
  await sheet.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  const png = CUT === "mixkit" ? path.join(OUT, "contact-sheet.png") : path.join(OUT, `contact-sheet-${CUT}.png`);
  await sheet.screenshot({ path: png });
  fs.unlinkSync(htmlFile);
  await browser.close();
  console.log(`wrote ${files.length} beat frames to ${path.relative(HERE, dir)} and ${path.relative(HERE, png)}`);
}

async function outro() {
  const dir = path.join(outDir(), "outro");
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  for (const mark of ["a", "b"]) {
    const ctx = await openPage(browser, `&mark=${mark}`);
    const o = ctx.film.outro;
    if (!o) throw new Error(`${CUT} has no outro`);
    for (const [name, t] of [["tagline", o.tagline], ["mark", o.mark], ["lockup", o.lockup]]) {
      if (name === "tagline" && mark === "b") continue;
      await shot(ctx, t, path.join(dir, `outro-${name}${name === "tagline" ? "" : "-" + mark.toUpperCase()}.png`));
    }
    await ctx.page.close();
  }
  await browser.close();
  console.log("wrote", path.relative(HERE, dir));
}

async function frames(times) {
  fs.mkdirSync(path.join(OUT, "check"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await openPage(browser);
  for (const t of times) await shot(ctx, t, path.join(OUT, "check", `${CUT}-t-${t.toFixed(4)}.png`));
  await browser.close();
}

function decodePng(buf) {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-v", "error", "-f", "png_pipe", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const out = [];
    p.stdout.on("data", d => out.push(d));
    p.on("exit", c => (c === 0 ? res(Buffer.concat(out)) : rej(new Error("decode"))));
    p.stdin.end(buf);
  });
}
async function pixelDiff(a, b) {
  const [x, y] = await Promise.all([decodePng(a), decodePng(b)]);
  let max = 0, over = 0;
  for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d > max) max = d; if (d > 6) over++; }
  return { max, over };
}

// Purity + loop checks: a frame must not depend on what was rendered before it; a
// looping cut must give the same picture at t = period as at t = 0 (and just after);
// an outro cut must hold the lockup until the final hit and fade on it.
async function verify() {
  const browser = await chromium.launch();
  const fresh = await openPage(browser), seq = await openPage(browser);
  const film = fresh.film;
  const times = film.beats.map(t => t + 0.2);
  let seed = 4821; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const order = [...times].sort(() => rnd() - 0.5);
  // everything that can reach the screen: visible elements' styles, text and SVG geometry
  const visibleState = ctx => ctx.page.evaluate(() => [...document.querySelectorAll("#stage *")]
    .filter(e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map(e => { const c = getComputedStyle(e); return [e.id || e.tagName,
      ...["opacity", "transform", "filter", "left", "top", "width", "height", "backgroundColor", "color", "borderRadius", "boxShadow", "zIndex", "strokeDashoffset", "clipPath"].map(k => c[k]),
      e.childElementCount ? "" : e.textContent,
      ...["cx", "cy", "r", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "transform"].map(a => e.getAttribute(a))].join("|"); }).join("\n"));
  let leaks = 0;
  for (const t of order) {
    for (let k = 0; k < 4; k++) await shot(seq, rnd() * film.duration);
    await shot(seq, t - 1 / 240);
    await shot(seq, t); const sa = await visibleState(seq);
    await fresh.page.close();
    Object.assign(fresh, await openPage(browser));
    await shot(fresh, t); const sb = await visibleState(fresh);
    if (sa !== sb) { leaks++; console.log(`state leak at t=${t.toFixed(3)}`); }
  }
  console.log(`${CUT} purity: ${times.length - leaks}/${times.length} beat frames have identical visible state fresh vs after a shuffled history`);
  if (film.loop) {
    for (const d of [0, 1 / 240, 2 / 240, 1 / 60]) {
      const a = await shot(fresh, d), b = await shot(fresh, film.period + d);
      const { max } = await pixelDiff(a, b);
      console.log(`loop: seek(${d.toFixed(4)}) vs seek(${(film.period + d).toFixed(4)}): ${a.equals(b) ? "byte-identical" : `max diff ${max}`}`);
    }
  }
  if (film.outro) {
    const probe = t => fresh.page.evaluate(tt => { window.seek(tt);
      const op = id => +getComputedStyle(document.getElementById(id)).opacity;
      return { fade: op("ofade"), mark: op("omark") }; }, t);
    const f = film.outro.final;
    for (const [lab, t] of [["hit − 200 ms", f - 0.2], ["hit − 100 ms", f - 0.1], ["hit", f], ["hit + 50 ms", f + 0.05], ["end", film.duration - 1 / 60]]) {
      const p = await probe(t);
      console.log(`final hit ${lab.padEnd(12)} t=${t.toFixed(3)}  lockup ${p.mark.toFixed(3)}  canvas fade ${p.fade.toFixed(3)}`);
    }
    console.log(`lockup settles at ${film.outro.lockup.toFixed(2)} s, holds ${(f - film.outro.lockup).toFixed(2)} s to the final hit at ${f.toFixed(3)} s`);
  }
  await browser.close();
}

async function full(workers, outFile) {
  fs.mkdirSync(FRAMES, { recursive: true });
  const cut = cutJson();
  const browser = await chromium.launch();
  const probe = await openPage(browser);
  const film = probe.film;
  await probe.page.close();
  if (film.placeholder && !argv.includes("--allow-placeholder")) throw new Error(`${CUT} is a placeholder (no song file); run analyze_beats.py cut ${CUT} first`);
  const total = Math.round(film.duration * FPS);
  const per = Math.ceil(total / workers);
  const t0 = Date.now();
  let done = 0;
  const chunks = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const file = path.join(FRAMES, `${CUT}-chunk-${String(w).padStart(2, "0")}.mkv`);
    chunks[w] = file;
    // tmix averages the 4 subframes of each output frame; select keeps the frame
    // whose window is exactly subframes 4k..4k+3 (chunks start on a frame boundary).
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "png", "-i", "-",
      "-vf", `tmix=frames=${SUB}:weights='1 1 1 1',select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`,
      "-r", String(FPS), "-c:v", "ffv1", "-pix_fmt", "bgr0", file], { stdio: ["pipe", "inherit", "inherit"] });
    const exited = new Promise((res, rej) => ff.on("exit", c => (c === 0 ? res() : rej(new Error("ffmpeg " + c)))));
    const ctx = await openPage(browser);
    for (let k = a; k < b; k++) {
      for (let j = 0; j < SUB; j++) {
        const buf = await shot(ctx, k / FPS + j / (FPS * SUB));
        if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
      }
      done++;
      if (done % 120 === 0) {
        const s = (Date.now() - t0) / 1000;
        console.log(`${done}/${total} frames  ${s.toFixed(0)}s  eta ${((total - done) * s / done).toFixed(0)}s`);
      }
    }
    ff.stdin.end();
    await exited;
    await ctx.page.close();
  }));
  await browser.close();
  const list = path.join(FRAMES, `${CUT}-chunks.txt`);
  fs.writeFileSync(list, chunks.filter(Boolean).map(f => `file '${f}'`).join("\n") + "\n");
  const mp4 = outFile ? path.resolve(outFile) : path.join(OUT, CUT === "mixkit" ? "covered-film.mp4" : `covered-film-${CUT}.mp4`);
  fs.mkdirSync(path.dirname(mp4), { recursive: true });
  let audio = path.join(HERE, cut.mix);
  if (!fs.existsSync(audio) && CUT === "mixkit") audio = path.join(HERE, "assets", "mix.m4a");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-i", audio,
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-profile:v", "high", "-c:a", "aac", "-b:a", "256k", "-t", (total / FPS).toFixed(6), "-movflags", "+faststart", mp4]);
  console.log("wrote", path.relative(HERE, mp4), `(${(total / FPS).toFixed(3)} s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (mode === "beats") await beats();
else if (mode === "outro") await outro();
else if (mode === "frames") await frames(positional.map(Number));
else if (mode === "verify") await verify();
else if (mode === "full") await full(Number(opt("workers", 0)) || Math.max(2, Math.min(10, os.cpus().length - 4)), opt("out"));
else { console.error("usage: node render.mjs beats|outro|frames|verify|full [--cut mixkit|power|flames] [--out file]"); process.exit(1); }
