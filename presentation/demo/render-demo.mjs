#!/usr/bin/env node
// Render the 2-minute demo cut (demo.html) with Playwright.
//
//   node demo/render-demo.mjs sheet                 one frame per bar (bar start + 1.0 s) + contact sheet
//   node demo/render-demo.mjs frames t...           single PNGs
//   node demo/render-demo.mjs full [--sub 2] [--workers n]
//                                                   60 fps video (no audio): n subframes per frame blended with tmix
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "out", "demo");
const PAGE = "file://" + path.join(HERE, "demo.html");
const FPS = 60, W = 1920, H = 1080;
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i > 0 ? argv[i + 1] : d; };

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("[page error]", e.message));
  page.on("console", m => { if (m.type() === "error") console.error("[page]", m.text()); });
  await page.goto(PAGE);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
  const cdp = await page.context().newCDPSession(page);
  for (const k of [2, 36, 50, 75, 100, 0]) { await page.evaluate(s => window.seek(s), k); await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true }); }
  return { page, cdp };
}
async function shot({ page, cdp }, t, file) {
  await page.evaluate(tt => window.seek(tt), t);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  const buf = Buffer.from(data, "base64");
  if (file) fs.writeFileSync(file, buf);
  return buf;
}
function run(cmd, args) {
  return new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] }); p.on("exit", c => (c === 0 ? res() : rej(new Error(`${cmd} ${c}`)))); });
}

async function sheet() {
  const dir = path.join(OUT, "bars"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await openPage(browser);
  const subs = await ctx.page.evaluate(() => window.TL.subs);
  const files = [];
  for (let b = 1; b <= 60; b++) {
    const t = (b - 1) * 2 + 1.0, f = path.join(dir, `bar-${String(b).padStart(2, "0")}.png`);
    await shot(ctx, t, f);
    const s = subs.find(x => t >= x[0] && t < x[1]);
    files.push([f, b, t, s ? s[2] : ""]);
  }
  const tiles = files.map(([f, b, t]) => `<div class="t"><img src="file://${f}"><b>bar ${b} · ${t.toFixed(1)}s</b></div>`).join("");
  const pg = await browser.newPage({ viewport: { width: 6 * 480, height: 10 * 270 }, deviceScaleFactor: 1 });
  const html = path.join(OUT, "sheet.html");
  fs.writeFileSync(html, `<html><body style="margin:0;background:#000"><style>.g{display:grid;grid-template-columns:repeat(6,480px)}.t{position:relative;width:480px;height:270px}.t img{width:480px;height:270px;display:block}.t b{position:absolute;left:6px;top:6px;font:700 18px Arial;color:#fff;background:rgba(0,0,0,.65);padding:2px 7px;border-radius:4px}</style><div class="g">${tiles}</div></body></html>`);
  await pg.goto("file://" + html);
  await pg.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  await pg.screenshot({ path: path.join(OUT, "contact-sheet-demo.png") });
  fs.unlinkSync(html);
  await browser.close();
  console.log("wrote", path.join(OUT, "contact-sheet-demo.png"));
}

async function frames(ts) {
  const dir = path.join(OUT, "check"); fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch(); const ctx = await openPage(browser);
  for (const t of ts) await shot(ctx, t, path.join(dir, `t-${t.toFixed(3)}.png`));
  await browser.close();
}

async function full(workers, SUB) {
  const tmp = path.join(OUT, "chunks"); fs.mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch();
  const total = 120 * FPS, per = Math.ceil(total / workers), t0 = Date.now();
  let done = 0; const chunks = [];
  const weights = Array(SUB).fill(1).join(" ");
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per); if (a >= b) return;
    const file = path.join(tmp, `chunk-${String(w).padStart(2, "0")}.mkv`); chunks[w] = file;
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "png", "-i", "-",
      "-vf", `tmix=frames=${SUB}:weights='${weights}',select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/(${FPS}*TB)`,
      "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv444p", file], { stdio: ["pipe", "inherit", "inherit"] });
    const exited = new Promise((res, rej) => ff.on("exit", c => (c === 0 ? res() : rej(new Error("ffmpeg " + c)))));
    const ctx = await openPage(browser);
    for (let k = a; k < b; k++) {
      for (let j = 0; j < SUB; j++) { const buf = await shot(ctx, k / FPS + j / (FPS * SUB)); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r)); }
      if (++done % 600 === 0) { const s = (Date.now() - t0) / 1000; console.log(`${done}/${total}  ${s.toFixed(0)}s  eta ${((total - done) * s / done).toFixed(0)}s`); }
    }
    ff.stdin.end(); await exited; await ctx.page.close();
  }));
  await browser.close();
  const list = path.join(tmp, "list.txt");
  fs.writeFileSync(list, chunks.filter(Boolean).map(f => `file '${f}'`).join("\n") + "\n");
  const out = path.join(OUT, "video.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), "-t", "120", out]);
  console.log("wrote", out, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (mode === "sheet") await sheet();
else if (mode === "frames") await frames(argv.slice(1).filter(a => !a.startsWith("--")).map(Number));
else if (mode === "full") await full(Number(opt("workers", 12)), Number(opt("sub", 2)));
else { console.error("usage: sheet|frames|full"); process.exit(1); }
