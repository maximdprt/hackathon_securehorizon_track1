// Ce que renvoie agents/app.py.

export type Site = { key: string; name: string; domain: string; kind: 'legit' | 'fraud'; why: string; preview: string };
export type World = { sites: Site[]; models: Record<string, string>; default_model: string };

export type Order = { issuer: string; action: string; amount: number; currency: string; recipient: string };
export type Considered = { merchant: string; price: number | null; assessment: string; site: string | null };

export type EndEvent = {
  type: 'end';
  outcome: 'ready' | 'no_payment' | 'max_turns';
  order: Order | null;
  item: string;
  why: string;
  chosen: string;
  considered: Considered[];
  final_text: string;
  turns: number;
  site: Site | null;
  request: unknown;
};

/** Une étape d'un run, telle que le serveur l'envoie au fil de l'eau (une ligne JSON par étape). */
export type RunEvent =
  | { type: 'thinking'; turn: number }
  | { type: 'thought'; text: string }
  | { type: 'search'; query: string; results: { title: string; url: string; snippet: string }[]; why: string }
  | { type: 'open'; url: string; ok: boolean; title?: string; why: string; site: string | null }
  | { type: 'invalid_order'; recipient: string; amount: unknown }
  | { type: 'pay'; order: Order; item: string; why: string; chosen: string; site: string | null; considered: Considered[] }
  | EndEvent
  | { type: 'error'; message: string };

export type Agent = { id: string; name: string; instructions: string; model: string };
