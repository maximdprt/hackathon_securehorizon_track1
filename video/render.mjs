// Renders video/compose.html frame by frame (each frame computed from its time, the clips sought exactly) and pipes the
// frames to ffmpeg: a steady 30 fps 1080p film, whatever the machine's speed.
//
//   node video/render.mjs <capDir> <out.mp4>              the whole film (video only; video/audio.sh adds the sound)
//   node video/render.mjs <capDir> <outDir> --stills 3,40  stills at those times, to check a layout
//   FILM_PAGE=video/tour.html node video/render.mjs …       the wordless tour instead of the first film
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "../ui3d-city/node_modules/playwright/index.mjs";

const [, , capDir, out, flag, list] = process.argv;
const FPS = 30;
const page_url = `${pathToFileURL(resolve(process.env.FILM_PAGE || "video/compose.html")).href}?cap=${encodeURIComponent(pathToFileURL(resolve(capDir)).href + "/")}`;

const browser = await chromium.launch({ channel: "chrome", args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && console.log("page:", m.text()));
await page.goto(page_url);
await page.evaluate(() => window.FILM.ready);
const END = await page.evaluate(() => window.FILM.END);

if (flag === "--stills") {
  mkdirSync(out, { recursive: true });
  for (const t of list.split(",").map(Number)) {
    await page.evaluate((x) => window.FILM.renderAt(x), t);
    await page.screenshot({ path: join(out, `still_${String(t).replace(".", "_")}.jpg`), type: "jpeg", quality: 85 });
  }
} else {
  const n = Math.round(END * FPS);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((x) => window.FILM.renderAt(x), i / FPS);
    const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 150 === 0) console.log(`frame ${i}/${n}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`done: ${out}`);
}
await browser.close();
