import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { answerHuman, receive, registerScene, resetAll } from '@/sim/Director';
import { sim } from '@/sim/store';
import { verdictToTx, type AgenticPaymentVerdict } from '@/sim/adapters/verdictToTx';
import VERDICTS from '@/sim/sceneVerdicts.json';

// A live car held for a human: the city's Valider / Refuser settles it on the guard that holds it (the sandbox's
// /api/decide, which then writes SentinelL1), and an answer given in the sandbox's chat moves the parked car on.

const until = async (cond: () => boolean, ms = 20000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const SANDBOX = 'https://sandbox.test';
const held = (id: string) => verdictToTx({ ...(VERDICTS.doubt as unknown as AgenticPaymentVerdict), instruction_id: id }, { decide_url: SANDBOX });
const settled = (id: string, verdict: 'allow' | 'block') =>
  verdictToTx({ ...(VERDICTS.doubt as unknown as AgenticPaymentVerdict), instruction_id: id, verdict, approved_by: 'humain (interface de la sandbox)' });
const outcome = (id: string) => sim.get().journal.find((j) => j.tx_id === held(id).tx_id)?.outcome;

describe('the human post on a live car', () => {
  const calls: { url: string; body: unknown }[] = [];
  beforeAll(() => {
    (globalThis as { window?: unknown }).window ??= { setTimeout, clearTimeout, location: { search: '' } };
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ verdict: 'allow', onchain: { ok: true } }), { status: 200 });
    });
    gsap.globalTimeline.timeScale(40);
    registerScene({ fly: () => {}, home: () => {}, flashTower: () => {}, shake: () => {}, still: () => false });
    resetAll();
  });
  afterAll(() => {
    gsap.globalTimeline.timeScale(1);
    vi.unstubAllGlobals();
  });

  it("sends the operator's answer to the guard that holds the payment", async () => {
    expect(held('0x01').decide_url).toBe(SANDBOX);
    receive(held('0x01'));
    await until(() => !!sim.get().human);
    answerHuman(true);
    await until(() => outcome('0x01') === 'ALLOW');
    expect(calls).toEqual([{ url: `${SANDBOX}/api/decide`, body: { instruction_id: '0x01', decision: 'allow' } }]);
    // the settled verdict the guard then sends on is the same car: no second one
    receive(settled('0x01', 'allow'));
    expect(sim.get().queue).toEqual([]);
  });

  it("moves the parked car on when a human answered in the sandbox's chat, without calling the guard again", async () => {
    calls.length = 0;
    await until(() => sim.get().phase === 'idle');
    receive(held('0x02'));
    await until(() => !!sim.get().human);
    receive(settled('0x02', 'block'));
    await until(() => outcome('0x02') === 'BLOCK');
    expect(calls).toEqual([]);
    expect(sim.get().review?.by).toMatch(/chat de la sandbox/);
  });

  it('a car without a sandbox behind it (a demo scene) never calls anyone', () => {
    expect(verdictToTx(VERDICTS.doubt as unknown as AgenticPaymentVerdict).decide_url).toBeUndefined();
    expect(verdictToTx(VERDICTS.fraud as unknown as AgenticPaymentVerdict, { decide_url: SANDBOX }).decide_url).toBeUndefined();
  });
});
