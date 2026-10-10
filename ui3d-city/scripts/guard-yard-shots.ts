/* The Guard Yard's visual check (prompt section 15): the reference (docs/reference/avaguard-fx.html, window.__seek)
   and our page (/guard, window.__guardSeek), 1280 x 720, at the twelve instants; each pair side by side in
   artifacts/guard-yard/compare_<t>.png. Look at every one.
     npm run dev   (in another terminal)
     node --experimental-strip-types scripts/guard-yard-shots.ts [baseUrl]   */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

const TIMES = [3.4, 6.9, 11.5, 12.5, 13.35, 14.45, 15.5, 16.4, 17.6, 19.3, 20.4, 21.8];
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = resolve("artifacts/guard-yard");
mkdirSync(OUT, { recursive: true });

async function stageShot(page: Page, selector: string) {
  const el = page.locator(selector).first();
  return el.screenshot({ type: "png" });
}

const browser = await chromium.launch({ channel: "chrome", args: [process.platform === "win32" ? "--use-angle=d3d11" : "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
const ref = await ctx.newPage();
const ours = await ctx.newPage();
await ref.goto(pathToFileURL(resolve("docs/reference/avaguard-fx.html")).href);
await ours.goto(`${BASE}/guard`);
await ref.waitForFunction(() => typeof (window as unknown as { __seek?: unknown }).__seek === "function");
await ours.waitForFunction(() => typeof (window as unknown as { __guardSeek?: unknown }).__guardSeek === "function", null, { timeout: 60_000 });
await ref.waitForTimeout(1500);
await ours.waitForTimeout(2500);

const compare = await ctx.newPage();
for (const t of TIMES) {
  await ref.evaluate((x) => (window as unknown as { __seek: (t: number) => void }).__seek(x), t);
  await ours.evaluate((x) => (window as unknown as { __guardSeek: (t: number) => void }).__guardSeek(x), t);
  await ref.waitForTimeout(500);
  await ours.waitForTimeout(700);
  const a = (await stageShot(ref, ".stage")).toString("base64");
  const b = (await stageShot(ours, ".gy-stage")).toString("base64");
  await compare.setViewportSize({ width: 1920, height: 600 });
  await compare.setContent(
    `<body style="margin:0;background:#05070c;display:flex;gap:8px;padding:8px;font:12px monospace;color:#8a93a8">` +
      `<figure style="margin:0;flex:1"><img style="width:100%" src="data:image/png;base64,${a}"><figcaption>référence · t = ${t}</figcaption></figure>` +
      `<figure style="margin:0;flex:1"><img style="width:100%" src="data:image/png;base64,${b}"><figcaption>Guard Yard · t = ${t}</figcaption></figure></body>`,
  );
  await compare.waitForTimeout(150);
  await compare.screenshot({ path: `${OUT}/compare_${t}.png`, fullPage: true });
  console.log(`compare_${t}.png`);
}
await browser.close();
