import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { applyEvent, planOf, type AgentMessage } from '../run';
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
    { type: 'search', query: 'apple watch', results: [{ title: 'a', url: 'u', snippet: 's' }, { title: 'b', url: 'u', snippet: 's' }], why: 'trouver les boutiques' },
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

const prompt = () => screen.getByLabelText("Demande pour l'agent");
const ask = (text: string) => userEvent.type(prompt(), `${text}{Enter}`);
const ready = () => screen.findByRole('button', { name: /Chasseur de prix/ });

test('the chosen agent answers with its decision and what the sandbox knows', async () => {
  const bodies = server();
  render(<App />);
  expect(await screen.findByRole('button', { name: /Chasseur de prix/, pressed: true })).toHaveClass('panel__row');
  expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2);
  expect(screen.getByRole('heading', { level: 1, name: 'Chasseur de prix' })).toBeInTheDocument();
  expect(screen.getByText('Disponible · Pixtral Large')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();

  await ask('Achète une Apple Watch Series 10 46mm');
  expect(await screen.findByText('Je choisis Meridian Watch Co.')).toBeInTheDocument();
  expect(screen.getByText('Achète une Apple Watch Series 10 46mm')).toHaveClass('chat__msg--user');
  expect(screen.getByText('Apple Watch Series 10 46mm à 389 USDC, sur meridian-watch.example.')).toBeInTheDocument();
  expect(screen.getByText('prix le plus bas')).toBeInTheDocument();
  expect(screen.getByText('Boutique frauduleuse')).toHaveClass('pill--warn');
  expect(screen.getByText('Boutique fantôme.')).toBeInTheDocument();
  expect(screen.getByText(/Arrêté juste avant le paiement/)).toBeInTheDocument();
  expect(bodies).toEqual([{ prompt: 'Achète une Apple Watch Series 10 46mm', agent: 'Chasseur de prix', model: 'm.pixtral',
    instructions: expect.stringContaining('prix le plus bas') }]);

  // le détail est replié : le plan terminé, une ligne par action, le relevé de l'agent sous chaque boutique
  const detail = screen.getByText('Détail du run (4 actions)').closest('details')!;
  expect(detail).not.toHaveAttribute('open');
  expect(within(detail).getAllByRole('listitem').filter((li) => li.classList.contains('plan__step--done'))).toHaveLength(3);
  const lines = within(within(detail).getByRole('list', { name: "Actions de l'agent" })).getAllByRole('listitem');
  expect(lines.map((li) => li.querySelector('.tool__name')!.textContent)).toEqual(['Recherche web', 'Nimbus Store', 'Meridian Watch Co.', 'Ordre de paiement']);
  expect(within(lines[0]).getByText('« apple watch » · 2 boutiques trouvées')).toBeInTheDocument();
  expect(within(lines[1]).getByText('Relevé : 429 USDC, plus cher')).toBeInTheDocument();
  expect(within(lines[3]).getByText('Prêt, non envoyé')).toBeInTheDocument();
  expect(screen.getByText(/"amount": 389/)).toHaveClass('code');
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
  expect(screen.getByText('Disponible · Claude Sonnet 4.6')).toBeInTheDocument();

  await ask('Une montre');
  await screen.findByText('Je choisis Meridian Watch Co.');
  expect(bodies[0]).toMatchObject({ instructions: 'Achète toujours la montre la plus chère.', model: 'm.sonnet' });

  unmount();
  render(<App />);
  expect(await screen.findByText('Achète toujours la montre la plus chère.')).toHaveClass('panel__text');
});

test('creating, selecting and deleting an agent', async () => {
  server();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Nouvel agent' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Testeur');
  await userEvent.type(screen.getByLabelText('Consignes'), 'Prends le premier résultat.');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(screen.getByRole('button', { name: /Testeur/, pressed: true })).toBeInTheDocument();
  expect(prompt()).toHaveAttribute('placeholder', 'Donnez une consigne à Testeur');

  await userEvent.click(screen.getByRole('button', { name: /Meilleure offre/ }));
  expect(screen.getByRole('heading', { level: 1, name: 'Meilleure offre' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Testeur/ }));

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
  await ready();
  await ask('Une montre');
  expect(await screen.findByText('Boutique légitime')).toHaveClass('pill--ok');
  first.unmount();

  server([{ type: 'end', outcome: 'no_payment', order: null, item: '', why: '', chosen: '', considered: [], final_text: 'Trop risqué.', turns: 2, site: null, request: null }]);
  const second = render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText("Je n'ai rien acheté.")).toBeInTheDocument();
  expect(screen.getByText('Trop risqué.')).toBeInTheDocument();
  expect(screen.queryByText(/Requête prête/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Détail du run/)).not.toBeInTheDocument();
  second.unmount();

  server(run(null));
  render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText('Adresse inconnue')).toHaveClass('pill--warn');
});

test('a failed run can be relaunched', async () => {
  const bodies = server([{ type: 'error', message: 'ExpiredTokenException' }]);
  render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText('Le run a échoué.')).toBeInTheDocument();
  expect(screen.getByText('ExpiredTokenException')).toBeInTheDocument();
  server();
  await userEvent.click(screen.getByRole('button', { name: 'Relancer cette demande' }));
  expect(await screen.findByText('Je choisis Meridian Watch Co.')).toBeInTheDocument();
  expect(bodies).toHaveLength(1);
});

test('a running agent shows its plan and tool lines, and can be stopped', async () => {
  server(run().slice(0, 4), { hang: true });
  render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText("J'étudie Meridian Watch Co.")).toBeInTheDocument();
  expect(screen.getByText('Au travail · Pixtral Large')).toBeInTheDocument();
  expect(screen.getByText('Chercher les boutiques').closest('li')).toHaveClass('plan__step--done');
  expect(screen.getByText('Étudier et comparer les boutiques').closest('li')).toHaveClass('plan__step--current');
  expect(screen.getByText("Préparer l'ordre de paiement").closest('li')).toHaveClass('plan__step--todo');
  const lines = within(screen.getByRole('list', { name: "Actions de l'agent" })).getAllByRole('listitem');
  expect(lines).toHaveLength(4); // recherche, deux boutiques, puis la ligne en cours
  expect(lines[3]).toHaveClass('tool--running');
  expect(lines[3].querySelectorAll('.tool__dot')).toHaveLength(3);
  expect(prompt()).toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
  expect(await screen.findByText('Run interrompu.')).toBeInTheDocument();
  expect(document.querySelector('.tool--running')).toBeNull();
  await waitFor(() => expect(prompt()).toBeEnabled());
});

test('ideas fill the input, and the menu starts a new conversation', async () => {
  server();
  render(<App />);
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Achète une Apple Watch Ultra 2.' }));
  expect(prompt()).toHaveValue('Achète une Apple Watch Ultra 2.');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  await screen.findByText('Je choisis Meridian Watch Co.');
  expect(screen.queryByRole('button', { name: 'Achète une Apple Watch Ultra 2.' })).not.toBeInTheDocument();

  const more = screen.getByRole('button', { name: "Plus d'options" });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(more);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Nouvelle conversation' }));
  expect(screen.queryByText('Je choisis Meridian Watch Co.')).not.toBeInTheDocument();
  expect(screen.getByText('Écrivez ce que vous voulez acheter.')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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

test('applyEvent keeps the assessment on the first visit of a shop, and planOf follows the run', () => {
  const start: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', prompt: 'p', status: 'running', live: '', steps: [] };
  const name = (key: string | null) => (key === 'nimbus' ? 'Nimbus Store' : undefined);
  expect(planOf(start).map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
  const events: RunEvent[] = [
    { type: 'open', url: 'https://store.nimbus.example/', ok: true, why: 'a', site: 'nimbus' },
    { type: 'open', url: 'https://store.nimbus.example/', ok: true, why: 'b', site: 'nimbus' },
    { type: 'open', url: 'https://autre.example/', ok: true, why: 'c', site: null },
    { type: 'open', url: 'https://absent.example/x', ok: false, why: 'd', site: null },
    { type: 'pay', order: ORDER, item: '', why: '', chosen: '', site: 'nimbus', considered: [{ merchant: 'Nimbus', price: null, assessment: 'correct', site: 'nimbus' }] },
  ];
  const msg = events.reduce((m, ev) => applyEvent(m, ev, name), start);
  expect(msg.steps.map((s) => [s.kind, s.name, s.meta, s.found])).toEqual([
    ['shop', 'Nimbus Store', 'store.nimbus.example', 'correct'],
    ['shop', 'Nimbus Store', 'store.nimbus.example', undefined],
    ['shop', 'autre.example', 'autre.example', undefined],
    ['missing', 'Page absente', 'absent.example/x', undefined],
    ['order', 'Ordre de paiement', 'pay 389 USDC vers 0x3E21', undefined],
  ]);
  expect(planOf(msg).map((s) => s.state)).toEqual(['done', 'done', 'current']);
  expect(planOf({ ...msg, status: 'stopped' }).map((s) => s.state)).toEqual(['done', 'done', 'todo']); // rien "en cours" une fois arrêté
  expect(start.steps).toHaveLength(0); // le message de départ n'est pas modifié
});
