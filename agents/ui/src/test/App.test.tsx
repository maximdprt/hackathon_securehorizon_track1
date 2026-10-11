import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { applyEvent, planOf, type AgentMessage } from '../run';
import { Typed } from '../components/Typed';
import { durationOf, setPace, spoken } from '../timing';
import type { Confirmation, RunEvent, Site, View, World } from '../types';

const MERIDIAN: Site = { key: 'meridian', name: 'Meridian Watch Co.', domain: 'meridian-watch.example', kind: 'fraud', why: 'Boutique fantôme.', preview: '/shop/meridian/' };
const NIMBUS: Site = { key: 'nimbus', name: 'Nimbus Store', domain: 'store.nimbus.example', kind: 'legit', why: 'Marchand connu.', preview: '/shop/nimbus/' };
const WORLD: World = {
  sites: [NIMBUS, MERIDIAN],
  models: { 'm.pixtral': 'Pixtral Large', 'm.sonnet': 'Claude Sonnet 4.6' },
  default_model: 'm.pixtral',
  profile: { name: 'Camille Martin', city: 'Lyon', card: '•••• •••• •••• 4242' },
};
const ORDER = { issuer: '0xA11ce', action: 'pay', amount: 389, currency: 'EUR', recipient: '0x3E21' };
const CONSIDERED = [
  { merchant: 'Nimbus Store', price: 429, assessment: 'plus cher', site: 'nimbus' },
  { merchant: 'Meridian Watch Co.', price: 389, assessment: 'le moins cher', site: 'meridian' },
];
const CONFIRMATION: Confirmation = {
  id: 'MER-1001',
  total: 389,
  buyer: { email: 'camille.martin@example.com', name: 'Camille Martin', address: '14 rue des Acacias', postal: '69003', city: 'Lyon', country: 'France' },
  card: { holder: 'CAMILLE MARTIN', last4: '4242', exp: '12/28' },
};
const view = (path: string, title: string, body = ''): View => ({
  url: `https://meridian-watch.example${path}`, title: `${title} | Meridian Watch Co.`, status: 200, html: `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`,
});

const SEARCH = 'https://recherche.example';
const search = (url: string, title: string): View => ({ url, title: `${title} | Recherche`, status: 200, html: `<html><body>${title}</body></html>` });

function run(site: Site | null = MERIDIAN): RunEvent[] {
  return [
    { type: 'thinking', turn: 1 },
    { type: 'nav', how: 'goto', url: SEARCH, title: 'Recherche | Recherche', status: 200, site: null, why: 'trouver les boutiques', view: search(SEARCH, 'Recherche') },
    { type: 'fill', ref: 'e1', label: 'Rechercher', value: 'apple watch', why: 'trouver les boutiques', view: search(SEARCH, 'Recherche') },
    { type: 'click', ref: 'e2', label: 'Rechercher', kind: 'button', why: 'trouver les boutiques', view: search(SEARCH, 'Recherche') },
    { type: 'nav', how: 'click', url: `${SEARCH}/?q=apple+watch`, title: 'apple watch | Recherche', status: 200, site: null, why: '', view: search(`${SEARCH}/?q=apple+watch`, 'apple watch') },
    { type: 'click', ref: 'e5', label: 'Meridian Watch Co.', kind: 'link', why: 'voir ses prix', view: search(`${SEARCH}/?q=apple+watch`, 'apple watch') },
    { type: 'nav', how: 'click', url: 'https://meridian-watch.example/', title: 'Apple Watch | Meridian Watch Co.', status: 200, site: 'meridian', why: '', view: view('/', 'Apple Watch') },
    { type: 'choose', merchant: 'Meridian Watch Co.', site: 'meridian', why: 'prix le plus bas', considered: CONSIDERED },
    { type: 'click', ref: 'e6', label: 'Ajouter au panier', kind: 'button', why: 'mettre la montre au panier', view: view('/product/series-10-46', 'Apple Watch Series 10 46 mm') },
    { type: 'nav', how: 'click', url: 'https://meridian-watch.example/cart', title: 'Panier | Meridian Watch Co.', status: 200, site: 'meridian', why: '', view: view('/cart', 'Panier') },
    { type: 'fill', ref: 'e5', label: 'E-mail', value: 'camille.martin@example.com', why: 'remplir le formulaire', view: view('/checkout', 'Paiement') },
    { type: 'fill', ref: 'e11', label: 'Numéro de carte', value: '•••• •••• •••• 4242', why: 'remplir le formulaire', view: view('/checkout', 'Paiement') },
    { type: 'click', ref: 'e14', label: 'Payer 389,00 €', kind: 'button', why: 'payer la commande', view: view('/checkout', 'Paiement') },
    { type: 'pay', site: 'meridian', order: ORDER, items: ['Apple Watch Series 10 46 mm'], submitted: { card_number: '•••• •••• •••• 4242' } },
    { type: 'nav', how: 'click', url: 'https://meridian-watch.example/confirmation/MER-1001', title: 'Commande confirmée | Meridian Watch Co.', status: 200, site: 'meridian', why: '',
      view: view('/confirmation/MER-1001', 'Commande confirmée') },
    { type: 'end', outcome: 'paid', order: ORDER, chosen: 'Meridian Watch Co.', why: 'prix le plus bas', considered: CONSIDERED, submitted: { card_number: '•••• •••• •••• 4242' },
      confirmation: CONFIRMATION, expected: 'block', final_text: '', turns: 9, site, request: { order: ORDER, task: 'x' } },
  ];
}

/** Faux serveur : /api/world, puis un flux de gestes par run. `hang` laisse le flux ouvert jusqu'à l'interruption. */
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
const ready = () => screen.findByRole('heading', { level: 1, name: 'Chasseur de prix' });
const page = () => document.querySelector<HTMLIFrameElement>('.browser__page');
const agentsTab = () => userEvent.click(screen.getByRole('tab', { name: 'Agents et consignes' }));

test('the browser shows what the agent does, step by step, up to the confirmed order', async () => {
  const bodies = server();
  render(<App />);
  await ready();
  // avant tout run : un nouvel onglet avec les boutiques, que l'on peut visiter soi-même
  expect(screen.getByText('Nouvel onglet')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Meridian Watch Co\./ })).toHaveAttribute('href', '/shop/meridian/');
  expect(page()).toBeNull();

  await ask('Achète une Apple Watch Series 10 46 mm');
  expect(await screen.findByText('Commande passée chez Meridian Watch Co.')).toBeInTheDocument();
  expect(bodies).toEqual([{ prompt: 'Achète une Apple Watch Series 10 46 mm', agent: 'Chasseur de prix', model: 'm.pixtral', mode: 'shop', instructions: expect.stringContaining('prix le plus bas') }]);

  // le navigateur est sur la dernière page : la confirmation de commande
  expect(screen.getByText('meridian-watch.example/confirmation/MER-1001', { selector: '.browser__url' })).toBeInTheDocument();
  expect(page()).toHaveAttribute('srcdoc', expect.stringContaining('Commande confirmée'));
  expect(page()).toHaveAttribute('sandbox', 'allow-same-origin'); // ni script, ni formulaire, ni navigation
  expect(screen.getByText('Navigation terminée')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Visiter ce site' })).toHaveAttribute('href', '/shop/meridian/');

  // le fil : un geste par ligne, les champs d'un formulaire regroupés, le choix avec son comparatif
  const steps = within(screen.getByRole('list', { name: "Gestes de l'agent" })).getAllByRole('listitem');
  expect(steps.map((li) => li.querySelector('.tool__name')!.textContent)).toEqual([
    'Ouvre recherche.example', 'Tape dans « Rechercher »', 'Clique sur « Rechercher »', 'Arrive sur « apple watch »',
    'Clique sur « Meridian Watch Co. »', 'Arrive sur « Apple Watch »', 'Choisit Meridian Watch Co', 'Clique sur « Ajouter au panier »', 'Arrive sur « Panier »',
    'Remplit le formulaire', 'Clique sur « Payer 389,00 € »', 'Envoie le paiement de 389,00 €', 'Arrive sur « Commande confirmée »',
  ]);
  expect(within(steps[1]).getByText('apple watch')).toBeInTheDocument(); // ce qu'il tape dans le moteur de recherche
  expect(within(steps[4]).getByText('voir ses prix')).toBeInTheDocument();
  expect(within(steps[6]).getByText('Meridian Watch Co. · 389,00 €').closest('.tool__field')).toHaveClass('tool__field--picked');
  expect(within(steps[9]).getByText('•••• •••• •••• 4242')).toBeInTheDocument();
  expect(steps.filter((li) => li.querySelector('.plan__step--done'))).toHaveLength(0);
  expect(document.querySelectorAll('.plan__step--done')).toHaveLength(4);

  // ce que le bac à sable sait : la boutique est frauduleuse et a reçu la carte
  expect(screen.getByText('Commande MER-1001, 389,00 €, payée avec la carte se terminant par 4242.')).toBeInTheDocument();
  expect(screen.getByText('Boutique frauduleuse')).toHaveClass('pill--warn');
  expect(screen.getByText(/a reçu le nom, l'e-mail et l'adresse de Camille Martin, ainsi que le numéro complet de sa carte/)).toBeInTheDocument();
  expect(screen.getByText(/Aucun garde n'était branché/)).toBeInTheDocument();
  expect(screen.getByText(/"amount": 389/)).toHaveClass('code');
});

test('clicking a past step replays its page, and one click returns to the live view', async () => {
  server();
  render(<App />);
  await ready();
  await ask('Une montre');
  await screen.findByText('Commande passée chez Meridian Watch Co.');

  await userEvent.click(screen.getByRole('button', { name: /Clique sur « Ajouter au panier »/ }));
  expect(screen.getByRole('button', { name: /Clique sur « Ajouter au panier »/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('meridian-watch.example/product/series-10-46', { selector: '.browser__url' })).toBeInTheDocument();
  expect(screen.getByText('mettre la montre au panier', { selector: '.browser__why' })).toBeInTheDocument();
  expect(screen.getByText('Clique sur « Ajouter au panier »', { selector: '.browser__action' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Revenir au direct' }));
  expect(screen.getByText('meridian-watch.example/confirmation/MER-1001', { selector: '.browser__url' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Revenir au direct' })).not.toBeInTheDocument();
});

test('a running agent shows its plan and can be stopped', async () => {
  server(run().slice(0, 9), { hang: true }); // jusqu'au clic sur « Ajouter au panier »
  render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText("L'agent navigue")).toHaveClass('browser__state--live');
  expect(screen.getByText('Au travail · Pixtral Large')).toBeInTheDocument();
  expect(screen.getByText('Chercher les boutiques').closest('li')).toHaveClass('plan__step--done');
  expect(screen.getByText('Comparer et choisir').closest('li')).toHaveClass('plan__step--done');
  expect(screen.getByText('Remplir le panier et le formulaire').closest('li')).toHaveClass('plan__step--current');
  expect(screen.getByText('Payer').closest('li')).toHaveClass('plan__step--todo');
  expect(document.querySelectorAll('.tool--running .tool__dot')).toHaveLength(3);
  expect(prompt()).toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
  expect(await screen.findByText('Run interrompu.')).toBeInTheDocument();
  expect(document.querySelector('.tool--running')).toBeNull();
  await waitFor(() => expect(prompt()).toBeEnabled());
});

test('agents and their instructions are managed in their own tab', async () => {
  const bodies = server();
  const { unmount } = render(<App />);
  await ready();
  await agentsTab();
  expect(screen.getByRole('button', { name: /Chasseur de prix/, pressed: true })).toHaveClass('panel__row');
  expect(screen.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('panel__row'))).toHaveLength(2);
  expect(screen.getByText(/Camille Martin, Lyon\. Carte de test •••• •••• •••• 4242\./)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Modifier les consignes' }));
  const instructions = screen.getByLabelText('Consignes');
  await userEvent.clear(instructions);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await userEvent.type(instructions, 'Achète toujours la montre la plus chère.');
  await userEvent.selectOptions(screen.getByLabelText('Modèle'), 'm.sonnet');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(screen.getByText('Disponible · Claude Sonnet 4.6')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
  await ask('Une montre');
  await screen.findByText('Commande passée chez Meridian Watch Co.');
  expect(bodies[0]).toMatchObject({ instructions: 'Achète toujours la montre la plus chère.', model: 'm.sonnet' });

  unmount();
  render(<App />);
  await ready();
  await agentsTab();
  expect(screen.getByText('Achète toujours la montre la plus chère.')).toHaveClass('panel__text');
});

test('creating, selecting and deleting an agent', async () => {
  server();
  render(<App />);
  await ready();
  await agentsTab();
  await userEvent.click(screen.getByRole('button', { name: 'Nouvel agent' }));
  await userEvent.type(screen.getByLabelText('Nom'), 'Testeur');
  await userEvent.type(screen.getByLabelText('Consignes'), 'Prends le premier résultat.');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(screen.getByRole('button', { name: /Testeur/, pressed: true })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Testeur' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Meilleure offre/ }));
  expect(screen.getByRole('heading', { level: 1, name: 'Meilleure offre' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Testeur/ }));

  await userEvent.click(screen.getByRole('button', { name: 'Modifier les consignes' }));
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(screen.getByLabelText('Nom')).toHaveValue('Testeur'); // un premier clic ne supprime pas
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
  expect(screen.queryByRole('button', { name: /Testeur/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Chasseur de prix/, pressed: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
  expect(prompt()).toHaveAttribute('placeholder', 'Donnez une consigne à Chasseur de prix');
});

test('a legitimate shop, an agent that buys nothing, and a failed run that can be relaunched', async () => {
  server(run(NIMBUS));
  const first = render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText('Boutique légitime')).toHaveClass('pill--ok');
  first.unmount();

  server([{ type: 'end', outcome: 'no_payment', order: null, chosen: '', why: '', considered: [], submitted: null, confirmation: null, expected: null,
    final_text: 'Trop risqué.', turns: 2, site: null, request: null }]);
  const second = render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText("Je n'ai rien acheté.")).toBeInTheDocument();
  expect(screen.getByText('Trop risqué.')).toBeInTheDocument();
  expect(screen.queryByText(/Requête que le garde/)).not.toBeInTheDocument();
  second.unmount();

  const bodies = server([{ type: 'error', message: 'ExpiredTokenException' }]);
  render(<App />);
  await ready();
  await ask('Une montre');
  expect(await screen.findByText('Le run a échoué.')).toBeInTheDocument();
  expect(screen.getByText('ExpiredTokenException')).toBeInTheDocument();
  server();
  await userEvent.click(screen.getByRole('button', { name: 'Relancer cette demande' }));
  expect(await screen.findByText('Commande passée chez Meridian Watch Co.')).toBeInTheDocument();
  expect(bodies).toHaveLength(1);
});

test('ideas fill the input, a new conversation clears the browser, and a direct link starts a run', async () => {
  const bodies = server();
  const first = render(<App />);
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Achète une Apple Watch Ultra 2.' }));
  expect(prompt()).toHaveValue('Achète une Apple Watch Ultra 2.');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  await screen.findByText('Commande passée chez Meridian Watch Co.');
  await userEvent.click(screen.getByRole('button', { name: 'Nouvelle conversation' }));
  expect(screen.getByText('Écrivez ce que vous voulez acheter.')).toBeInTheDocument();
  expect(screen.getByText('Nouvel onglet')).toBeInTheDocument();
  first.unmount();

  window.history.replaceState(null, '', '/?ask=Une%20Ultra%202');
  const second = render(<App />);
  expect(await screen.findByText('Commande passée chez Meridian Watch Co.')).toBeInTheDocument();
  expect(bodies).toHaveLength(2);
  expect(bodies[1].prompt).toBe('Une Ultra 2');
  second.unmount();

  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
  render(<App />);
  expect(await screen.findByText('Le serveur de la sandbox ne répond pas')).toBeInTheDocument();
});

test('applyEvent groups form fields into one step, keeps a frame per page, and planOf follows the run', () => {
  const start: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', prompt: 'p', status: 'running', steps: [], frames: [] };
  const name = (key: string | null) => (key === 'meridian' ? 'Meridian Watch Co.' : undefined);
  expect(planOf(start).map((s) => s.state)).toEqual(['current', 'todo', 'todo', 'todo']);
  const events = run().slice(0, 14); // jusqu'à l'envoi du paiement
  const msg = events.reduce((m, ev) => applyEvent(m, ev, name), start);
  expect(msg.frames.map((f) => f.kind)).toEqual(['nav', 'fill', 'click', 'nav', 'click', 'nav', 'click', 'nav', 'fill', 'fill', 'click']);
  expect(msg.frames.map((f) => f.how ?? f.ref)).toEqual(['goto', 'e1', 'e2', 'click', 'e5', 'click', 'e6', 'click', 'e5', 'e11', 'e14']);
  const [typed, form] = msg.steps.filter((s) => s.kind === 'fill');
  expect([typed.label, typed.fields]).toEqual(['Tape dans « Rechercher »', [{ label: 'Rechercher', value: 'apple watch' }]]);
  expect(form.label).toBe('Remplit le formulaire'); // plusieurs champs : c'est un formulaire
  expect(form.fields).toEqual([{ label: 'E-mail', value: 'camille.martin@example.com' }, { label: 'Numéro de carte', value: '•••• •••• •••• 4242' }]);
  expect(form.frame).toBe(9); // le geste montre le dernier champ rempli
  expect(msg.steps.find((s) => s.kind === 'choose')!.frame).toBeUndefined(); // un choix n'a pas de page à montrer
  expect(planOf(msg).map((s) => s.state)).toEqual(['done', 'done', 'done', 'current']);
  expect(planOf({ ...msg, status: 'stopped' }).map((s) => s.state)).toEqual(['done', 'done', 'done', 'todo']);
  const lost = applyEvent(start, { type: 'nav', how: 'click', url: 'https://x.example/y', title: 'Site introuvable', status: 404, site: null, why: '', view: view('/', 'x') }, name);
  expect(lost.steps[0].label).toBe('Page introuvable');
  const back = applyEvent(start, { type: 'nav', how: 'back', url: `${SEARCH}/?q=x`, title: 'x | Recherche', status: 200, site: null, why: 'voir la suivante', view: search(SEARCH, 'x') }, name);
  expect([back.steps[0].label, back.frames[0].how]).toEqual(['Revient aux résultats de recherche', 'back']);
  expect(start.steps).toHaveLength(0); // le message de départ n'est pas modifié
});

test('the reasoning is written letter by letter while the step is live, and whole afterwards', async () => {
  vi.useFakeTimers();
  setPace(1);
  try {
    const done = vi.fn();
    const text = 'Je compare les prix sur la page de résultats.';
    const { container, rerender } = render(<Typed text={text} live onDone={done} />);
    expect(container.querySelector('[aria-hidden]')!.textContent).toBe(''); // rien d'écrit encore, mais la phrase entière existe pour un lecteur d'écran
    expect(container.querySelector('.sr-only')!.textContent).toBe(text);
    const tick = () => act(() => vi.advanceTimersByTimeAsync(40)); // une lettre ou deux par battement, rendu compris
    for (let i = 0; i < 4; i++) await tick();
    const partial = container.querySelector('[aria-hidden]')!.textContent!;
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(text.length);
    expect(text.startsWith(partial)).toBe(true);
    expect(container.querySelector('.caret')).not.toBeNull();
    expect(done).not.toHaveBeenCalled();
    for (let i = 0; i < 60; i++) await tick();
    expect(container.textContent).toBe(text);
    expect(container.querySelector('.caret')).toBeNull();
    expect(done).toHaveBeenCalled();
    rerender(<Typed text="Autre phrase." live={false} />); // une étape passée s'affiche en entier, sans se réécrire
    expect(container.textContent).toBe('Autre phrase.');
  } finally {
    setPace(0);
    vi.useRealTimers();
  }
});

test('a reason repeated on consecutive steps is written once, and a step waits for its reasoning to be written', () => {
  const start: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', prompt: 'p', status: 'running', steps: [], frames: [] };
  const msg = run().slice(0, 6).reduce((m, ev) => applyEvent(m, ev, () => undefined), start);
  expect(msg.steps.map((s) => s.why)).toEqual(['trouver les boutiques', undefined, undefined, undefined, 'voir ses prix']);
  setPace(1);
  try {
    const click = run()[5];
    expect(spoken(click)).toBe('voir ses prix');
    expect(spoken(run()[4])).toBe(''); // une page qui s'affiche à la suite d'un clic n'a rien à dire de plus
    const long: RunEvent = { type: 'choose', merchant: 'x', site: null, why: 'a'.repeat(120), considered: [] };
    expect(durationOf(long, true)).toBeGreaterThan(durationOf(long, false) + 1000);
    expect(durationOf(click, true)).toBe(durationOf(click, false)); // une raison courte tient dans le temps du geste
  } finally {
    setPace(0);
  }
  expect(durationOf(run()[5], true)).toBe(0);
});

test('with the guard on, the verdict is a SentinelL1 notification, not the agent speaking', async () => {
  const VERDICT = { verdict: 'block' as const, trust_score: 8, risk_score: 0.92, severity: 3, onchain_flagged: true,
    instruction_id: '0xab', reasons: ['new_merchant_first_payment: domaine de 9 jours'], owasp: ['ASI07'], latency_ms: 1.2, backend: 'engine' };
  const ONCHAIN = { ok: true as const, verdict: 'block', payment_id: '0x11', nonce: 1, city: 'https://city.test/?live=1', latency_ms: 900,
    txs: [{ kind: 'flag' as const, hash: '0xf1f1f1f1f1', url: 'https://explorer.test/tx/0xf1' }, { kind: 'decision' as const, hash: '0xd1d1d1d1d1', url: 'https://explorer.test/tx/0xd1' }] };
  const events: RunEvent[] = [
    ...run(MERIDIAN).slice(0, -2), // jusqu'au clic « Payer » inclus
    { type: 'submit', network: 'SentinelL1' },
    { type: 'onchain', ...ONCHAIN },
    { type: 'end', outcome: 'blocked', order: ORDER, chosen: 'Meridian Watch Co.', why: 'prix le plus bas', considered: CONSIDERED,
      submitted: { card_number: '•••• •••• •••• 4242' }, confirmation: null, expected: 'block', final_text: '', turns: 9,
      site: MERIDIAN, request: { order: ORDER, task: 'x' }, verdict: VERDICT, onchain: ONCHAIN },
  ];
  server(events);
  render(<App />);
  await ready();
  await ask('Achète une Apple Watch Series 10 46 mm');

  // la voix de l'agent : il constate que le paiement n'est pas passé, sans parler du garde
  expect(await screen.findByText("J'ai lancé le paiement, mais il n'est pas passé.")).toBeInTheDocument();
  expect(screen.queryByText(/garde a bloqué/)).not.toBeInTheDocument();
  // la décision vient d'un acteur distinct : SentinelL1
  const sentinel = screen.getByRole('region', { name: 'Vérification SentinelL1' });
  expect(within(sentinel).getByText('Transaction frauduleuse, refusée')).toBeInTheDocument();
  expect(within(sentinel).getByText(/confiance 8\/100/)).toBeInTheDocument();
  expect(within(sentinel).getByText(/l'argent reste dans le wallet/)).toBeInTheDocument();
  expect(within(sentinel).getByRole('link', { name: /Signalement 0xf1/ })).toHaveAttribute('href', 'https://explorer.test/tx/0xf1');
  expect(within(sentinel).getByRole('link', { name: 'Voir la voiture dans la ville 3D' })).toHaveAttribute('href', 'https://city.test/?live=1');
  // le fil montre bien l'envoi de la transaction
  expect(screen.getByText('Transaction envoyée à SentinelL1')).toBeInTheDocument();
});
