// Ce que renvoie agents/app.py.

export type Site = { key: string; name: string; domain: string; kind: 'legit' | 'fraud'; why: string; preview: string; /** Couleur d'identité de la boutique. */ color?: string };
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

/** L'analyse de la transaction à l'entrée de SentinelL1 (outil MCP verify_payment). L'agent ne la voit pas. */
export type Verdict = {
  verdict: 'allow' | 'needs_approval' | 'block';
  trust_score: number | null;
  risk_score: number | null;
  severity: number | null;
  reasons: string[];
  owasp: string[];
  onchain_flagged: boolean;
  instruction_id: string | null;
  latency_ms: number | null;
  backend: string | null;
};
export type OnchainTx = { kind: 'visa' | 'flag' | 'decision'; hash: string; url: string };
export type Onchain =
  | { ok: true; verdict: string; payment_id: string; nonce: number; txs: OnchainTx[]; city: string; latency_ms: number }
  | { ok: false; verdict: string; error: string };

/** Boutiques : l'agent navigue et achète. Finance : l'agent Hermès cherche des placements, lit leur fiche et prépare un ordre. */
export type Mode = 'shop' | 'finance';
/** Ce que le bac à sable sait du placement choisi en mode finance, et que l'agent ignore. */
export type FinanceAsset = { id: string; name: string; domain: string; kind: 'legit' | 'fraud'; why: string; apy: number };

export type EndEvent = {
  type: 'end';
  /** ready : en mode finance sans garde, l'ordre est préparé mais pas envoyé. done : l'investissement est parti. */
  outcome: 'paid' | 'blocked' | 'needs_approval' | 'no_payment' | 'max_turns' | 'ready' | 'done';
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
  /** Rempli quand le garde était branché : révélé dans l'interface APRÈS la voiture, comme une notification. */
  verdict?: Verdict | null;
  onchain?: Onchain | null;
  asset?: FinanceAsset | null;
};

/** Un geste de l'agent, tel que le serveur l'envoie au fil de l'eau (une ligne JSON par geste). */
export type RunEvent =
  | { type: 'thinking'; turn: number }
  | { type: 'thought'; text: string }
  | { type: 'nav'; how: 'search' | 'goto' | 'click' | 'back'; url: string; title: string; status: number; site: string | null; why: string; query?: string; view: View }
  | { type: 'click'; ref: string; label: string; kind: string; why: string; view: View }
  | { type: 'fill'; ref: string; label: string; value: string; why: string; view: View }
  | { type: 'choose'; merchant: string; site: string | null; why: string; considered: Considered[] }
  | { type: 'pay'; site?: string | null; order: Order; items?: string[]; submitted?: Record<string, string> | null; why?: string; asset?: string }
  | { type: 'search'; query: string; results: { id: string; name: string; snippet: string }[]; why: string }
  | { type: 'research'; asset: string; name: string; why: string }
  | { type: 'invalid'; tool?: string; message?: string }
  | { type: 'submit'; network: string }
  | ({ type: 'onchain' } & Onchain)
  | EndEvent
  | { type: 'error'; message: string };

export type Agent = { id: string; name: string; instructions: string; model: string };
