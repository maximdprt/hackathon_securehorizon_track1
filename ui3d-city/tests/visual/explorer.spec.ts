import { expect, test, type Page } from "@playwright/test";

/* The explorer's test panel (explorer/frontend/src/lib/components/SimPanel.svelte) POSTs a verdict to /authorize; the
   API writes it on SentinelL1 and relays { verdict, context, proof } on /avaguard/events, which the city plays as a car.
   Here the city receives the panel's three messages as the stream relays them, without touching the chain: each one
   must drive its car to its place, the visa to the C-Chain, the doubt to the car park, the fraud to the scrapyard. */

type Sim = { phase: string; human: { tx_id: string } | null; registry: string[]; ledger: { tx_id: string; status: string }[]; tx: { tx_id: string } | null };
type Ag = { sim: { get: () => Sim }; motion: { leg: string }; enqueue: (t: unknown) => void; parseMessage: (d: unknown) => unknown; answerHuman: (a: boolean) => void; resetAll: () => void };

const ISSUER = "0xaF11630142CF1f829B87c586C0a6C980B61A855d";
const proof = (n: string) => ({ payment_id: `0x${n.padStart(64, "0")}`, decision_tx: `0x${"d".repeat(63)}${n.slice(-1)}` });
// the panel's presets, as /avaguard/events relays them (api/server.py _publish)
const MESSAGES = {
  allow: {
    verdict: { instruction_id: "0xa112345", issuer: ISSUER, action: "pay", amount: 12, currency: "USDC", recipient: "0x0Fa3e5c7d9b1a3c5e7f9b1d3a5c7e9f1b3d58c12", verdict: "allow", risk_score: 0.08, reasons: ["service connu, enregistré ERC-8004", "montant dans le mandat"], owasp: [], authority_check: { authorized: true, within_limit: true }, poison_check: { is_poisoned: false } },
    context: { issuer_label: "agent-meteo-02", recipient_label: "SaaS Vendor" },
    proof: proof("a1"),
  },
  human: {
    verdict: { instruction_id: "0xb012345", issuer: ISSUER, action: "pay", amount: 640, currency: "USDC", recipient: "0xC0ffee5e7a9b1c3d5e7f9a1b3c5d7e9f1a3b9d07", verdict: "needs_approval", risk_score: 0.55, reasons: ["domaine récent", "hors habitude"], owasp: ["ASI07"], authority_check: { authorized: true, within_limit: true }, poison_check: { is_poisoned: false, confidence: 0.4 } },
    context: { issuer_label: "agent-achat-03", recipient_label: "boutique-neuve.example" },
    proof: proof("b0"),
  },
  block: {
    verdict: { instruction_id: "0xde12345", issuer: ISSUER, action: "pay", amount: 4800, currency: "USDC", recipient: "0x00000000000000000000000000000000DeaDBeef", verdict: "block", risk_score: 0.92, reasons: ["directive injectée dans la source", "adresse inconnue"], owasp: ["ASI03", "ASI07"], authority_check: { authorized: false, within_limit: false }, poison_check: { is_poisoned: true, confidence: 0.97 }, onchain_flagged: true },
    context: { issuer_label: "agent-compta-07", recipient_label: "Faux marchand" },
    proof: proof("de"),
  },
};

const ag = (page: Page) => page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.sim.get());
async function open(page: Page) {
  // ?live=0: the test feeds the messages itself, the real stream stays out of it
  await page.goto("/?live=0");
  await page.locator("canvas").first().waitFor();
  await page.waitForFunction(() => !!(window as unknown as { __ag?: Ag }).__ag);
  await page.waitForTimeout(8_000);
}
async function send(page: Page, message: unknown) {
  await page.evaluate((m) => {
    const a = (window as unknown as { __ag: Ag }).__ag;
    const tx = a.parseMessage(m);
    if (!tx) throw new Error("the city did not read the message");
    a.enqueue(tx);
  }, message);
}
const legOf = (page: Page) => page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.motion.leg);

test("explorer ALLOW: the visa drives to the C-Chain", async ({ page }) => {
  await open(page);
  await send(page, MESSAGES.allow);
  await expect.poll(() => legOf(page), { timeout: 30_000 }).toBe("toCChain");
  await expect.poll(async () => (await ag(page)).ledger[0]?.status, { timeout: 30_000 }).toBe("ALLOW");
});

test("explorer DOUTE: the car parks and waits for a human, who approves it", async ({ page }) => {
  await open(page);
  await send(page, MESSAGES.human);
  await expect.poll(async () => (await ag(page)).human?.tx_id ?? null, { timeout: 40_000 }).not.toBeNull();
  await expect.poll(() => legOf(page), { timeout: 10_000 }).toBe("toParking");
  await expect(page.getByRole("button", { name: /Valider/ })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __ag: Ag }).__ag.answerHuman(true));
  await expect.poll(() => legOf(page), { timeout: 30_000 }).toMatch(/parkToCChain|toCChain/);
  await expect.poll(async () => (await ag(page)).ledger[0]?.status, { timeout: 40_000 }).toBe("ALLOW");
});

test("explorer FRAUDE: the car goes to the scrapyard, its address to the registry", async ({ page }) => {
  await open(page);
  await send(page, MESSAGES.block);
  await expect.poll(() => legOf(page), { timeout: 40_000 }).toBe("toScrapyard");
  await expect.poll(async () => (await ag(page)).registry.map((a) => a.toLowerCase()), { timeout: 40_000 }).toContain("0x00000000000000000000000000000000deadbeef");
  await expect.poll(async () => (await ag(page)).ledger[0]?.status, { timeout: 40_000 }).toBe("BLOCK");
});
