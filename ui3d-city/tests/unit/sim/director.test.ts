import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import gsap from 'gsap';
import { answerHuman, playScene, registerScene, resetAll } from '@/sim/Director';
import { sim } from '@/sim/store';

// The four demo transactions each reach the right final state (section 10). GSAP runs 40x faster here.

const until = async (cond: () => boolean, ms = 20000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const entry = (id: string) => sim.get().journal.find((j) => j.tx_id === id);

describe('the Director', () => {
  beforeAll(() => {
    (globalThis as { window?: unknown }).window ??= { setTimeout, clearTimeout, location: { search: '' } };
    gsap.globalTimeline.timeScale(40);
    registerScene({ fly: () => {}, home: () => {}, flashTower: () => {}, shake: () => {}, still: () => false });
    resetAll();
  });
  afterAll(() => {
    gsap.globalTimeline.timeScale(1);
  });

  it('blocks the fraud, adds its address to the registry and protects 4 800 USDC', async () => {
    playScene('fraud');
    await until(() => entry('tx_0042')?.outcome === 'BLOCK');
    expect(sim.get().registry).toContain('0xbad1c0de5e1f0a9b8c7d6e5f4a3b2c1d0e9f7e3a');
    expect(sim.get().kpi.protectedUsd).toBe(4800);
    expect(sim.get().blocks.at(-1)?.tone).toBe('block');
  });

  it('gives the legitimate payment its visa', async () => {
    playScene('legit');
    await until(() => entry('tx_0043')?.outcome === 'ALLOW');
    expect(entry('tx_0043')?.via).toBe('AvaGuard');
  });

  it('parks the doubtful one until a human approves it', async () => {
    playScene('doubt');
    await until(() => sim.get().human?.tx_id === 'tx_0044');
    expect(entry('tx_0044')?.outcome).toBe('PENDING');
    answerHuman(true);
    await until(() => entry('tx_0044')?.outcome === 'ALLOW');
    expect(entry('tx_0044')?.via).toBe('humain');
  });

  it('refuses the second agent at once: the address is already in the registry', async () => {
    playScene('immunity');
    await until(() => entry('tx_0045')?.outcome === 'BLOCK');
    expect(entry('tx_0045')?.via).toBe('registre');
    expect(sim.get().kpi).toMatchObject({ transactions: 4, visas: 2, blocked: 2, protectedUsd: 7700 });
  });
});
