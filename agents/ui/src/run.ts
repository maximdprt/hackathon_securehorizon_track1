import type { Considered, EndEvent, RunEvent, View } from './types';

/** Une image du navigateur de l'agent : la page à un instant du run. */
export type Frame = View & {
  id: number;
  /** nav : une page chargée. click, fill : un geste joué sur la page déjà affichée. */
  kind: 'nav' | 'click' | 'fill';
  /** Pour une page chargée : par une recherche, une adresse, ou à la suite d'un clic. */
  how?: 'search' | 'goto' | 'click';
  /** Le repère de l'élément cliqué ou rempli. */
  ref?: string;
};

/** Un geste de l'agent dans le fil : on peut cliquer dessus pour revoir la page à ce moment-là. */
export type Step = {
  id: number;
  kind: 'search' | 'open' | 'click' | 'page' | 'fill' | 'choose' | 'pay' | 'invalid' | 'thought';
  label: string;
  meta?: string;
  why?: string;
  /** L'image du navigateur à montrer pour ce geste. */
  frame?: number;
  fields?: { label: string; value: string }[];
  considered?: Considered[];
  site?: string | null;
};

export type UserMessage = { id: string; role: 'user'; text: string };
export type AgentMessage = {
  id: string;
  role: 'agent';
  agentName: string;
  model: string;
  prompt: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  steps: Step[];
  frames: Frame[];
  end?: EndEvent;
  error?: string;
};
export type Message = UserMessage | AgentMessage;

export const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
export const amount = (n: number) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const add = (step: Omit<Step, 'id'>): AgentMessage => ({ ...msg, frames, steps: [...msg.steps, { ...step, id: msg.steps.length, frame }] });
  switch (ev.type) {
    case 'thinking':
      return msg;
    case 'thought':
      return add({ kind: 'thought', label: 'Réflexion', meta: ev.text });
    case 'nav':
      if (ev.how === 'search') return add({ kind: 'search', label: `Recherche « ${ev.query ?? ''} »`, meta: host(ev.url).split('?')[0], why: ev.why });
      if (ev.how === 'goto') return add({ kind: 'open', label: `Ouvre ${shopName(ev.site) ?? host(ev.url)}`, meta: host(ev.url), why: ev.why, site: ev.site });
      return add({ kind: 'page', label: ev.status === 404 ? 'Page introuvable' : `Arrive sur « ${pageName(ev.title)} »`, meta: host(ev.url), site: ev.site });
    case 'click':
      return add({ kind: 'click', label: `Clique sur « ${ev.label} »`, why: ev.why });
    case 'fill': {
      const last = msg.steps[msg.steps.length - 1];
      const field = { label: ev.label, value: ev.value };
      if (last?.kind !== 'fill') return add({ kind: 'fill', label: 'Remplit le formulaire', why: ev.why, fields: [field] });
      // les champs d'un même formulaire sont regroupés en un seul geste, qui montre le dernier champ rempli
      return { ...msg, frames, steps: [...msg.steps.slice(0, -1), { ...last, fields: [...(last.fields ?? []), field], frame }] };
    }
    case 'choose':
      return add({ kind: 'choose', label: `Choisit ${(shopName(ev.site) ?? ev.merchant).replace(/\.$/, '')}`, why: ev.why, considered: ev.considered, site: ev.site });
    case 'pay':
      return add({ kind: 'pay', label: `Envoie le paiement de ${amount(ev.order.amount)} ${ev.order.currency === 'EUR' ? '€' : ev.order.currency}`, meta: ev.items.join(', '), site: ev.site });
    case 'invalid':
      return add({ kind: 'invalid', label: 'Geste impossible', meta: ev.message });
    case 'end':
      return { ...msg, status: 'done', end: ev };
    case 'error':
      return { ...msg, status: 'error', error: ev.message };
  }
}

export type PlanStep = { label: string; state: 'done' | 'current' | 'todo' };
const PLAN = ['Chercher les boutiques', 'Comparer et choisir', 'Remplir le panier et le formulaire', 'Payer'];

/** Le plan en quatre étapes, avec où en est l'agent. Rien n'est "en cours" quand le run ne tourne plus. */
export function planOf(msg: AgentMessage): PlanStep[] {
  const has = (kind: Step['kind']) => msg.steps.some((s) => s.kind === kind);
  const paid = msg.status === 'done' && msg.end?.outcome === 'paid';
  const reached = paid ? 4 : has('pay') ? 3 : has('choose') ? 2 : has('search') || has('open') ? 1 : 0;
  return PLAN.map((label, i) => ({ label, state: i < reached ? 'done' : i === reached && msg.status === 'running' ? 'current' : 'todo' }));
}
