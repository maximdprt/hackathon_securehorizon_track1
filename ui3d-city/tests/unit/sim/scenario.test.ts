import { describe, expect, it } from 'vitest';
import { SCENARIO } from '@/sim/scenario';
import VERDICTS from '@/sim/sceneVerdicts.json';

// The four demo scenes show what the real guard decided for them (redteam/city_scenes.py writes sceneVerdicts.json
// from the MCP server; its --check, run by the Python tests, fails when the guard and this file drift apart).

const DECISION = { allow: 'ALLOW', needs_approval: 'HUMAN', block: 'BLOCK' } as const;

describe('the demo scenes', () => {
  it.each(Object.keys(SCENARIO) as (keyof typeof SCENARIO)[])('%s carries the guard verdict, not a scripted one', (k) => {
    const v = VERDICTS[k];
    const s = SCENARIO[k];
    expect(s.decision).toBe(DECISION[v.verdict as keyof typeof DECISION]);
    expect(s.score).toBe(Math.round(v.risk_score * 100));
    expect(s.trust).toBe(v.trust_score);
    // the same transaction as the one judged: who pays whom, how much
    expect([s.from.address.toLowerCase(), s.to.address.toLowerCase(), s.amount.value]).toEqual([v.issuer.toLowerCase(), v.recipient.toLowerCase(), v.amount]);
    expect(s.signals?.map((g) => g.id)).toEqual(v.signals.map((g) => g.id));
  });

  it('tells the story the guard tells: a fraud, a visa, a human, and the registry refusing the second agent', () => {
    expect([SCENARIO.fraud, SCENARIO.legit, SCENARIO.doubt, SCENARIO.immunity].map((s) => s.decision)).toEqual(['BLOCK', 'ALLOW', 'HUMAN', 'BLOCK']);
    expect(VERDICTS.fraud.signals.find((g) => g.id === 'imperative_to_agent')?.hard).toBe(true);
    expect(VERDICTS.immunity.signals.find((g) => g.id === 'recipient_flagged_onchain')?.hard).toBe(true);
    expect(SCENARIO.immunity.to.address).toBe(SCENARIO.fraud.to.address);
  });
});
