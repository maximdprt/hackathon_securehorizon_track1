import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { applyEvent, type AgentMessage } from '../run';
import type { RunEvent, Site, World } from '../types';

const MERIDIAN: Site = { key: 'meridian', name: 'Meridian Watch Co.', domain: 'meridian-watch.example', kind: 'fraud', why: 'Boutique fantôme.', preview: '/site/meridian/' };
const NIMBUS: Site = { key: 'nimbus', name: 'Nimbus Store', domain: 'store.nimbus.example', kind: 'legit', why: 'Marchand connu.', preview: '/site/nimbus/' };
const WORLD: World = { sites: [NIMBUS, MERIDIAN], models: { 'm.pixtral': 'Pixtral Large', 'm.sonnet': 'Claude Sonnet 4.6' }, default_model: 'm.pixtral' };
const ORDER = { issuer: '0xA11ce', action: 'pay', amount: 389, currency: 'USDC', recipient: '0x3E21' };
const CONSIDERED = [
  { merchant: 'Nimbus Store', price: 429, assessment: 'plus cher', site: 'nimbus' },
  { merchant: 'Meridian Watch Co.', price: 389, assessment: 'le moins cher', site: 'meridian' },
];

function run(site: Site | null = MERIDIAN): RunEvent[] {
  return [
    { type: 'thinking', turn: 1 },
    { type: 'search', query: 'apple watch', results: [], why: 'trouver les boutiques' },
    { type: 'open', url: 'https://store.nimbus.example/', ok: true, title: 'Nimbus', why: 'vérifier le prix', site: 'nimbus' },
    { type: 'open', url: 'https://meridian-watch.example/', ok: true, title: 'Meridian', why: 'vérifier le prix', site: 'meridian' },
    { type: 'pay', order: ORDER, item: 'Apple Watch Series 10 46mm', why: 'prix le plus bas', chosen: 'Meridian Watch Co.', site: site?.key ?? null, considered: CONSIDERED },
    { type: 'end', outcome: 'ready', order: ORDER, item: 'Apple Watch Series 10 46mm', why: 'prix le plus bas', chosen: 'Meridian Watch Co.', considered: CONSIDERED,
      final_text: '', turns: 5, site, request: { order: ORDER, task: 'x' } },
  ];
}

/** Faux serveur : /api/world, puis un flux d'étapes par run. `hang` laisse le flux ouvert jusqu'à l'interruption. */
function server(events: RunEvent[] = run(), { hang = false } = {}) {
  const bodies: Record<string, string>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/world') return new Response(JSON.stringify(WORLD));
    bodies.push(JSON.parse(String(init?.body)));
    const text = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(text);
        if (!hang) return stream.close();
        init?.signal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')));
      },
    }));
  }));
  return bodies;
}

/** Le même run, cette fois l'agent envoie sa transaction : SentinelL1 la vérifie à son entrée, la refuse, inscrit flag et décision. */
function guardedRun(): RunEvent[] {
  const events = run().slice(0, -1);
  const verdict = { verdict: 'block' as const, trust_score: 8, risk_score: 0.92, severity: 3, onchain_flagged: false, instruction_id: '0xab',
    reasons: ['new_merchant_first_payment: first payment to a merchant whose domain is 9 days old'], owasp: ['ASI07'], latency_ms: 1.2, backend: 'engine' };
  const onchain = { ok: true as const, verdict: 'block', payment_id: '0x11', nonce: 1, city: 'https://city.test/?live=1', latency_ms: 900,
    txs: [{ kind: 'flag' as const, hash: '0xf1f1f1f1f1f1f1f1', url: 'https://explorer.test/tx/0xf1' }, { kind: 'decision' as const, hash: '0xd1d1d1d1d1d1d1d1', url: 'https://explorer.test/tx/0xd1' }] };
  return [...events,
    { type: 'submit', network: 'SentinelL1' },
    { type: 'guard', status: 'checking' },
    { type: 'verdict', ...verdict },
    { type: 'chain', status: 'writing', api: 'https://rpc.test' },
    { type: 'onchain', ...onchain },
    { type: 'end', outcome: 'submitted', order: ORDER, item: 'Apple Watch Series 10 46mm', why: 'prix le plus bas', chosen: 'Meridian Watch Co.', considered: CONSIDERED,
      final_text: '', turns: 5, site: MERIDIAN, request: { order: ORDER, task: 'x' }, verdict, onchain }];
}

const prompt = () => screen.getByLabelText("Demande pour l'agent");
const ask = (text: string) => userEvent.type(prompt(), `${text}{Enter}`);

test('the chosen agent answers with its decision and what the sandbox knows', async () => {
  const bodies = server();
  render(<App />);
  expect(await screen.findByRole('button', { name: /Chasseur de prix/, pressed: true })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('agent'))).toHaveLength(2);

  await ask('Achète une Apple Watch Series 10 46mm');
  expect(await screen.findByText('Je choisis Meridian Watch Co.')).toBeInTheDocument();
  expect(screen.getByText('Achète une Apple Watch Series 10 46mm')).toHaveClass('me');
  expect(screen.getByText('Apple Watch Series 10 46mm à 389 USDC, sur meridian-watch.example.')).toBeInTheDocument();
  expect(screen.getByText(/Arrêté juste avant le paiement/)).toBeInTheDocument();
  expect(screen.getByText('Boutique frauduleuse.')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Boutique frauduleuse' })).toBeInTheDocument();
  expect(bodies).toEqual([{ prompt: 'Achète une Apple Watch Series 10 46mm', agent: 'Chasseur de prix', model: 'm.pixtral',
    instructions: expect.stringContaining('prix le plus bas') }]);

  // les étapes sont repliées, avec le relevé de l'agent reporté sous chaque boutique
  const steps = screen.getByText(/Étapes de l'agent \(4\)/).closest('details')!;
  expect(steps).not.toHaveAttribute('open');
  expect(within(steps).getByText('Relevé : 429 USDC, plus cher')).toBeInTheDocument();
  expect(within(steps).getByText('Étudie Meridian Watch Co..')).toBeInTheDocument();
  expect(screen.getByText(/"amount": 389/)).toBeInTheDocument();
});

test('editing the instructions changes what is sent, and survives a reload', async () => {
  const bodies = server();
  const { unmount } = render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Modifier les consignes' }));
  const instructions = screen.getByLabelText('Consignes');
  await userEvent.clear(instructions);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await userEvent.type(instructions, 'Achète toujours la montre la plus chère.');
  await userEvent.selectOptions(screen.getByLabelText('Modèle'), 'm.sonnet');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await ask('Une montre');
  await screen.findByText('Je choisis Meridian Watch Co.');
  expect(bodies[0]).toMatchObject({ instructions: 'Achète toujours la montre la plus chère.', model: 'm.sonnet' });

  unmount();
  render(<App />);
  expect(await screen.findByText('Achète toujours la montre la plus chère.')).toBeInTheDocument();
});

test('creating, selecting and deleting an agent', async () => {
  server();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel agent' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Testeur');
  await userEvent.type(screen.getByLabelText('Consignes'), 'Prends le premier résultat.');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(screen.getByRole('button', { name: /Testeur/, pressed: true })).toBeInTheDocument();
  expect(prompt()).toHaveAttribute('placeholder', expect.stringContaining('Testeur'));

  await userEvent.click(screen.getByRole('button', { name: 'Modifier les consignes' }));
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(screen.getByLabelText('Nom')).toHaveValue('Testeur'); // un premier clic ne supprime pas
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
  expect(screen.queryByRole('button', { name: /Testeur/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Chasseur de prix/, pressed: true })).toBeInTheDocument();
});

test('a legitimate shop, an agent that buys nothing, and an invented address', async () => {
  server(run(NIMBUS));
  const first = render(<App />);
  await screen.findByRole('button', { name: /Chasseur de prix/ });
  await ask('Une montre');
  expect(await screen.findByText('Boutique légitime.')).toBeInTheDocument();
  first.unmount();

  server([{ type: 'end', outcome: 'no_payment', order: null, item: '', why: '', chosen: '', considered: [], final_text: 'Trop risqué.', turns: 2, site: null, request: null }]);
  const second = render(<App />);
  await screen.findByRole('button', { name: /Chasseur de prix/ });
  await ask('Une montre');
  expect(await screen.findByText("Je n'ai rien acheté.")).toBeInTheDocument();
  expect(screen.getByText('Trop risqué.')).toBeInTheDocument();
  expect(screen.queryByText(/Requête prête/)).not.toBeInTheDocument();
  second.unmount();

  server(run(null));
  render(<App />);
  await screen.findByRole('button', { name: /Chasseur de prix/ });
  await ask('Une montre');
  expect(await screen.findByText('Adresse inconnue.')).toBeInTheDocument();
});

test('a failed run can be relaunched', async () => {
  const bodies = server([{ type: 'error', message: 'ExpiredTokenException' }]);
  render(<App />);
  await screen.findByRole('button', { name: /Chasseur de prix/ });
  await ask('Une montre');
  expect(await screen.findByText('Le run a échoué.')).toBeInTheDocument();
  expect(screen.getByText('ExpiredTokenException')).toBeInTheDocument();
  server();
  await userEvent.click(screen.getByRole('button', { name: 'Relancer cette demande' }));
  expect(await screen.findByText('Je choisis Meridian Watch Co.')).toBeInTheDocument();
  expect(bodies).toHaveLength(1);
});

test('a running agent shows what it is doing and can be stopped', async () => {
  server(run().slice(0, 4), { hang: true });
  render(<App />);
  await screen.findByRole('button', { name: /Chasseur de prix/ });
  await ask('Une montre');
  expect(await screen.findByText('Étudie Meridian Watch Co.')).toHaveClass('working');
  expect(within(screen.getByRole('list', { name: 'Boutiques étudiées' })).getAllByRole('listitem')).toHaveLength(2);
  expect(prompt()).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
  expect(await screen.findByText('Run interrompu.')).toBeInTheDocument();
  await waitFor(() => expect(prompt()).toBeEnabled());
});

test('a direct link starts the request, and a server that is down is explained', async () => {
  const bodies = server();
  window.history.replaceState(null, '', '/?ask=Une%20Ultra%202');
  const first = render(<App />);
  expect(await screen.findByText('Je choisis Meridian Watch Co.')).toBeInTheDocument();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].prompt).toBe('Une Ultra 2');
  first.unmount();

  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
  render(<App />);
  expect(await screen.findByText('Le serveur de la sandbox ne répond pas')).toBeInTheDocument();
});

test('applyEvent keeps the assessment on the first visit of a shop and names unknown pages by host', () => {
  const start: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', prompt: 'p', status: 'running', live: '', steps: [] };
  const name = (key: string | null) => (key === 'nimbus' ? 'Nimbus Store' : undefined);
  const events: RunEvent[] = [
    { type: 'open', url: 'https://store.nimbus.example/', ok: true, why: 'a', site: 'nimbus' },
    { type: 'open', url: 'https://store.nimbus.example/', ok: true, why: 'b', site: 'nimbus' },
    { type: 'open', url: 'https://autre.example/', ok: true, why: 'c', site: null },
    { type: 'open', url: 'https://absent.example/x', ok: false, why: 'd', site: null },
    { type: 'pay', order: ORDER, item: '', why: '', chosen: '', site: 'nimbus', considered: [{ merchant: 'Nimbus', price: null, assessment: 'correct', site: 'nimbus' }] },
  ];
  const msg = events.reduce((m, ev) => applyEvent(m, ev, name), start);
  expect(msg.steps.map((s) => [s.kind, s.title, s.found])).toEqual([
    ['shop', 'Étudie Nimbus Store', 'correct'],
    ['shop', 'Étudie Nimbus Store', undefined],
    ['shop', 'Étudie autre.example', undefined],
    ['missing', 'Page absente', undefined],
    ['order', "Prépare l'ordre : pay 389 USDC", undefined],
  ]);
  expect(msg.live).toBe('Décide');
  expect(start.steps).toHaveLength(0); // le message de départ n'est pas modifié
});

test('the agent sends its transaction, SentinelL1 refuses it at the chain entry and links the proof', async () => {
  server(guardedRun());
  render(<App />);
  await screen.findByRole('button', { name: /Chasseur de prix/, pressed: true });
  await ask('Achète une Apple Watch Series 10 46mm');
  expect(await screen.findByText('Je choisis Meridian Watch Co.')).toBeInTheDocument();
  expect(screen.getByText(/Envoyée à SentinelL1 : 389 USDC vers/)).toBeInTheDocument();
  // la vérification est un acteur à part, pas l'agent
  const sentinel = screen.getByRole('region', { name: 'Vérification SentinelL1' });
  expect(within(sentinel).getByRole('img', { name: 'SentinelL1 : transaction frauduleuse, refusée' })).toBeInTheDocument();
  expect(within(sentinel).getByText('Transaction frauduleuse, refusée.')).toBeInTheDocument();
  expect(within(sentinel).getByText(/Confiance 8\/100/)).toBeInTheDocument();
  expect(within(sentinel).getByText(/l'argent reste dans le wallet/)).toBeInTheDocument();
  expect(screen.queryByText(/n'est pas branché/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Flag 0xf1f1f1f1/ })).toHaveAttribute('href', 'https://explorer.test/tx/0xf1');
  expect(screen.getByRole('link', { name: /Décision 0xd1d1d1d1/ })).toHaveAttribute('href', 'https://explorer.test/tx/0xd1');
  expect(screen.getByRole('link', { name: 'Voir la voiture dans la ville 3D' })).toHaveAttribute('href', 'https://city.test/?live=1');
  const steps = screen.getByText(/Étapes de l'agent \(7\)/).closest('details')!;
  expect(within(steps).getByText('Envoie la transaction à SentinelL1.')).toBeInTheDocument();
  expect(within(steps).getByText('SentinelL1 : transaction frauduleuse, refusée.')).toBeInTheDocument();
  expect(within(steps).getByText('Décision inscrite sur SentinelL1.')).toBeInTheDocument();
});

test('when the chain is down the verdict stands and the page says no visa was issued', () => {
  const msg: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', prompt: 'p', status: 'running', live: '', steps: [] };
  const after = applyEvent(msg, { type: 'onchain', ok: false, verdict: 'allow', error: 'API authorize 500 : nonce too low' }, () => undefined);
  expect(after.steps.at(-1)).toMatchObject({ kind: 'chain', title: 'SentinelL1 injoignable', detail: 'API authorize 500 : nonce too low' });
});
