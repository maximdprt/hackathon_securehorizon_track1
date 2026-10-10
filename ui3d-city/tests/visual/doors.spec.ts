import { expect, test, type Page } from "@playwright/test";

/* Every building is a door: a click on it opens its screen over the city, Escape brings the city back. The doors'
   places on screen come from the page's own test handle (city3d/AvaGuardRun.tsx window.__doorAt). */

type W = { __doorAt?: (k: string) => [number, number] | null; __ag?: { sim: { get: () => { view: string | null; viewFilter: string } } } };

async function open(page: Page) {
  await page.goto("/");
  await page.locator("canvas").first().waitFor();
  await page.waitForFunction(() => !!(window as unknown as W).__doorAt?.("hub"));
  await page.waitForTimeout(9_000);
}

async function knock(page: Page, door: string) {
  const at = await page.evaluate((k) => (window as unknown as W).__doorAt!(k), door);
  expect(at, `${door} on screen`).not.toBeNull();
  await page.mouse.move(at![0], at![1]);
  await page.waitForTimeout(250);
  await page.mouse.click(at![0], at![1]);
  await page.waitForTimeout(700);
  return page.evaluate(() => (window as unknown as W).__ag!.sim.get());
}

const DOORS: { door: string; view: string; filter?: string; heading: RegExp }[] = [
  { door: "hub", view: "transactions", heading: /Transactions · C-Chain/ },
  { door: "registry", view: "registry", heading: /Registre des hackers · Sentinel L1/ },
  { door: "parking", view: "parking", heading: /Validation humaine/ },
  { door: "scrapyard", view: "transactions", filter: "BLOCK", heading: /Transactions · C-Chain/ },
  { door: "proof", view: "transactions", filter: "proof", heading: /Transactions · C-Chain/ },
  { door: "hq", view: "audit", heading: /Audit · Sentinel L1/ },
];

test("each building opens its screen, Escape returns to the city", async ({ page }) => {
  await open(page);
  for (const d of DOORS) {
    const s = await knock(page, d.door);
    expect(s.view, d.door).toBe(d.view);
    if (d.filter) expect(s.viewFilter, d.door).toBe(d.filter);
    await expect(page.getByRole("heading", { name: d.heading })).toBeVisible();
    await page.screenshot({ path: `docs/captures/door-${d.door}.jpg`, quality: 80, type: "jpeg" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as W).__ag!.sim.get().view)).toBeNull();
    await page.waitForTimeout(1_200);
  }
});
