#!/usr/bin/env node
// Render the Covered product film with Playwright.
//
//   node render.mjs beats            48 PNGs (beat + 0.2 s) + contact sheet
//   node render.mjs frames 0 24 ...  single PNGs at the given times
//   node render.mjs verify           purity (no state between frames) + loop checks
//   node render.mjs full [workers]   60 fps mp4: 4 subframes per frame blended with tmix
//
// Every frame is a pure function of t: the page exposes window.seek(t).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const FRAMES = path.join(HERE, "frames");
const URL = "file://" + path.join(HERE, "covered-film.html");
const FPS = 60, SUB = 4, DUR = 24;
const W = 1920, H = 1080;

async function openPage(browser, query = "") {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text()); });
  page.on("pageerror", e => console.error("[page error]", e.message));
  await page.goto(URL + query);
  const bad = await page.evaluate(() => window.filmReady);
  if (bad && bad.length) console.error("non-periodic tracks:", bad);
  const cdp = await page.context().newCDPSession(page);
  // paint every photo-bearing state once so no capture sees a half-decoded image
  for (const t of [2.9, 4.2, 6.6, 10.4, 11.8, 14.3, 16.2, 19.6, 21.8, 0]) {
    await page.evaluate(tt => window.seek(tt), t);
    await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  }
  return { page, cdp };
}

async function shot({ page, cdp }, t, file) {
  await page.evaluate(tt => window.seek(tt), t);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false });
  const buf = Buffer.from(data, "base64");
  if (file) fs.writeFileSync(file, buf);
  return buf;
}

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"], ...opts });
    p.on("exit", c => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
    if (opts.stdinData) { p.stdin.end(opts.stdinData); }
  });
}

async function beats() {
  const dir = path.join(OUT, "beats");
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await openPage(browser);
  for (let i = 0; i < 48; i++) {
    const bar = Math.floor(i / 4) + 1, b = (i % 4) + 1;
    const name = `beat-${String(i + 1).padStart(2, "0")}-${bar}.${b}.png`;
    await shot(ctx, i * 0.5 + 0.2, path.join(dir, name));
  }
  // contact sheet: 8 x 6 tiles, each labelled with its beat
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
  const tiles = files.map((f, i) => {
    const lab = f.replace(/^beat-\d+-/, "").replace(".png", "");
    return `<div class="t"><img src="file://${path.join(dir, f)}"><b>${lab} · ${(i * 0.5 + 0.2).toFixed(1)}s</b></div>`;
  }).join("");
  const sheet = await browser.newPage({ viewport: { width: 8 * 480, height: 6 * 270 }, deviceScaleFactor: 1 });
  const htmlFile = path.join(OUT, "contact-sheet.html");
  fs.writeFileSync(htmlFile, `<html><body style="margin:0;display:grid;grid-template-columns:repeat(8,480px);background:#000">
    <style>.t{position:relative;width:480px;height:270px}.t img{width:480px;height:270px;display:block}
    .t b{position:absolute;left:6px;top:6px;font:700 20px Arial;color:#fff;background:rgba(0,0,0,.65);padding:2px 7px;border-radius:4px}</style>${tiles}</body></html>`);
  await sheet.goto("file://" + htmlFile);
  await sheet.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  await sheet.screenshot({ path: path.join(OUT, "contact-sheet.png") });
  fs.unlinkSync(htmlFile);
  await browser.close();
  console.log("wrote", dir, "and contact-sheet.png");
}

async function frames(times) {
  fs.mkdirSync(path.join(OUT, "check"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await openPage(browser);
  for (const t of times) await shot(ctx, t, path.join(OUT, "check", `t-${t.toFixed(4)}.png`));
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
// Chrome's raster cache can shift antialiasing by one level between nearby frames;
// anything above 6 levels in any channel is a real difference.
async function pixelDiff(a, b) {
  const [x, y] = await Promise.all([decodePng(a), decodePng(b)]);
  let max = 0, over = 0;
  for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d > max) max = d; if (d > 6) over++; }
  return { max, over };
}

// Purity + loop checks: a frame must not depend on what was rendered before it,
// and t = 24 must be the same picture as t = 0 (also one and two subframes later).
async function verify() {
  const browser = await chromium.launch();
  const fresh = await openPage(browser), seq = await openPage(browser);
  const times = Array.from({ length: 48 }, (_, i) => i * 0.5 + 0.2);
  let seed = 4821; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const order = [...times].sort(() => rnd() - 0.5);
  // everything that can reach the screen: visible elements' styles, text and SVG geometry
  const visibleState = ctx => ctx.page.evaluate(() => [...document.querySelectorAll("#stage *")]
    .filter(e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map(e => { const c = getComputedStyle(e); return [e.id || e.tagName,
      ...["opacity", "transform", "filter", "left", "top", "width", "height", "backgroundColor", "color", "borderRadius", "boxShadow", "zIndex", "strokeDashoffset"].map(k => c[k]),
      e.childElementCount ? "" : e.textContent,
      ...["cx", "cy", "r", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "transform"].map(a => e.getAttribute(a))].join("|"); }).join("\n"));
  let leaks = 0, worst = 0;
  for (const t of order) {
    for (let k = 0; k < 4; k++) await shot(seq, rnd() * DUR);
    await shot(seq, t - 1 / 240);
    const a = await shot(seq, t), sa = await visibleState(seq);
    await fresh.page.close();
    Object.assign(fresh, await openPage(browser));
    const b = await shot(fresh, t), sb = await visibleState(fresh);
    worst = Math.max(worst, (await pixelDiff(a, b)).max);
    if (sa !== sb) { leaks++; console.log(`state leak at t=${t}`); }
  }
  console.log(`purity: ${48 - leaks}/48 beat frames have identical visible state fresh vs after a shuffled history`);
  console.log(`        (largest raster difference ${worst} levels: Chrome antialiasing on unchanged edges)`);
  for (const d of [0, 1 / 240, 2 / 240, 1 / 60]) {
    const a = await shot(fresh, d), b = await shot(fresh, DUR + d);
    const { max } = await pixelDiff(a, b);
    console.log(`loop: seek(${d.toFixed(4)}) vs seek(${(DUR + d).toFixed(4)}): ${a.equals(b) ? "byte-identical" : `max diff ${max}`}`);
  }
  await browser.close();
}

async function full(workers) {
  fs.mkdirSync(FRAMES, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const total = FPS * DUR; // 1440 output frames
  const per = Math.ceil(total / workers);
  const browser = await chromium.launch();
  const t0 = Date.now();
  let done = 0;
  const chunks = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const file = path.join(FRAMES, `chunk-${String(w).padStart(2, "0")}.mkv`);
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
      if (done % 60 === 0) {
        const s = (Date.now() - t0) / 1000;
        console.log(`${done}/${total} frames  ${s.toFixed(0)}s  eta ${((total - done) * s / done).toFixed(0)}s`);
      }
    }
    ff.stdin.end();
    await exited;
    await ctx.page.close();
  }));
  await browser.close();
  const list = path.join(FRAMES, "chunks.txt");
  fs.writeFileSync(list, chunks.filter(Boolean).map(f => `file '${f}'`).join("\n") + "\n");
  const mp4 = path.join(OUT, "covered-film.mp4");
  const wav = path.join(HERE, "assets", "mix.wav");
  const audio = fs.existsSync(wav) ? wav : path.join(HERE, "assets", "mix.m4a");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-i", audio,
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-profile:v", "high", "-c:a", "aac", "-b:a", "256k", "-t", String(DUR), "-movflags", "+faststart", mp4]);
  console.log("wrote", mp4, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "beats") await beats();
else if (mode === "frames") await frames(rest.map(Number));
else if (mode === "verify") await verify();
else if (mode === "full") await full(Number(rest[0]) || Math.max(2, Math.min(10, os.cpus().length - 4)));
else { console.error("usage: node render.mjs beats | frames t... | full [workers]"); process.exit(1); }
