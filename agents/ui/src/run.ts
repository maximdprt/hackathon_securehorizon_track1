import type { EndEvent, RunEvent } from './types';

/** Une action de l'agent, affichée comme une ligne d'outil. */
export type Step = {
  id: number;
  kind: 'search' | 'shop' | 'missing' | 'thought' | 'invalid' | 'order';
  name: string;
  meta: string;
  why?: string;
  site?: string | null;
  /** Ce que l'agent retient de la boutique : il le donne au moment de décider. */
  found?: string;
};

export type UserMessage = { id: string; role: 'user'; text: string };
export type AgentMessage = {
  id: string;
  role: 'agent';
  agentName: string;
  model: string;
  prompt: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  live: string;
  steps: Step[];
  end?: EndEvent;
  error?: string;
};
export type Message = UserMessage | AgentMessage;

export const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
export const amount = (n: number) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** Applique une étape reçue du serveur à la réponse de l'agent. Fonction pure : elle rend un nouveau message. */
export function applyEvent(msg: AgentMessage, ev: RunEvent, shopName: (key: string | null) => string | undefined): AgentMessage {
  const add = (step: Omit<Step, 'id'>, live = msg.live): AgentMessage => ({ ...msg, live, steps: [...msg.steps, { ...step, id: msg.steps.length }] });
  switch (ev.type) {
    case 'thinking':
      return msg;
    case 'thought':
      return add({ kind: 'thought', name: 'Réflexion', meta: ev.text });
    case 'search': {
      const found = `${ev.results.length} ${ev.results.length > 1 ? 'boutiques trouvées' : 'boutique trouvée'}`;
      return add({ kind: 'search', name: 'Recherche web', meta: `« ${ev.query} » · ${found}`, why: ev.why }, 'Je cherche les boutiques qui vendent ce produit.');
    }
    case 'open': {
      if (!ev.ok) return add({ kind: 'missing', name: 'Page absente', meta: host(ev.url), why: ev.why });
      const name = shopName(ev.site) ?? host(ev.url);
      return add({ kind: 'shop', name, meta: host(ev.url), why: ev.why, site: ev.site }, `J'étudie ${name.replace(/\.$/, '')}.`);
    }
    case 'invalid_order':
      return add({ kind: 'invalid', name: 'Ordre invalide', meta: `adresse incomplète ou montant nul (${ev.recipient})` });
    case 'pay': {
      const noted = new Set<string>();
      const steps = msg.steps.map((step) => {
        const c = step.kind === 'shop' && step.site && !noted.has(step.site) ? ev.considered.find((x) => x.site === step.site) : undefined;
        if (!c || !step.site) return step;
        noted.add(step.site);
        return { ...step, found: `${c.price != null ? `${amount(c.price)} USDC, ` : ''}${c.assessment}` };
      });
      const order: Step = {
        id: steps.length,
        kind: 'order',
        name: 'Ordre de paiement',
        meta: `${ev.order.action} ${amount(ev.order.amount)} ${ev.order.currency} vers ${ev.order.recipient}`,
      };
      return { ...msg, live: "Je prépare l'ordre de paiement.", steps: [...steps, order] };
    }
    case 'end':
      return { ...msg, status: 'done', end: ev };
    case 'error':
      return { ...msg, status: 'error', error: ev.message };
  }
}

export type PlanStep = { label: string; state: 'done' | 'current' | 'todo' };
const PLAN = ['Chercher les boutiques', 'Étudier et comparer les boutiques', "Préparer l'ordre de paiement"];

/** Le plan en trois étapes, avec où en est l'agent. Rien n'est "en cours" quand le run ne tourne plus. */
export function planOf(msg: AgentMessage): PlanStep[] {
  const ready = msg.status === 'done' && msg.end?.outcome === 'ready';
  const reached = ready ? 3 : msg.steps.some((s) => s.kind === 'order') ? 2 : msg.steps.some((s) => s.kind === 'search' || s.kind === 'shop') ? 1 : 0;
  return PLAN.map((label, i) => ({ label, state: i < reached ? 'done' : i === reached && msg.status === 'running' ? 'current' : 'todo' }));
}
