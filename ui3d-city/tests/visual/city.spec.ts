import { expect, test, type Page } from "@playwright/test";

/* Three captures of the demo, saved under docs/captures: the city at home, the toll during the fraud's analysis, and
   the scrapyard as the press comes down. Each also checks what the page must show. */

type Ag = { sim: { get: () => { phase: string; step: number; registry: string[]; kpi: { blocked: number } } }; motion: { press: number; leg: string } };
const ag = (page: Page) => page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.sim.get());

async function open(page: Page) {
  await page.goto("/");
  await page.locator("canvas").first().waitFor();
  await page.waitForFunction(() => !!(window as unknown as { __ag?: Ag }).__ag);
  // the city's rise and the first bake
  await page.waitForTimeout(10_000);
}

test("home: the city, its Security ward, the figures and the licence's mention", async ({ page }) => {
  await open(page);
  await expect(page.getByText("City 3D d'après le code open source Avalanche Builder Hub (BSD-3) · Concept AvaGuard+ · simulation")).toBeVisible();
  await expect(page.getByText("Concept AvaGuard+ · simulation").first()).toBeVisible();
  await expect(page.getByText("SECURITY", { exact: false }).first()).toBeVisible();
  await expect(page.getByPlaceholder("Rechercher une transaction, une adresse, un agent…")).toBeVisible();
  await page.screenshot({ path: "docs/captures/home.jpg", quality: 85, type: "jpeg" });
});

test("toll: the fraud's contract with its risky line framed", async ({ page }) => {
  await open(page);
  await page.keyboard.press("1");
  await page.waitForFunction(() => {
    const s = (window as unknown as { __ag: Ag }).__ag.sim.get();
    return s.phase === "analysis" && s.step >= 3;
  }, null, { timeout: 30_000 });
  await expect(page.getByText("RISQUE", { exact: true })).toBeVisible();
  await expect(page.getByText("AvaGuard · Analyse", { exact: false }).first()).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "docs/captures/toll.jpg", quality: 85, type: "jpeg" });
});

test("scrapyard: the press comes down, the address joins the registry", async ({ page }) => {
  await open(page);
  await page.keyboard.press("1");
  await page.waitForFunction(() => (window as unknown as { __ag: Ag }).__ag.motion.press > 0.6, null, { timeout: 60_000, polling: 50 });
  await page.screenshot({ path: "docs/captures/scrapyard.jpg", quality: 85, type: "jpeg" });
  await page.waitForFunction(() => (window as unknown as { __ag: Ag }).__ag.sim.get().registry.length === 1, null, { timeout: 30_000 });
  const s = await ag(page);
  expect(s.kpi.blocked).toBe(1);
});
