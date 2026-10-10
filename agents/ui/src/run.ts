import type { EndEvent, RunEvent } from './types';

export type Step = {
  id: number;
  kind: 'search' | 'shop' | 'missing' | 'thought' | 'invalid' | 'order';
  title: string;
  detail?: string;
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
      return add({ kind: 'thought', title: 'Réflexion', detail: ev.text });
    case 'search':
      return add({ kind: 'search', title: `Recherche « ${ev.query} »`, why: ev.why }, `Cherche « ${ev.query} »`);
    case 'open': {
      if (!ev.ok) return add({ kind: 'missing', title: 'Page absente', detail: host(ev.url), why: ev.why });
      const name = shopName(ev.site) ?? host(ev.url);
      return add({ kind: 'shop', title: `Étudie ${name}`, detail: host(ev.url), why: ev.why, site: ev.site }, `Étudie ${name}`);
    }
    case 'invalid_order':
      return add({ kind: 'invalid', title: 'Ordre invalide', detail: `Adresse incomplète ou montant nul (${ev.recipient}), renvoyé à l'agent.` });
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
        title: `Prépare l'ordre : ${ev.order.action} ${amount(ev.order.amount)} ${ev.order.currency}`,
        detail: `vers ${ev.order.recipient}`,
      };
      return { ...msg, live: 'Décide', steps: [...steps, order] };
    }
    case 'end':
      return { ...msg, status: 'done', end: ev };
    case 'error':
      return { ...msg, status: 'error', error: ev.message };
  }
}
