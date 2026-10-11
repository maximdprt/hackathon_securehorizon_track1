import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { appId, here, privyConfig, short } from './privyConfig';
import { merchantOf, money, plainReasons, REQUEST_LABEL, useDecisions, useRequests, when, type Decision, type RequestKind, type UserRequest } from './data';
import { promptTemplate, xmlError, type PromptInput } from './prompt';

/* Sentinel's app, where a logged-in user lands (app.html). A user sees their money, not the chain: what their agents
   paid, what Sentinel stopped, what waits for them, and their agents, each with a full XML prompt and its mandate.
   They stay in control: approve or block a held payment, report a paid one as a fraud, mark a blocked one as legit.
   Each request goes to Sentinel's team, who act on Sentinel L1 (ops.html). Agents are kept in this browser under the
   user's Privy id until the accounts backend opens. */

/** the demo shopping agent: the PoC's runs were made in its name */
const DEMO_ISSUER = '0xA11ce00000000000000000000000000000000002';

type Framework = 'hermes' | 'claude' | 'mcp';
type Agent = PromptInput & { id: string; issuer: string; prompt: string; createdAt: string };
const FRAMEWORK: Record<Framework, string> = { hermes: 'Hermès', claude: 'Claude', mcp: 'Any MCP client' };
const USECASE = { shopping: 'Shopping', finance: 'Finance', api: 'API payments' } as const;

function useAgents(userId?: string) {
  const key = userId ? `sentinel.agents.${userId}` : '';
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (!key) return;
    try {
      const raw: Agent[] = JSON.parse(localStorage.getItem(key) || '[]');
      setAgents(raw.map((a) => ({ ...a, prompt: a.prompt || promptTemplate(a) })));
    } catch { setAgents([]); }
  }, [key]);
  const save = useCallback((next: Agent[]) => {
    setAgents(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window: kept for this visit */ }
  }, [key]);
  return {
    agents,
    add: (a: Agent) => save([a, ...agents]),
    update: (a: Agent) => save(agents.map((x) => (x.id === a.id ? a : x))),
    remove: (id: string) => save(agents.filter((a) => a.id !== id)),
  };
}
const newId = () => 'agt_' + Math.random().toString(36).slice(2, 8);

/* ---------- a payment, as the user sees it ---------- */

const STATUS = {
  allow: { label: 'Paid', cls: 'ok' },
  needs_human: { label: 'Waiting for you', cls: 'hu' },
  block: { label: 'Blocked by Sentinel', cls: 'ko' },
} as const;

function Amount({ d }: { d: Decision }) {
  if (d.verdict === 'allow') return <span className="amt out">−{money(d.amount)}</span>;
  if (d.verdict === 'block') return <span className="amt saved">{d.amount != null ? `${money(d.amount)} kept` : 'kept'}</span>;
  return <span className="amt wait">{money(d.amount)}</span>;
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn sm ghost" onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1300); }}>{done ? 'Copied' : label}</button>;
}

/** the user's hand on a payment: approve or block when it waits; report a fraud once paid; mark a refusal as legit */
function Actions({ d, req, act }: { d: Decision; req?: UserRequest; act: (d: Decision, k: RequestKind) => void }) {
  if (req) return <span className={`req ${req.status}`}>{REQUEST_LABEL[req.kind]} · {req.status === 'sent' ? 'sent to Sentinel' : req.status === 'applied' ? 'done' : 'declined'}</span>;
  if (d.verdict === 'needs_human') return <span className="acts"><button className="btn xs" onClick={() => act(d, 'approve')}>Approve</button><button className="btn xs ghost danger" onClick={() => act(d, 'block')}>Block</button></span>;
  if (d.verdict === 'allow') return <span className="acts"><button className="btn xs ghost danger" onClick={() => act(d, 'report')}>Report fraud</button></span>;
  return <span className="acts"><button className="btn xs ghost" onClick={() => act(d, 'legit')}>It's legit</button></span>;
}

function Payments({ rows, agents, reqs, act, limit }: { rows: Decision[]; agents: Agent[]; reqs: Map<string, UserRequest>; act: (d: Decision, k: RequestKind) => void; limit?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (issuer: string) => agents.find((a) => a.issuer.toLowerCase() === issuer)?.name || 'Agent';
  const list = limit ? rows.slice(0, limit) : rows;
  if (!list.length) return <p className="empty">No payment yet.</p>;
  return (
    <div className="pays">
      {list.map((d) => {
        const reasons = plainReasons(d.signals);
        const k = d.paymentId + d.txHash;
        return (
          <div key={k} className={`pay ${open === k ? 'open' : ''}`}>
            <div className="pay-row" onClick={() => setOpen(open === k ? null : k)}>
              <span className={`ic ${STATUS[d.verdict].cls}`}>{merchantOf(d.recipient).slice(0, 1)}</span>
              <span className="who"><b>{merchantOf(d.recipient)}</b><small>{name(d.issuer)} · {when(d.at)}</small></span>
              <span className={`st ${STATUS[d.verdict].cls}`}><i />{STATUS[d.verdict].label}</span>
              <Amount d={d} />
              <span className="r" onClick={(e) => e.stopPropagation()}><Actions d={d} req={reqs.get(d.paymentId)} act={act} /></span>
            </div>
            {open === k && (
              <div className="pay-why">
                {d.verdict === 'allow' && <p>Sentinel found nothing wrong: the payment left your wallet.</p>}
                {d.verdict === 'needs_human' && <p>Sentinel wasn't sure, so it didn't decide for you. The money is still in your wallet.</p>}
                {d.verdict === 'block' && <p>Sentinel stopped this payment: the money never left your wallet.</p>}
                {reasons.length > 0 && <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                {d.trust != null && <p className="mute">Confidence {d.trust}/100</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- pages ---------- */

function Overview({ agents, mine, reqs, act, go, email }: { agents: Agent[]; mine: Decision[]; reqs: Map<string, UserRequest>; act: (d: Decision, k: RequestKind) => void; go: (p: string) => void; email?: string }) {
  const paid = mine.filter((d) => d.verdict === 'allow');
  const blocked = mine.filter((d) => d.verdict === 'block');
  const waiting = mine.filter((d) => d.verdict === 'needs_human' && !reqs.has(d.paymentId));
  const sum = (l: Decision[]) => l.reduce((s, d) => s + (d.amount || 0), 0);
  const steps = [
    { done: agents.length > 0, title: 'Create your first agent', text: 'Its prompt and its spending limits.', go: 'agents' },
    { done: agents.length > 0, title: 'Plug it into Sentinel', text: 'Paste its config into Hermès, Claude or your MCP client.', go: 'agents' },
    { done: mine.length > 0, title: 'Its first payment is checked', text: 'Every payment then shows up here.', go: 'payments' },
  ];
  return (
    <>
      <header className="ph"><div><p className="eb">Overview</p><h1>Welcome{email ? `, ${email.split('@')[0]}` : ''}</h1></div>
        <button className="btn" onClick={() => go('agents')}>New agent</button></header>
      <div className="kpis">
        <div className="kpi"><span>Spent by your agents</span><b>{money(sum(paid))}</b><small>{paid.length} payments</small></div>
        <div className="kpi"><span>Kept safe by Sentinel</span><b className="ok">{money(sum(blocked))}</b><small>{blocked.length} payments stopped</small></div>
        <div className="kpi"><span>Waiting for you</span><b className="hu">{waiting.length}</b><small>{money(sum(waiting))}</small></div>
        <div className="kpi"><span>Agents</span><b>{agents.length}</b><small>{agents.filter((a) => mine.some((d) => d.issuer === a.issuer.toLowerCase())).length} active</small></div>
      </div>
      {waiting.length > 0 && (
        <section className="card attn">
          <div className="row"><h3>{waiting.length} payment{waiting.length > 1 ? 's' : ''} waiting for your decision</h3><button className="btn sm ghost" onClick={() => go('approvals')}>Review →</button></div>
          <Payments rows={waiting} agents={agents} reqs={reqs} act={act} limit={3} />
        </section>
      )}
      {steps.some((x) => !x.done) && (
        <section className="card">
          <h3>Get started</h3>
          <ol className="steps row3">{steps.map((x, i) => (
            <li key={i} className={x.done ? 'done' : ''} onClick={() => go(x.go)}><span className="n">{x.done ? '✓' : i + 1}</span><div><b>{x.title}</b><p>{x.text}</p></div></li>
          ))}</ol>
        </section>
      )}
      <section className="card">
        <div className="row"><h3>Latest payments</h3><button className="btn sm ghost" onClick={() => go('payments')}>All payments →</button></div>
        <Payments rows={mine} agents={agents} reqs={reqs} act={act} limit={6} />
      </section>
    </>
  );
}

function PaymentsPage({ mine, agents, reqs, act }: { mine: Decision[]; agents: Agent[]; reqs: Map<string, UserRequest>; act: (d: Decision, k: RequestKind) => void }) {
  const [v, setV] = useState<'any' | 'allow' | 'needs_human' | 'block'>('any');
  const [agent, setAgent] = useState('any');
  const [q, setQ] = useState('');
  const rows = mine.filter((d) => (v === 'any' || d.verdict === v) && (agent === 'any' || d.issuer === agent) && (!q || merchantOf(d.recipient).toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <header className="ph"><div><p className="eb">Payments</p><h1>Your payments</h1></div></header>
      <div className="filters">
        <div className="seg">{([['any', 'All'], ['allow', 'Paid'], ['needs_human', 'Waiting'], ['block', 'Blocked']] as const).map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => setV(k)}>{l}</button>)}</div>
        {agents.length > 1 && <select className="pick" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="any">All agents</option>{agents.map((a) => <option key={a.id} value={a.issuer.toLowerCase()}>{a.name}</option>)}</select>}
        <input className="search" placeholder="Search a merchant…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <section className="card">{!agents.length ? <p className="empty">Create an agent: its payments show up here.</p> : <Payments rows={rows} agents={agents} reqs={reqs} act={act} />}</section>
      <p className="note">Something wrong on a payment that left? <b>Report fraud</b>: Sentinel's team acts at once, and the merchant is refused for every Sentinel customer. See what happens next in our <a href={here('terms.html#fraud')} target="_blank" rel="noopener">Terms</a>.</p>
    </>
  );
}

function Approvals({ mine, agents, reqs, act }: { mine: Decision[]; agents: Agent[]; reqs: Map<string, UserRequest>; act: (d: Decision, k: RequestKind) => void }) {
  const held = mine.filter((d) => d.verdict === 'needs_human');
  const open = held.filter((d) => !reqs.has(d.paymentId));
  return (
    <>
      <header className="ph"><div><p className="eb">Approvals</p><h1>Waiting for you</h1></div></header>
      <p className="lede">When Sentinel isn't sure, it doesn't guess: the payment waits for you, and the money stays in your wallet. Approve it, or block it.</p>
      <section className="card">{held.length ? <Payments rows={[...open, ...held.filter((d) => reqs.has(d.paymentId))]} agents={agents} reqs={reqs} act={act} /> : <p className="empty">Nothing waiting.</p>}</section>
    </>
  );
}

function Agents({ agents, add, update, remove, mine, walletAddress }: { agents: Agent[]; add: (a: Agent) => void; update: (a: Agent) => void; remove: (id: string) => void; mine: Decision[]; walletAddress?: string }) {
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const demo = () => {
    const base: PromptInput = { name: 'Shopping agent', framework: 'hermes', useCase: 'shopping', perPayment: 10000, daily: 30000, currency: 'EUR', actions: ['pay'], recipients: [], humanAbove: 0 };
    add({ ...base, id: newId(), issuer: DEMO_ISSUER, prompt: promptTemplate(base), createdAt: new Date().toISOString() });
  };
  return (
    <>
      <header className="ph"><div><p className="eb">Agents</p><h1>Your agents</h1></div>
        <div className="row g8"><button className="btn ghost" onClick={demo}>Add the demo agent</button><button className="btn" onClick={() => setEditing('new')}>New agent</button></div></header>
      {!agents.length ? (
        <section className="card hero">
          <div className="badge">Hermès × Sentinel MCP</div>
          <h2>Create an agent, give it a precise XML prompt and its limits, and every payment it makes is checked.</h2>
          <div className="row g8"><button className="btn" onClick={() => setEditing('new')}>Create my first agent</button><button className="btn ghost" onClick={demo}>Add the demo agent</button></div>
        </section>
      ) : (
        <div className="agents">{agents.map((a) => {
          const runs = mine.filter((d) => d.issuer === a.issuer.toLowerCase());
          const spent = runs.filter((d) => d.verdict === 'allow').reduce((s, d) => s + (d.amount || 0), 0);
          return (
            <button key={a.id} className="agent" onClick={() => setEditing(a)}>
              <div className="row"><span className="av">{a.name.slice(0, 1).toUpperCase()}</span><span className={`dot ${runs.length ? 'live' : ''}`}>{runs.length ? 'Active' : 'Not connected yet'}</span></div>
              <b>{a.name}</b>
              <span className="mute">{FRAMEWORK[a.framework]} · {USECASE[a.useCase]}</span>
              <div className="mini"><span>{money(spent)} spent</span><span className="ok">{runs.filter((d) => d.verdict === 'block').length} stopped</span><span className="hu">{runs.filter((d) => d.verdict === 'needs_human').length} waiting</span></div>
            </button>
          );
        })}</div>
      )}
      {editing && <AgentEditor agent={editing === 'new' ? null : editing} walletAddress={walletAddress} onClose={() => setEditing(null)}
        onSave={(a) => { (editing === 'new' ? add : update)(a); setEditing(null); }} onDelete={editing !== 'new' ? () => { remove((editing as Agent).id); setEditing(null); } : undefined} />}
    </>
  );
}

function mcpConfig(a: Agent) {
  if (a.framework === 'claude') return `// claude_desktop_config.json\n{\n  "mcpServers": {\n    "sentinel": {\n      "command": "python",\n      "args": ["mcp_server.py"],\n      "env": { "SENTINEL_AGENT": "${a.id}" }\n    }\n  }\n}`;
  return `# ${a.framework === 'hermes' ? 'Hermès · config.yaml' : 'your MCP client'}\nmcp_servers:\n  sentinel:\n    command: "python"\n    args: ["mcp_server.py"]   # Sentinel's MCP server\n    env:\n      SENTINEL_AGENT: "${a.id}"`;
}

function AgentEditor({ agent, walletAddress, onClose, onSave, onDelete }: { agent: Agent | null; walletAddress?: string; onClose: () => void; onSave: (a: Agent) => void; onDelete?: () => void }) {
  const init: Agent = agent || { id: newId(), name: '', framework: 'hermes', useCase: 'shopping', issuer: walletAddress || '', perPayment: 300, daily: 3000, currency: 'EUR',
    actions: ['pay'], recipients: [], humanAbove: 150, prompt: '', createdAt: new Date().toISOString() };
  const [f, setF] = useState<Agent>(init);
  const [tab, setTab] = useState<'settings' | 'prompt' | 'connect'>(agent ? 'prompt' : 'settings');
  // the prompt follows the settings until the user writes in it
  const [custom, setCustom] = useState(!!agent && agent.prompt !== promptTemplate(agent));
  const template = useMemo(() => promptTemplate(f), [f.name, f.framework, f.useCase, f.perPayment, f.daily, f.currency, f.actions.join(), f.recipients.join(), f.humanAbove]); // eslint-disable-line
  const prompt = custom ? f.prompt : template;
  const err = xmlError(prompt);
  const set = (k: keyof Agent, v: any) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.name.trim() && /^0x[0-9a-fA-F]{40}$/.test(f.issuer.trim()) && !err;
  const toggle = (act: string) => set('actions', f.actions.includes(act) ? f.actions.filter((x) => x !== act) : [...f.actions, act]);
  const download = () => { const url = URL.createObjectURL(new Blob([prompt], { type: 'application/xml' })); const a = document.createElement('a'); a.href = url; a.download = `${(f.name || 'agent').replace(/\W+/g, '-').toLowerCase()}.xml`; a.click(); URL.revokeObjectURL(url); };
  return (
    <div className="modal" onClick={onClose}><div className="sheet wide" onClick={(e) => e.stopPropagation()}>
      <header className="row"><div className="row g8"><span className="av lg">{(f.name || '?').slice(0, 1).toUpperCase()}</span><h2>{agent ? f.name : 'New agent'}</h2></div><button className="x" onClick={onClose}>×</button></header>
      <div className="seg">{([['settings', 'Settings'], ['prompt', 'Prompt (XML)'], ['connect', 'Connect']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'settings' && (<>
        <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Treasury agent" autoFocus /></label>
        <div className="two">
          <label>Framework<select value={f.framework} onChange={(e) => set('framework', e.target.value)}>{Object.entries(FRAMEWORK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Use<select value={f.useCase} onChange={(e) => set('useCase', e.target.value)}>{Object.entries(USECASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label>Paying wallet<input className="mono" value={f.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="0x…" />
          <small>{walletAddress && f.issuer === walletAddress ? 'Your Sentinel wallet. Use another one if the agent pays from its own.' : 'The wallet this agent pays from.'}</small></label>
        <p className="eb">Spending limits · enforced by Sentinel</p>
        <div className="three">
          <label>Max per payment<input type="number" min="0" value={f.perPayment} onChange={(e) => set('perPayment', Number(e.target.value))} /></label>
          <label>Max per day<input type="number" min="0" value={f.daily} onChange={(e) => set('daily', Number(e.target.value))} /></label>
          <label>Currency<select value={f.currency} onChange={(e) => set('currency', e.target.value)}><option>EUR</option><option>USDC</option><option>AVAX</option></select></label>
        </div>
        <div className="acts">{['pay', 'transfer', 'approve', 'swap'].map((x) => <label key={x} className={`tick ${f.actions.includes(x) ? 'on' : ''}`}><input type="checkbox" checked={f.actions.includes(x)} onChange={() => toggle(x)} />{x}</label>)}</div>
        <label>Allowed merchants <span className="mute">(optional)</span><textarea className="mono" rows={2} value={f.recipients.join('\n')} onChange={(e) => set('recipients', e.target.value.split(/[\s,]+/).filter(Boolean))} placeholder="a wallet address or a shop's domain, one per line" /></label>
        <label>Ask me above<input type="number" min="0" value={f.humanAbove} onChange={(e) => set('humanAbove', Number(e.target.value))} /><small>Payments above this amount wait for your approval.</small></label>
      </>)}

      {tab === 'prompt' && (<>
        <p className="lede sm">A full XML prompt keeps your agent precise: its role, its goal, its steps, its payment rules, what it must never do, and how it answers. It follows your settings until you edit it.</p>
        <textarea className={`xml ${err ? 'bad' : ''}`} spellCheck={false} value={prompt} onChange={(e) => { setCustom(true); set('prompt', e.target.value); }} />
        <div className="row">
          <span className={err ? 'ko' : 'ok'}>{err || '✓ Well-formed XML'}</span>
          <span className="row g8">{custom && <button className="btn sm ghost" onClick={() => { setCustom(false); set('prompt', ''); }}>Reset from settings</button>}<Copy text={prompt} label="Copy prompt" /><button className="btn sm ghost" onClick={download}>Download .xml</button></span>
        </div>
        <p className="note">The prompt guides your agent. Your limits are enforced by Sentinel itself, whatever the prompt says.</p>
      </>)}

      {tab === 'connect' && (<>
        <p className="lede sm">Give your agent its prompt, and add Sentinel to its MCP servers: every payment then goes through Sentinel before it leaves.</p>
        <pre className="code">{mcpConfig(f)}</pre>
        <div className="row g8"><Copy text={mcpConfig(f)} label="Copy config" /><span className="mute">A hosted endpoint with your API key is coming; this runs Sentinel's MCP server next to your agent.</span></div>
      </>)}

      <footer className="row">
        {onDelete ? <button className="btn ghost danger" onClick={onDelete}>Remove agent</button> : <span />}
        <span className="row g8"><button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={!ok} onClick={() => onSave({ ...f, name: f.name.trim(), issuer: f.issuer.trim(), prompt })}>{agent ? 'Save' : 'Create agent'}</button></span>
      </footer>
    </div></div>
  );
}

function Settings({ email, wallet, id, logout }: { email?: string; wallet?: string; id?: string; logout: () => void }) {
  return (
    <>
      <header className="ph"><div><p className="eb">Settings</p><h1>Account</h1></div></header>
      <section className="card">
        <dl className="kv">
          <dt>Email</dt><dd>{email || '—'}</dd>
          <dt>Wallet</dt><dd className="mono">{wallet ? short(wallet) : 'being created…'} {wallet && <Copy text={wallet} label="Copy address" />}</dd>
          <dt>Account id</dt><dd className="mono mute">{id}</dd>
        </dl>
        <p className="mute">Your wallet was created from your email: no extension, no seed phrase.</p>
      </section>
      <section className="card"><div className="row"><div><h3>Log out</h3><p className="mute">Log back in with the same email: your wallet stays yours.</p></div><button className="btn ghost danger" onClick={logout}>Log out</button></div></section>
    </>
  );
}

/* ---------- the shell ---------- */

const ICON: Record<string, JSX.Element> = {
  overview: <path d="M4 13h6V4H4zm0 7h6v-5H4zm10 0h6V11h-6zm0-16v5h6V4z" />,
  payments: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  approvals: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.3-4 4.3-6 8-6s6.7 2 8 6" /></>,
  agents: <><rect x="4" y="6" width="16" height="12" rx="3" /><path d="M9 11h.01M15 11h.01M9 15h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10l2 2M5 19l2-2m10-10l2-2" /></>,
  docs: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
  out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
};
const Ico = ({ n }: { n: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[n]}</svg>;
const PAGES = [['overview', 'Overview'], ['payments', 'Payments'], ['approvals', 'Approvals'], ['agents', 'Agents'], ['settings', 'Settings']] as const;

/** ?preview on localhost: the app with a demo account, to work on its pages without logging in (never in production) */
const PREVIEW = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');
const PREVIEW_USER = { id: 'preview', email: { address: 'demo@example.com' }, wallet: { address: '0x7E57000000000000000000000000000000000001' } } as any;

function App() {
  const privy = usePrivy();
  const { ready, authenticated, user, login, logout } = PREVIEW ? { ...privy, ready: true, authenticated: true, user: PREVIEW_USER, logout: async () => {} } : privy;
  const [page, setPage] = useState<string>(() => location.hash.slice(1) || 'overview');
  useEffect(() => { const f = () => setPage(location.hash.slice(1) || 'overview'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const go = (p: string) => { location.hash = p; setPage(p); };
  const { rows: all, error } = useDecisions();
  const { agents, add, update, remove } = useAgents(user?.id);
  const { all: requests, send } = useRequests();
  const issuers = new Set(agents.map((a) => a.issuer.toLowerCase()));
  const mine = (all || []).filter((r) => issuers.has(r.issuer));
  const reqs = new Map(requests.filter((r) => r.userId === user?.id).map((r) => [r.paymentId, r]));
  const email = user?.email?.address;
  const wallet = user?.wallet?.address;
  const [toast, setToast] = useState('');
  const act = (d: Decision, kind: RequestKind) => {
    const agent = agents.find((a) => a.issuer.toLowerCase() === d.issuer);
    send({ kind, userId: user.id, email, agent: agent?.name || 'Agent', issuer: d.issuer, paymentId: d.paymentId, merchant: merchantOf(d.recipient), recipient: d.recipient, amount: d.amount, txHash: d.txHash });
    // "it's legit": the merchant joins this agent's allowed list
    if (kind === 'legit' && agent && d.recipient && !agent.recipients.includes(d.recipient)) update({ ...agent, recipients: [...agent.recipients, d.recipient] });
    setToast({ approve: 'Approval sent to Sentinel.', block: 'Block sent to Sentinel.', report: 'Fraud reported: Sentinel\'s team is on it.', legit: 'Marked as legit: this merchant is now allowed for this agent.' }[kind]);
    setTimeout(() => setToast(''), 3200);
  };

  if (!ready) return <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><p className="mute">Loading…</p></div>;
  if (!authenticated) return (
    <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><h1>Sentinel</h1><p className="mute">Log in to see your agents and their payments.</p>
      <button className="btn lg" onClick={login}>Log in</button><a className="mute lnk" href={here('index.html')}>← Back to the site</a></div>
  );
  const waiting = mine.filter((d) => d.verdict === 'needs_human' && !reqs.has(d.paymentId)).length;
  return (
    <div className="shell">
      <nav className="side">
        <a className="brand" href={here('index.html')}><img src={here('assets/logo-white.png')} alt="" />Sentinel</a>
        <div className="ws"><span className="av">{(email || 'S').slice(0, 1).toUpperCase()}</span><div><b>{email || short(wallet)}</b><span className="mono">{wallet ? short(wallet) : 'wallet…'}</span></div></div>
        <div className="nav">{PAGES.map(([k, l]) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => go(k)}><Ico n={k} />{l}
            {k === 'agents' && agents.length > 0 && <em>{agents.length}</em>}
            {k === 'approvals' && waiting > 0 && <em className="hu">{waiting}</em>}</button>
        ))}</div>
        <div className="foot">
          <a href={here('index.html#start')}><Ico n="docs" />How it works</a>
          <a href={here('terms.html')} target="_blank" rel="noopener"><Ico n="docs" />Terms</a>
          <button onClick={logout}><Ico n="out" />Log out</button>
          <p className={`status ${error ? 'off' : ''}`}><i />{error ? 'Protection unreachable' : 'Protection active'}</p>
        </div>
      </nav>
      <main className="main">
        {page === 'overview' && <Overview agents={agents} mine={mine} reqs={reqs} act={act} go={go} email={email} />}
        {page === 'payments' && <PaymentsPage mine={mine} agents={agents} reqs={reqs} act={act} />}
        {page === 'approvals' && <Approvals mine={mine} agents={agents} reqs={reqs} act={act} />}
        {page === 'agents' && <Agents agents={agents} add={add} update={update} remove={remove} mine={mine} walletAddress={wallet} />}
        {page === 'settings' && <Settings email={email} wallet={wallet} id={user?.id} logout={logout} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider appId={appId} config={privyConfig}><App /></PrivyProvider>
  </StrictMode>,
);
