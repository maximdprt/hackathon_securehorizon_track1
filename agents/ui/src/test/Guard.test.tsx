import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { applyEvent, type AgentMessage } from '../run';
import type { RunEvent, Site, Verdict, World } from '../types';

// Le garde dans l'interface : l'interrupteur, le verdict avec le détail du score, et la décision d'un humain.
const MERIDIAN: Site = { key: 'meridian', name: 'Meridian Watch Co.', domain: 'meridian-watch.example', kind: 'fraud', why: 'Boutique fantôme.', preview: '/shop/meridian/' };
const NIMBUS: Site = { key: 'nimbus', name: 'Nimbus Store', domain: 'store.nimbus.example', kind: 'legit', why: 'Marchand connu.', preview: '/shop/nimbus/' };
const world = (guard: string | null): World => ({
  sites: [NIMBUS, MERIDIAN], models: { 'm.pixtral': 'Pixtral Large' }, default_model: 'm.pixtral', guard,
  profile: { name: 'Camille Martin', city: 'Lyon', card: '•••• •••• •••• 4242' },
});
const ORDER = { issuer: '0xA11ce', action: 'pay', amount: 389, currency: 'EUR', recipient: '0x3E21' };
const BLOCK: Verdict = {
  verdict: 'block', trust_score: 35, risk_score: 0.65, severity: 3, owasp: ['ASI03'], onchain_flagged: false, instruction_id: '0xabc', latency_ms: 61.4, backend: 'mcp',
  thresholds: { allow_at_or_above: 80, block_below: 40 }, notes: ['amount is 130% of the cap: thresholds tightened to 0.2/0.6'],
  deductions: [
    { id: 'domain_age_days', layer: 'counterparty', cost: 50, hard: false, evidence: 'domain registered 9.0 days ago' },
    { id: 'new_merchant_first_payment', layer: 'counterparty', cost: 15.5, hard: false, evidence: 'first payment to a merchant whose domain is 9 days old' },
    { id: 'amount_within_mandate', layer: 'mandate', cost: 0, hard: false, evidence: 'amount 389.0 exceeds mandate cap 300' },
    { id: 'signal_sans_libelle', layer: 'tools', cost: 0, hard: true, evidence: '' },
  ],
};
const PENDING: Verdict = { ...BLOCK, verdict: 'needs_approval', trust_score: 100, severity: 2, instruction_id: '0xdef', deductions: [BLOCK.deductions[2]] };

function end(outcome: 'blocked' | 'needs_approval', verdict: Verdict, site: Site): RunEvent[] {
  return [
    { type: 'pay', site: site.key, order: ORDER, items: ['Apple Watch Series 10 46 mm'], submitted: {} },
    { type: 'end', outcome, order: ORDER, chosen: site.name, why: 'prix le plus bas', considered: [], submitted: {}, confirmation: null, expected: 'block', final_text: '',
      turns: 8, site, request: { order: ORDER, task: 'x' }, verdict },
  ];
}

function server(w: World, events: RunEvent[], decideStatus = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/world') return new Response(JSON.stringify(w));
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    if (url === '/api/decide') return new Response(JSON.stringify(decideStatus === 200 ? { verdict: 'allow' } : { error: 'KeyError: no pending decision' }), { status: decideStatus });
    return new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }));
  return calls;
}

const ready = () => screen.findByRole('heading', { level: 1, name: 'Chasseur de prix' });
const ask = () => userEvent.type(screen.getByLabelText("Demande pour l'agent"), 'Achète une montre{Enter}');
const guardSwitch = () => screen.getByRole('checkbox', { name: /Garde/ });

test('a refused payment shows the verdict, the trust score against its thresholds, and each deduction with its evidence', async () => {
  const calls = server(world('mcp'), end('blocked', BLOCK, MERIDIAN));
  render(<App />);
  await ready();
  expect(guardSwitch()).toBeChecked();
  await ask();
  expect(await screen.findByText("Le paiement n'est pas parti : le garde l'a refusé.")).toBeInTheDocument();
  expect(calls[0].body).toMatchObject({ guard: true });

  const card = within(screen.getByRole('region', { name: 'Verdict du garde' }));
  expect(card.getByText('Paiement refusé')).toBeInTheDocument();
  expect(card.getByText('35')).toBeInTheDocument();
  expect(card.getByRole('img', { name: 'Confiance 35 sur 100' })).toBeInTheDocument();
  expect(card.getByText('Refusé à 40 ou moins · validé au-dessus de 80 · entre les deux, un humain décide')).toBeInTheDocument();
  expect(card.getByText(/par le serveur MCP · 61 ms/)).toBeInTheDocument();
  // le détail : départ à 100, puis chaque retrait dit en français, avec la preuve du garde
  const lines = within(card.getByRole('list', { name: 'Détail du score' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(lines).toEqual([
    'Départ100',
    'Domaine du marchand très récentdomain registered 9.0 days ago−50',
    'Premier paiement à un marchand récentfirst payment to a merchant whose domain is 9 days old−15,5',
    'Montant au-dessus du plafond du mandatamount 389.0 exceeds mandate cap 300règle',
    'signal sans libellerefus direct',
  ]);
  expect(card.queryByRole('button')).toBeNull(); // un refus ne se discute pas dans l'interface
  // le bac à sable dit si le garde a eu raison
  expect(screen.getByText('Boutique frauduleuse')).toBeInTheDocument();
  expect(screen.getByText('Requête envoyée au garde (verify_payment)')).toBeInTheDocument();
});

test('a payment held for a human is settled from the thread and the decision goes to the guard', async () => {
  const calls = server(world('mcp'), end('needs_approval', PENDING, NIMBUS));
  render(<App />);
  await ready();
  await ask();
  const card = within(await screen.findByRole('region', { name: 'Verdict du garde' }));
  expect(card.getByText('Validation humaine requise')).toBeInTheDocument();
  expect(screen.getByText('Boutique légitime')).toBeInTheDocument();
  await userEvent.click(card.getByRole('button', { name: 'Approuver' }));
  expect(await card.findByText(/Approuvé par un humain/)).toBeInTheDocument();
  expect(calls[1]).toEqual({ url: '/api/decide', body: { instruction_id: '0xdef', decision: 'allow' } });
  expect(card.queryByRole('button')).toBeNull(); // tranché une fois
});

test('refusing a held payment and reporting a fraud are two different decisions', async () => {
  for (const [button, decision, told] of [
    ['Refuser', 'decline', /rien n'est retenu contre le marchand/],
    ['Signaler une fraude', 'block', /Fraude signalée par un humain/],
  ] as const) {
    const calls = server(world('mcp'), end('needs_approval', PENDING, NIMBUS));
    const { unmount } = render(<App />);
    await ready();
    await ask();
    const card = within(await screen.findByRole('region', { name: 'Verdict du garde' }));
    await userEvent.click(card.getByRole('button', { name: button }));
    expect(await card.findByText(told)).toBeInTheDocument();
    expect(calls[1].body).toEqual({ instruction_id: '0xdef', decision });
    unmount();
  }
});

test('a decision the guard cannot record is reported and can be tried again', async () => {
  server(world('mcp'), end('needs_approval', PENDING, NIMBUS), 409);
  render(<App />);
  await ready();
  await ask();
  const card = within(await screen.findByRole('region', { name: 'Verdict du garde' }));
  await userEvent.click(card.getByRole('button', { name: 'Refuser' }));
  expect(await card.findByText(/La décision n'a pas pu être enregistrée : KeyError: no pending decision/)).toBeInTheDocument();
  expect(card.getByRole('button', { name: 'Refuser' })).toBeEnabled();
});

test('the guard can be switched off for a run, and is shown as unavailable when the server has none', async () => {
  const calls = server(world('mcp'), end('blocked', BLOCK, MERIDIAN));
  const { unmount } = render(<App />);
  await ready();
  expect(screen.getByText('Garde activé : chaque paiement est vérifié')).toBeInTheDocument();
  await userEvent.click(guardSwitch());
  expect(screen.getByText('Garde coupé : le paiement part sans vérification')).toBeInTheDocument();
  await ask();
  await screen.findByRole('region', { name: 'Verdict du garde' });
  expect(calls[0].body).toMatchObject({ guard: false });
  unmount();

  server(world(null), []);
  render(<App />);
  await ready();
  expect(guardSwitch()).toBeDisabled();
  expect(guardSwitch()).not.toBeChecked();
  expect(screen.getByText('Garde indisponible sur ce serveur')).toBeInTheDocument();
});

test('the finance agent shows that the transaction is checked before it leaves', () => {
  const start: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', mode: 'finance', prompt: 'p', status: 'running', steps: [], frames: [] };
  const checked = applyEvent(start, { type: 'guard', status: 'checking' }, () => undefined);
  expect(checked.steps.map((s) => s.label)).toEqual(['La transaction est vérifiée avant de partir']);
  expect(applyEvent(checked, { type: 'verdict', verdict: 'block' }, () => undefined)).toBe(checked); // porté par l'événement final
});
