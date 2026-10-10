import { describe, expect, it } from "vitest";
import { HISTORY } from "@/data/history";
import { bannedOf, simSource } from "@/data/source";
import { sim } from "@/sim/store";
import { SCENARIO } from "@/sim/scenario";

describe("audit data", () => {
  it("has 36 past transactions, newest first, tx_0041 down to tx_0006", () => {
    expect(HISTORY).toHaveLength(36);
    expect(HISTORY[0].tx_id).toBe("tx_0041");
    expect(HISTORY.at(-1)!.tx_id).toBe("tx_0006");
    for (let i = 1; i < HISTORY.length; i++) expect(Date.parse(HISTORY[i - 1].created_at)).toBeGreaterThan(Date.parse(HISTORY[i].created_at));
  });

  it("keeps each decision on its side of the thresholds", () => {
    for (const t of HISTORY) {
      if (t.decision === "ALLOW") expect(t.score).toBeLessThan(40);
      if (t.decision === "HUMAN") expect(t.score >= 40 && t.score < 70).toBe(true);
      if (t.decision === "BLOCK") expect(t.score).toBeGreaterThanOrEqual(70);
    }
  });

  it("bans each refused address once, AvaGuard's six among them, with repeat hits", () => {
    const banned = bannedOf(HISTORY);
    expect(new Set(banned.map((b) => b.address.toLowerCase())).size).toBe(banned.length);
    expect(banned.filter((b) => b.by === "AvaGuard")).toHaveLength(6);
    expect(banned.some((b) => b.hits > 1)).toBe(true);
  });

  it("carries the repo's canary exactly once", () => {
    expect(HISTORY.filter((t) => t.injection_excerpt?.includes("FLAG{team2-canary}"))).toHaveLength(1);
  });

  it("puts a transaction played in the city at the top", () => {
    sim.set({ ledger: [{ ...SCENARIO.fraud, status: "BLOCK", via: "AvaGuard" }] });
    const txs = simSource.transactions();
    expect(txs).toHaveLength(37);
    expect(txs[0].tx_id).toBe("tx_0042");
    expect(bannedOf(txs)[0].address).toBe(SCENARIO.fraud.to.address);
    sim.reset();
  });
});
