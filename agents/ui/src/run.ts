import type { Considered, EndEvent, Mode, RunEvent, View } from './types';

/** Une image du navigateur de l'agent : la page à un instant du run. */
export type Frame = View & {
  id: number;
  /** nav : une page chargée. click, fill : un geste joué sur la page déjà affichée. */
  kind: 'nav' | 'click' | 'fill';
  /** Pour une page chargée : par une adresse tapée, à la suite d'un clic, ou en revenant en arrière. */
  how?: 'search' | 'goto' | 'click' | 'back';
  /** Le repère de l'élément cliqué ou rempli. */
  ref?: string;
};

/** Un geste de l'agent dans le fil : on peut cliquer dessus pour revoir la page à ce moment-là. */
export type Step = {
  id: number;
  kind: 'search' | 'research' | 'open' | 'click' | 'page' | 'fill' | 'choose' | 'pay' | 'guard' | 'invalid' | 'thought';
  label: string;
  meta?: string;
  why?: string;
  /** L'image du navigateur à montrer pour ce geste. */
  frame?: number;
  fields?: { label: string; value: string }[];
  considered?: Considered[];
  /** En mode finance : les placements trouvés par une recherche. */
  results?: { name: string; snippet: string }[];
  site?: string | null;
};

export type UserMessage = { id: string; role: 'user'; text: string };
export type AgentMessage = {
  id: string;
  role: 'agent';
  agentName: string;
  model: string;
  /** Absent : boutiques. */
  mode?: Mode;
  prompt: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  steps: Step[];
  frames: Frame[];
  end?: EndEvent;
  error?: string;
  /** La décision d'un humain sur un paiement que le garde a mis en attente. */
  human?: { state: 'sending' | 'done' | 'error'; decision: 'allow' | 'decline' | 'block'; error?: string };
};
export type Message = UserMessage | AgentMessage;

export const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
export const amount = (n: number) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Une adresse de wallet abrégée : le début et la fin suffisent à la reconnaître. */
export const short = (address: string) => (address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address);
const pageName = (title: string) => title.split(' | ')[0];

/** Applique un geste reçu du serveur à la réponse de l'agent. Fonction pure : elle rend un nouveau message. */
export function applyEvent(msg: AgentMessage, ev: RunEvent, shopName: (key: string | null) => string | undefined): AgentMessage {
  const frames: Frame[] =
    ev.type === 'nav'
      ? [...msg.frames, { ...ev.view, id: msg.frames.length, kind: 'nav', how: ev.how }]
      : ev.type === 'click' || ev.type === 'fill'
        ? [...msg.frames, { ...ev.view, id: msg.frames.length, kind: ev.type, ref: ev.ref }]
        : msg.frames;
  const frame = 'view' in ev ? frames.length - 1 : undefined;
  const said = [...msg.steps].reverse().find((s) => s.why)?.why;
  const add = (step: Omit<Step, 'id'>): AgentMessage => ({
    ...msg,
    frames,
    // l'agent redit parfois la même raison pour plusieurs gestes d'affilée : elle n'est écrite qu'une fois
    steps: [...msg.steps, { ...step, why: step.why && step.why !== said ? step.why : undefined, id: msg.steps.length, frame }],
  });
  switch (ev.type) {
    case 'thinking':
      return msg;
    case 'thought':
      return add({ kind: 'thought', label: 'Réflexion', meta: ev.text });
    case 'nav':
      if (ev.how === 'search') return add({ kind: 'search', label: `Recherche « ${ev.query ?? ''} »`, meta: host(ev.url).split('?')[0], why: ev.why });
      if (ev.how === 'back') return add({ kind: 'page', label: 'Revient aux résultats de recherche', meta: host(ev.url).split('?')[0], why: ev.why });
      if (ev.how === 'goto') return add({ kind: 'open', label: `Ouvre ${shopName(ev.site) ?? host(ev.url)}`, meta: host(ev.url), why: ev.why, site: ev.site });
      return add({ kind: 'page', label: ev.status === 404 ? 'Page introuvable' : `Arrive sur « ${pageName(ev.title)} »`, meta: host(ev.url), site: ev.site });
    case 'click':
      return add({ kind: 'click', label: `Clique sur « ${ev.label} »`, why: ev.why });
    case 'fill': {
      const last = msg.steps[msg.steps.length - 1];
      const field = { label: ev.label, value: ev.value };
      if (last?.kind !== 'fill') return add({ kind: 'fill', label: `Tape dans « ${ev.label} »`, why: ev.why, fields: [field] });
      // les champs d'un même formulaire sont regroupés en un seul geste, qui montre le dernier champ rempli
      return { ...msg, frames, steps: [...msg.steps.slice(0, -1), { ...last, label: 'Remplit le formulaire', fields: [...(last.fields ?? []), field], frame }] };
    }
    case 'choose':
      return add({ kind: 'choose', label: `Choisit ${(shopName(ev.site) ?? ev.merchant).replace(/\.$/, '')}`, why: ev.why, considered: ev.considered, site: ev.site });
    case 'search':
      return add({ kind: 'search', label: `Recherche « ${ev.query} »`, meta: `${ev.results.length} résultat${ev.results.length > 1 ? 's' : ''}`, why: ev.why, results: ev.results });
    case 'research':
      return add({ kind: 'research', label: `Lit la fiche de ${ev.name}`, why: ev.why });
    case 'pay': {
      const sum = `${amount(ev.order.amount)} ${ev.order.currency === 'EUR' ? '€' : ev.order.currency}`;
      // en mode finance l'ordre n'est pas un achat en boutique : il vise une adresse, sans articles
      if (ev.site === undefined) return add({ kind: 'pay', label: `Prépare l'ordre « ${ev.order.action} » de ${sum}`, meta: short(ev.order.recipient), why: ev.why });
      return add({ kind: 'pay', label: `Envoie le paiement de ${sum}`, meta: (ev.items ?? []).join(', '), site: ev.site });
    }
    case 'invalid':
      return add({ kind: 'invalid', label: 'Geste impossible', meta: ev.message ?? 'Ordre refusé : adresse ou montant invalide.' });
    case 'guard':
      return add({ kind: 'guard', label: 'La transaction est vérifiée avant de partir' });
    case 'verdict':
      return msg; // le verdict est porté par l'événement final
    case 'end':
      return { ...msg, status: 'done', end: ev };
    case 'error':
      return { ...msg, status: 'error', error: ev.message };
  }
}

export type PlanStep = { label: string; state: 'done' | 'current' | 'todo' };
const PLAN = ['Chercher les boutiques', 'Comparer et choisir', 'Remplir le panier et le formulaire', 'Payer'];
const FINANCE_PLAN = ['Chercher des placements', 'Lire les fiches', "Préparer l'ordre"];

/** Le plan en quatre étapes, avec où en est l'agent. Rien n'est "en cours" quand le run ne tourne plus. */
export function planOf(msg: AgentMessage): PlanStep[] {
  const has = (kind: Step['kind']) => msg.steps.some((s) => s.kind === kind);
  if (msg.mode === 'finance') {
    const at = has('pay') ? 3 : has('research') ? 2 : has('search') ? 1 : 0;
    return FINANCE_PLAN.map((label, i) => ({ label, state: i < at ? 'done' : i === at && msg.status === 'running' ? 'current' : 'todo' }));
  }
  const paid = msg.status === 'done' && msg.end?.outcome === 'paid';
  const visited = msg.steps.some((s) => (s.kind === 'page' || s.kind === 'open') && s.site); // une boutique est ouverte : la recherche a abouti
  const reached = paid ? 4 : has('pay') ? 3 : has('choose') ? 2 : visited ? 1 : 0;
  return PLAN.map((label, i) => ({ label, state: i < reached ? 'done' : i === reached && msg.status === 'running' ? 'current' : 'todo' }));
}
