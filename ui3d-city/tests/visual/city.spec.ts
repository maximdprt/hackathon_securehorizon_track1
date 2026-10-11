import { expect, test, type Page } from "@playwright/test";

/* Three captures of the demo, saved under docs/captures: the city at home, the gantry during the fraud's analysis (the
   car a hologram, the card's radiography and checks), and the yard as the baler crushes the red car. Each also checks
   what the page must show (the Sentinel protocol, Sentinel Protocole Pub.html). */

type Ag = { sim: { get: () => { phase: string; step: number; registry: string[]; kpi: { blocked: number } } }; motion: { yard: number; xray: number; paintTo: string; leg: string } };
const ag = (page: Page) => page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.sim.get());

async function open(page: Page) {
  await page.goto("/?live=0");
  await page.locator("canvas").first().waitFor();
  await page.waitForFunction(() => !!(window as unknown as { __ag?: Ag }).__ag);
  // the city's rise and the first bake
  await page.waitForTimeout(10_000);
}

test("home: the city, its Security ward, the figures, the key and the licence's mention", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Ville 3D d'après Avalanche Builder Hub (open source, BSD-3)", { exact: false })).toBeVisible();
  // the two ends of the protocol, named on the city: our L1's ward and the C-Chain's plaza
  await expect(page.getByRole("button", { name: /Sentinel L1/ }).first()).toBeVisible();
  await expect(page.getByText(/C-Chain · où l'argent arrive/).first()).toBeVisible();
  // the rest of the network stands round the protocol: the key counts it
  await expect(page.getByText(/autres L1 d'Avalanche Fuji/).first()).toBeVisible();
  await expect(page.getByPlaceholder("Rechercher un paiement, une adresse, un agent…")).toBeVisible();
  for (const label of ["Paiements", "Fraudes", "Escrocs", "Preuves"]) await expect(page.getByRole("button", { name: new RegExp(`^${label}`) }).or(page.getByRole("link", { name: new RegExp(`^${label}`) })).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Facture piégée" })).toBeVisible();
  await page.screenshot({ path: "docs/captures/home.jpg", quality: 85, type: "jpeg" });
});

test("toll: the car a hologram under the gantry, the card's radiography and its checks lighting one by one", async ({ page }) => {
  await open(page);
  await page.keyboard.press("1");
  await page.waitForFunction(() => {
    const a = (window as unknown as { __ag: Ag }).__ag;
    const s = a.sim.get();
    return s.phase === "analysis" && s.step >= 3 && a.motion.xray === 1;
  }, null, { timeout: 30_000 });
  await expect(page.getByText("Sentinel · Analyse", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Radiographie du paiement" }).or(page.getByLabel("Radiographie du paiement")).first()).toBeVisible();
  // still white: the colour comes with the decision only
  expect(await page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.motion.paintTo)).toBe("white");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/captures/toll.jpg", quality: 85, type: "jpeg" });
  // the decision paints it red, the card says BLOCK
  await page.waitForFunction(() => (window as unknown as { __ag: Ag }).__ag.motion.paintTo === "block", null, { timeout: 20_000 });
  await expect(page.getByText("BLOCK", { exact: true }).first()).toBeVisible();
});

test("scrapyard: the red car crushed in the baler, the address joins the registry", async ({ page }) => {
  await open(page);
  await page.keyboard.press("1");
  // the yard's clock (components/guard-yard/three/timeline.ts): the lids, the side ram and the end ram from 13.9 to 16.7
  await page.waitForFunction(() => (window as unknown as { __ag: Ag }).__ag.motion.yard > 15.4, null, { timeout: 60_000, polling: 50 });
  expect(await page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.motion.paintTo)).toBe("block");
  await page.screenshot({ path: "docs/captures/scrapyard.jpg", quality: 85, type: "jpeg" });
  await page.waitForFunction(() => (window as unknown as { __ag: Ag }).__ag.sim.get().registry.length === 1, null, { timeout: 30_000 });
  const s = await ag(page);
  expect(s.kpi.blocked).toBe(1);
});

test("C-Chain: the green car goes through the gate whole, on to the C-Chain's tower, and is gone as it meets it", async ({ page }) => {
  type Geo = { carL: number; F: { x: number; z: number }; gate: { p: { x: number; z: number } }; legs: { toCChain: { pts: { x: number; z: number }[]; cum: number[]; len: number } } };
  type M = { leg: string; u: number; visible: boolean };
  await open(page);
  await page.keyboard.press("2");
  await page.waitForFunction(() => (window as unknown as { __ag: Ag }).__ag.motion.leg === "toCChain", null, { timeout: 30_000 });
  // the car's nose, past the gate's plane (along F, toward the hub), while it is still drawn whole
  const past = () =>
    page.evaluate(() => {
      const w = window as unknown as { __ag: { motion: M }; __carClip: { geo: Geo } };
      const { geo } = w.__carClip;
      const m = w.__ag.motion;
      const path = geo.legs.toCChain;
      const s = Math.min(1, Math.max(0, m.u)) * path.len;
      let i = 1;
      while (i < path.pts.length - 1 && path.cum[i] < s) i++;
      const p = path.pts[i];
      const along = (q: { x: number; z: number }) => q.x * geo.F.x + q.z * geo.F.z;
      return { past: along(p) - along(geo.gate.p) > geo.carL, visible: m.visible, leg: m.leg, u: m.u };
    });
  await expect.poll(async () => (await past()).past, { timeout: 20_000, intervals: [50] }).toBe(true);
  const through = await past();
  expect(through.visible, "still there once past the gate").toBe(true);
  // it drives on to the tower: the leg runs to its end before the car is gone
  await page.waitForFunction(() => (window as unknown as { __ag: { motion: M } }).__ag.motion.u > 0.97, null, { timeout: 20_000, polling: 16 });
  await page.screenshot({ path: "docs/captures/cchain.jpg", quality: 85, type: "jpeg" });
  await page.waitForFunction(() => !(window as unknown as { __ag: { motion: M } }).__ag.motion.visible, null, { timeout: 20_000 });
});
