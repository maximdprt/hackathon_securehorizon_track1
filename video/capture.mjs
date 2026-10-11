// Records the film's live footage in Chrome (Playwright), as the screen shows it: the DevTools screencast's frames,
// with their timestamps, made into a steady 30 fps H.264 clip by ffmpeg. Each shot logs its marks (when what
// happens) to <out>.marks.json, so the composition cuts on the action.
//
//   node video/capture.mjs agent     <outDir>   the chat: the demo sandbox (video/agent_server.py) on :8765
//   node video/capture.mjs city      <outDir>   the city in production, its four scenes in order (?live=0, writes nothing)
//   node video/capture.mjs explorer  <outDir>   the block explorer (read only)
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "../ui3d-city/node_modules/playwright/index.mjs";

const [, , shot, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const W = 1920, H = 1080;

async function record(name, url, act, { scheme = "dark" } = {}) {
  const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: scheme });
  await page.goto(url);
  const frames = join(outDir, `${name}_frames`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames);
  const cdp = await page.context().newCDPSession(page);
  const got = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = join(frames, `${String(got.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    got.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const marks = [];
  let t0 = 0;
  const mark = (label) => {
    marks.push({ label, t: Date.now() / 1000 - t0 });
    console.log(`  ${label} @ ${(Date.now() / 1000 - t0).toFixed(2)}s`);
  };
  const go = async () => {
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    t0 = Date.now() / 1000;
  };
  await act(page, { go, mark });
  const stopAt = Date.now() / 1000; // a still page sends no frame: its last one is held until here
  await cdp.send("Page.stopScreencast");
  await browser.close();
  // the frames as they came, each held until the next one, resampled to 30 fps
  const list = [];
  for (let i = 0; i < got.length; i++) {
    const d = i + 1 < got.length ? got[i + 1].t - got[i].t : Math.max(0.5, stopAt - got[i].t);
    list.push(`file '${got[i].file.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
  }
  list.push(`file '${got.at(-1).file.replace(/\\/g, "/")}'`);
  const listFile = join(outDir, `${name}_list.txt`);
  writeFileSync(listFile, list.join("\n"));
  const out = join(outDir, `${name}.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-g", "15", "-movflags", "+faststart", out]);
  const first = got[0].t;
  writeFileSync(join(outDir, `${name}.marks.json`), JSON.stringify({ offset: first - t0, marks }, null, 1));
  rmSync(frames, { recursive: true, force: true });
  console.log(`${name}: ${got.length} frames -> ${out}`);
}

const ag = (page, fn, arg) => page.evaluate(fn, arg);
const until = (page, fn, arg, timeout = 90_000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });

if (shot === "agent") {
  await record("agent", "http://127.0.0.1:8765/", async (page, { go, mark }) => {
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.waitForTimeout(800);
    await go();
    await page.waitForTimeout(1500);
    mark("ready");
    const box = page.getByLabel("Demande pour l'agent");
    await box.click();
    mark("typing");
    await box.pressSequentially("Achète une Apple Watch Series 10 46 mm au meilleur prix", { delay: 55 });
    await page.waitForTimeout(500);
    await box.press("Enter");
    mark("sent");
    await page.getByText(/Choisit Meridian/).first().waitFor({ timeout: 120_000 });
    mark("chose");
    await page.getByText(/Remplit le formulaire|Tape dans/).first().waitFor({ timeout: 120_000 });
    mark("form");
    await page.getByText("J'ai lancé le paiement, mais il n'est pas passé.").waitFor({ timeout: 180_000 });
    mark("refused");
    await page.getByRole("region", { name: "Vérification SentinelL1" }).waitFor({ timeout: 30_000 });
    mark("card");
    await page.getByRole("region", { name: "Vérification SentinelL1" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(6000);
    mark("end");
  });
}

if (shot === "city") {
  await record("city", "https://city.petroi.fr/?live=0", async (page, { go, mark }) => {
    await until(page, () => !!window.__ag);
    await page.waitForTimeout(11_000); // the city's rise
    await go();
    await page.waitForTimeout(3500);
    mark("wide");
    // 1. the fraud, followed: white out of the tower, the scan, red, the yard, the registry
    await page.keyboard.press("1");
    mark("fraud");
    await until(page, () => window.__ag.sim.get().tx && window.__ag.sim.get().phase !== "idle");
    await page.keyboard.press("f");
    await until(page, () => window.__ag.sim.get().phase === "analysis");
    mark("fraud-scan");
    await until(page, () => window.__ag.motion.paintTo === "block");
    mark("fraud-red");
    await until(page, () => window.__ag.motion.yard > 10.4);
    mark("fraud-yard");
    await until(page, () => window.__ag.sim.get().registry.length === 1);
    mark("fraud-registry");
    await until(page, () => window.__ag.sim.get().phase === "idle");
    mark("fraud-done");
    // 2. the visa: green, through the gate, gone at the C-Chain's tower
    await page.keyboard.press("2");
    mark("legit");
    await until(page, () => window.__ag.sim.get().tx && window.__ag.sim.get().phase !== "idle");
    await page.keyboard.press("f");
    await until(page, () => window.__ag.motion.paintTo === "allow");
    mark("legit-green");
    await until(page, () => window.__ag.motion.leg === "toCChain");
    mark("legit-road");
    await until(page, () => !window.__ag.motion.visible);
    mark("legit-gone");
    await until(page, () => window.__ag.sim.get().phase === "idle");
    // 3. the doubt: orange, parked, a human validates
    await page.keyboard.press("3");
    mark("doubt");
    await until(page, () => window.__ag.sim.get().tx && window.__ag.sim.get().phase !== "idle");
    await page.keyboard.press("f");
    await until(page, () => window.__ag.motion.paintTo === "human");
    mark("doubt-orange");
    await until(page, () => !!window.__ag.sim.get().human);
    mark("doubt-parked");
    await page.waitForTimeout(2500);
    const ok = page.getByRole("button", { name: /^(Valider|Approuver)/ }).first();
    if (await ok.isVisible().catch(() => false)) await ok.click();
    else await page.keyboard.press("a");
    mark("doubt-validated");
    await until(page, () => window.__ag.sim.get().phase === "idle");
    // 4. the second agent: the registry refuses it at once
    await page.keyboard.press("4");
    mark("immunity");
    await until(page, () => window.__ag.sim.get().tx && window.__ag.sim.get().phase !== "idle");
    await page.keyboard.press("f");
    await until(page, () => window.__ag.motion.paintTo === "block");
    mark("immunity-red");
    await until(page, () => window.__ag.sim.get().phase === "idle", null, 120_000);
    mark("immunity-done");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(4000);
    mark("end");
  });
}

if (shot === "explorer") {
  await record("explorer", "https://explorer.petroi.fr/", async (page, { go, mark }) => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    await go();
    await page.waitForTimeout(2500);
    mark("home");
    const tx = page.locator('a[href*="/tx/"], a[href*="/transaction"]').first();
    if (await tx.isVisible().catch(() => false)) {
      await tx.hover();
      await page.waitForTimeout(600);
      await tx.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      mark("tx");
      await page.waitForTimeout(5000);
    }
    mark("end");
  }, { scheme: "dark" });
}
