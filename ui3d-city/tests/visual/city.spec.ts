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
  await expect(page.getByText("SECURITY", { exact: false }).first()).toBeVisible();
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
