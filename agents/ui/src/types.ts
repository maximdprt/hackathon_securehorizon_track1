// Ce que renvoie agents/app.py.

export type Site = { key: string; name: string; domain: string; kind: 'legit' | 'fraud'; why: string; preview: string };
export type Profile = { name: string; city: string; card: string };
export type World = { sites: Site[]; models: Record<string, string>; default_model: string; profile: Profile };

export type Order = { issuer: string; action: string; amount: number; currency: string; recipient: string };
export type Considered = { merchant: string; price: number | null; assessment: string; site: string | null };
/** La page telle que le navigateur de l'agent l'affiche : son vrai HTML, champs remplis, élément visé encadré. */
export type View = { url: string; title: string; status: number; html: string };
export type Confirmation = {
  id: string;
  total: number;
  buyer: { email: string; name: string; address: string; postal: string; city: string; country: string };
  card: { holder: string; last4: string; exp: string };
};

export type EndEvent = {
  type: 'end';
  outcome: 'paid' | 'blocked' | 'needs_approval' | 'no_payment' | 'max_turns';
  order: Order | null;
  chosen: string;
  why: string;
  considered: Considered[];
  submitted: Record<string, string> | null;
  confirmation: Confirmation | null;
  expected: string | null;
  final_text: string;
  turns: number;
  site: Site | null;
  request: unknown;
};

/** Un geste de l'agent, tel que le serveur l'envoie au fil de l'eau (une ligne JSON par geste). */
export type RunEvent =
  | { type: 'thinking'; turn: number }
  | { type: 'thought'; text: string }
  | { type: 'nav'; how: 'search' | 'goto' | 'click' | 'back'; url: string; title: string; status: number; site: string | null; why: string; query?: string; view: View }
  | { type: 'click'; ref: string; label: string; kind: string; why: string; view: View }
  | { type: 'fill'; ref: string; label: string; value: string; why: string; view: View }
  | { type: 'choose'; merchant: string; site: string | null; why: string; considered: Considered[] }
  | { type: 'pay'; site: string; order: Order; items: string[]; submitted: Record<string, string> }
  | { type: 'invalid'; tool: string; message: string }
  | EndEvent
  | { type: 'error'; message: string };

export type Agent = { id: string; name: string; instructions: string; model: string };
