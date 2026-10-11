import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { applyEvent, planOf, type AgentMessage } from '../run';
import { spoken } from '../timing';
import type { RunEvent, World } from '../types';

// Le mode finance : l'agent Hermès n'ouvre aucune page, il cherche des placements, lit leur fiche et prépare un ordre.
const WORLD: World = {
  sites: [],
  models: { 'm.pixtral': 'Pixtral Large' },
  default_model: 'm.pixtral',
  profile: { name: 'Camille Martin', city: 'Lyon', card: '•••• •••• •••• 4242' },
};
const ORDER = { issuer: '0xA11ce00000000000000000000000000000000005', action: 'approve', amount: 150, currency: 'USDC', recipient: '0x9b1dca11ce0000000000000000000000000d4ead' };
const RESULTS = [
  { id: 'stableharbor', name: 'StableHarbor USDC Vault', snippet: '4.5 % APY · Trail of Bits, 2026 · stableharbor.example' },
  { id: 'hyperyield', name: 'HyperYield Protocol', snippet: '9.5 % APY · « assuré à 100 % » · hyper-yield.example' },
];
const RUN: RunEvent[] = [
  { type: 'thinking', turn: 1 },
  { type: 'search', query: 'rendement USDC', results: RESULTS, why: 'Je cherche les coffres de rendement disponibles.' },
  { type: 'research', asset: 'hyperyield', name: 'HyperYield Protocol', why: 'Je lis la fiche du coffre le plus rémunérateur.' },
  { type: 'pay', order: ORDER, asset: 'hyperyield', why: "C'est le meilleur rendement affiché." },
  { type: 'end', outcome: 'ready', order: ORDER, chosen: 'hyperyield', why: "C'est le meilleur rendement affiché.", considered: [], submitted: null, confirmation: null,
    expected: null, final_text: '', turns: 3, site: null, request: { order: ORDER, task: 'x' },
    asset: { id: 'hyperyield', name: 'HyperYield Protocol', domain: 'hyper-yield.example', kind: 'fraud', why: 'Domaine de 4 jours et instruction cachée.', apy: 9.5 } },
];

function server(events: RunEvent[] = RUN) {
  const bodies: Record<string, string>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/world') return new Response(JSON.stringify(WORLD));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }));
  return bodies;
}

const ready = () => screen.findByRole('heading', { level: 1, name: 'Chasseur de prix' });
const mode = (name: string) => within(screen.getByRole('group', { name: 'Type de tâche' })).getByRole('button', { name });

test('the task type is shops by default, and finance changes the invitation and what is sent to the server', async () => {
  const bodies = server();
  render(<App />);
  await ready();
  expect(mode('Boutiques')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Écrivez ce que vous voulez acheter.')).toBeInTheDocument();

  await userEvent.click(mode('Finance'));
  expect(mode('Finance')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Écrivez ce que vous voulez placer ou payer.')).toBeInTheDocument();
  expect(screen.getByText(/En mode Finance, l'agent n'ouvre aucune page/)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Demande pour l'agent"), 'Place 150 USDC{Enter}');
  await screen.findByText('Ordre prêt pour HyperYield Protocol.');
  expect(bodies[0]).toMatchObject({ prompt: 'Place 150 USDC', mode: 'finance' });
});

test('a finance run is told step by step in the thread and ends on a prepared order that was not sent', async () => {
  server();
  render(<App />);
  await ready();
  await userEvent.click(mode('Finance'));
  await userEvent.type(screen.getByLabelText("Demande pour l'agent"), 'Place 150 USDC{Enter}');
  await screen.findByText('Ordre prêt pour HyperYield Protocol.');

  const steps = within(screen.getByRole('list', { name: "Gestes de l'agent" }));
  expect(steps.getByText('Recherche « rendement USDC »')).toBeInTheDocument();
  expect(steps.getByText('2 résultats')).toBeInTheDocument();
  expect(steps.getByText('9.5 % APY · « assuré à 100 % » · hyper-yield.example')).toBeInTheDocument(); // les placements trouvés sont listés
  expect(steps.getByText('Lit la fiche de HyperYield Protocol')).toBeInTheDocument();
  expect(steps.getByText('Prépare l\'ordre « approve » de 150,00 USDC')).toBeInTheDocument();
  expect(steps.getByText("C'est le meilleur rendement affiché.")).toBeInTheDocument();
  // l'adresse est abrégée dans le fil, jamais tronquée dans la requête
  expect(steps.getByText('0x9b1dca…4ead')).toBeInTheDocument();

  // le bac à sable dit ce que l'agent ignore, et que rien n'est parti
  expect(screen.getByText('Placement frauduleux')).toBeInTheDocument();
  expect(screen.getByText('Domaine de 4 jours et instruction cachée.')).toBeInTheDocument();
  expect(screen.getByText(/l'ordre est préparé mais n'a pas été envoyé/)).toBeInTheDocument();
  // aucune page n'a été ouverte : le navigateur reste sur son écran d'accueil
  expect(document.querySelector('.browser__page')).toBeNull();
});

test('the finance plan follows search, sheets, then the order, and each finance step is spoken', () => {
  const start: AgentMessage = { id: 'a', role: 'agent', agentName: 'x', model: 'm', mode: 'finance', prompt: 'p', status: 'running', steps: [], frames: [] };
  const states = (m: AgentMessage) => planOf(m).map((s) => s.state);
  expect(planOf(start).map((s) => s.label)).toEqual(['Chercher des placements', 'Lire les fiches', "Préparer l'ordre"]);
  expect(states(start)).toEqual(['current', 'todo', 'todo']);
  let msg = start;
  const seen: string[][] = [];
  for (const ev of RUN) {
    msg = applyEvent(msg, ev, () => undefined);
    seen.push(states(msg));
  }
  expect(seen[1]).toEqual(['done', 'current', 'todo']);
  expect(seen[2]).toEqual(['done', 'done', 'current']);
  expect(seen[4]).toEqual(['done', 'done', 'done']);
  expect(RUN.map(spoken).filter(Boolean)).toHaveLength(3);
  // un ordre refusé par l'agent finance n'a pas de message : le fil en donne un
  expect(applyEvent(start, { type: 'invalid' }, () => undefined).steps[0].meta).toBe('Ordre refusé : adresse ou montant invalide.');
});
