import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { appId, here, privyConfig, short } from './privyConfig';

/* Sentinel's app, where a logged-in user lands (app.html): their account and wallet (Privy), their agents with the
   framework they run on (Hermès, Claude, any MCP client) and each agent's mandate, the MCP config to plug them into
   Sentinel, and every payment Sentinel checked, read live from Sentinel L1 (https://rpc.petroi.fr/cars).
   Until Sentinel's accounts backend opens, a user's agents are kept in this browser, under their Privy id. */

const API = 'https://rpc.petroi.fr';
const EXPLORER = 'https://explorer.petroi.fr';
/** the demo shopping agent: the PoC's runs on Sentinel L1 were made in its name */
const DEMO_ISSUER = '0xA11ce00000000000000000000000000000000002';

/* ---------- data ---------- */

type Verdict = 'allow' | 'block' | 'needs_human';
type Decision = { verdict: Verdict; issuer: string; recipient: string | null; amount: number | null; trust: number | null; reason: string; txHash: string; block: number; paymentId: string };

function useDecisions() {
  const [rows, setRows] = useState<Decision[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}/cars`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const out: Decision[] = (d.cars || []).map((c: any) => {
          const m = /trust=(\d+)\/100;?\s*/.exec(c.reason || '');
          return {
            verdict: c.verdict, issuer: (c.issuer || '').toLowerCase(), recipient: c.recipient ? c.recipient.toLowerCase() : null,
            amount: c.amount ? Number(BigInt(c.amount) / 10n ** 16n) / 100 : null, trust: m ? Number(m[1]) : null,
            reason: (c.reason || '').replace(/^trust=\d+\/100;?\s*/, '').replace(/\s*trust=\d+\/100;\s*/g, ' ').trim(),
            txHash: c.txHash, block: c.block, paymentId: c.paymentId,
          };
        });
        out.sort((a, b) => b.block - a.block);
        if (alive) { setRows(out); setError(''); }
      } catch (e: any) { if (alive) setError(e.message || 'unreachable'); }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return { rows, error };
}

/** the hackers' registry: AuthorityRegistry's ThreatFlagged(bytes32 indexed subject, uint8 severity, string reason) */
const REGISTRY = '0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6';
const THREAT_FLAGGED = '0x9abb13be9a0053b631b6b00e953a4b28135079122d2812a1fde4ff9e63b60956';
type Threat = { subject: string; isAddress: boolean; severity: number; times: number; reason: string; block: number; tx: string };

function useThreats() {
  const [rows, setRows] = useState<Threat[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: REGISTRY, fromBlock: '0x0', toBlock: 'latest', topics: [THREAT_FLAGGED] }] }) });
        const logs: any[] = (await res.json()).result || [];
        const by = new Map<string, Threat>();
        for (const l of logs) {
          const subject: string = l.topics[1];
          const data = (l.data as string).slice(2);
          const severity = parseInt(data.slice(0, 64), 16);
          const off = parseInt(data.slice(64, 128), 16) * 2;
          const len = parseInt(data.slice(off, off + 64), 16) * 2;
          const bytes = data.slice(off + 64, off + 64 + len).match(/../g) || [];
          const reason = new TextDecoder().decode(new Uint8Array(bytes.map((h) => parseInt(h, 16)))).replace(/^trust=\d+\/100;?\s*/, '');
          const isAddress = /^0x0{24}/.test(subject);
          const key = isAddress ? '0x' + subject.slice(26) : subject;
          const prev = by.get(key);
          const block = parseInt(l.blockNumber, 16);
          const latest = !prev || block >= prev.block;
          by.set(key, { subject: key, isAddress, severity: Math.max(severity, prev ? prev.severity : 0), times: (prev ? prev.times : 0) + 1,
            reason: latest ? reason : prev!.reason, block: latest ? block : prev!.block, tx: latest ? l.transactionHash : prev!.tx });
        }
        if (alive) setRows([...by.values()].sort((a, b) => b.block - a.block));
      } catch { if (alive) setRows([]); }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return rows;
}

type Framework = 'hermes' | 'claude' | 'mcp';
type Agent = {
  id: string; name: string; framework: Framework; useCase: 'shopping' | 'finance' | 'api';
  issuer: string; perPayment: number; daily: number; currency: string; actions: string[]; recipients: string[]; humanAbove: number; createdAt: string;
};
const FRAMEWORK: Record<Framework, string> = { hermes: 'Hermès', claude: 'Claude', mcp: 'Any MCP client' };
const USECASE = { shopping: 'Shopping', finance: 'Finance', api: 'API payments (x402)' } as const;

function useAgents(userId?: string) {
  const key = userId ? `sentinel.agents.${userId}` : '';
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (!key) return;
    try { setAgents(JSON.parse(localStorage.getItem(key) || '[]')); } catch { setAgents([]); }
  }, [key]);
  const save = useCallback((next: Agent[]) => {
    setAgents(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window: kept for this visit only */ }
  }, [key]);
  return { agents, add: (a: Agent) => save([a, ...agents]), remove: (id: string) => save(agents.filter((a) => a.id !== id)) };
}

const newId = () => 'agt_' + Math.random().toString(36).slice(2, 8);
const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/* ---------- small pieces ---------- */

const VERDICT: Record<Verdict, { label: string; cls: string }> = { allow: { label: 'Approved', cls: 'ok' }, needs_human: { label: 'Held', cls: 'hu' }, block: { label: 'Blocked', cls: 'ko' } };
const Pill = ({ v }: { v: Verdict }) => <span className={`pill ${VERDICT[v].cls}`}><i />{VERDICT[v].label}</span>;

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn sm ghost" onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1300); }}>{done ? 'Copied' : label}</button>;
}

const ICON: Record<string, JSX.Element> = {
  overview: <path d="M4 13h6V4H4zm0 7h6v-5H4zm10 0h6V11h-6zm0-16v5h6V4z" />,
  agents: <><rect x="4" y="6" width="16" height="12" rx="3" /><path d="M9 11h.01M15 11h.01M9 15h6" /></>,
  transactions: <path d="M4 7h13l-3-3M20 17H7l3 3" />,
  approvals: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.3-4 4.3-6 8-6s6.7 2 8 6" /></>,
  registry: <><path d="M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z" /><path d="M9.5 9.5l5 5m0-5l-5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10l2 2M5 19l2-2m10-10l2-2" /></>,
  docs: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
  out: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
};
const Ico = ({ n }: { n: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[n]}</svg>;

/* ---------- the MCP config of an agent ---------- */

function mcpConfig(a: Agent, mode: 'local' | 'hosted') {
  if (a.framework === 'claude') {
    return mode === 'local'
      ? `// claude_desktop_config.json\n{\n  "mcpServers": {\n    "sentinel": {\n      "command": "python",\n      "args": ["mcp_server.py"],\n      "env": { "SENTINEL_AGENT": "${a.id}" }\n    }\n  }\n}`
      : `// claude_desktop_config.json\n{\n  "mcpServers": {\n    "sentinel": {\n      "url": "https://mcp.sentinel.example/v1",\n      "headers": { "Authorization": "Bearer \${SENTINEL_API_KEY}", "X-Sentinel-Agent": "${a.id}" }\n    }\n  }\n}`;
  }
  return mode === 'local'
    ? `# ${a.framework === 'hermes' ? 'Hermès · config.yaml' : 'your MCP client'}\nmcp_servers:\n  sentinel:\n    command: "python"\n    args: ["mcp_server.py"]   # from the Sentinel repo\n    env:\n      SENTINEL_AGENT: "${a.id}"`
    : `# ${a.framework === 'hermes' ? 'Hermès · config.yaml' : 'your MCP client'}\nmcp_servers:\n  sentinel:\n    url: "https://mcp.sentinel.example/v1"   # hosted endpoint, opening soon\n    headers:\n      Authorization: "Bearer \${SENTINEL_API_KEY}"\n      X-Sentinel-Agent: "${a.id}"`;
}

/* ---------- pages ---------- */

function Overview({ agents, mine, all, go, email }: { agents: Agent[]; mine: Decision[]; all: Decision[] | null; go: (p: string) => void; email?: string }) {
  const count = (rows: Decision[], v: Verdict) => rows.filter((r) => r.verdict === v).length;
  const steps = [
    { done: agents.length > 0, title: 'Create your first agent', text: 'Give it a mandate: what it may pay, to whom, how much.', go: 'agents' },
    { done: agents.length > 0, title: 'Plug it into Sentinel', text: 'Paste the MCP config into Hermès, Claude or your MCP client.', go: 'agents' },
    { done: mine.length > 0, title: 'Its first payment is checked', text: 'Every payment then shows up here, with its proof on Sentinel L1.', go: 'transactions' },
  ];
  return (
    <>
      <header className="ph"><div><p className="eb">Overview</p><h1>Welcome{email ? `, ${email.split('@')[0]}` : ''}</h1></div>
        <button className="btn" onClick={() => go('agents')}>New agent</button></header>
      <div className="kpis">
        <div className="kpi"><span>Your agents</span><b>{agents.length}</b></div>
        <div className="kpi"><span>Payments checked</span><b>{mine.length}</b></div>
        <div className="kpi"><span>Blocked</span><b className="ko">{count(mine, 'block')}</b></div>
        <div className="kpi"><span>Held for you</span><b className="hu">{count(mine, 'needs_human')}</b></div>
      </div>
      <div className="grid2">
        <section className="card">
          <h3>Get started</h3>
          <ol className="steps">{steps.map((s, i) => (
            <li key={i} className={s.done ? 'done' : ''} onClick={() => go(s.go)}><span className="n">{s.done ? '✓' : i + 1}</span><div><b>{s.title}</b><p>{s.text}</p></div></li>
          ))}</ol>
        </section>
        <section className="card">
          <h3>Sentinel L1 network</h3>
          {all ? (<>
            <div className="net">
              <div><b>{all.length}</b><span>decisions on-chain</span></div>
              <div><b className="ok">{count(all, 'allow')}</b><span>approved</span></div>
              <div><b className="hu">{count(all, 'needs_human')}</b><span>held</span></div>
              <div><b className="ko">{count(all, 'block')}</b><span>blocked</span></div>
            </div>
            <p className="mute">Every decision, from every Sentinel customer, written on our Avalanche L1. A scammer blocked once is refused for everyone.</p>
            <a className="btn sm ghost" href={EXPLORER} target="_blank" rel="noopener">Open the explorer →</a>
          </>) : <p className="mute">Reading Sentinel L1…</p>}
        </section>
      </div>
      <section className="card">
        <div className="row"><h3>Latest decisions {mine.length ? 'for your agents' : 'on Sentinel L1'}</h3><button className="btn sm ghost" onClick={() => go('transactions')}>All transactions →</button></div>
        <Table rows={(mine.length ? mine : all || []).slice(0, 6)} agents={agents} compact />
      </section>
    </>
  );
}

function Table({ rows, agents, compact = false }: { rows: Decision[]; agents: Agent[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const name = (issuer: string) => agents.find((a) => a.issuer.toLowerCase() === issuer)?.name || short(issuer);
  if (!rows.length) return <p className="empty">No decision yet.</p>;
  return (
    <div className="table">
      <div className="tr th"><span>Verdict</span><span>Trust</span><span>Agent</span><span>Recipient</span><span className="r">Amount</span>{!compact && <span>Block</span>}<span /></div>
      {rows.map((r) => (
        <div key={r.txHash + r.paymentId}>
          <div className="tr" onClick={() => setOpen(open === r.txHash ? null : r.txHash)}>
            <span><Pill v={r.verdict} /></span>
            <span className="mono">{r.trust ?? '—'}{r.trust != null && <em>/100</em>}</span>
            <span>{name(r.issuer)}</span>
            <span className="mono">{r.recipient ? short(r.recipient) : '—'}</span>
            <span className="mono r">{fmt(r.amount)}</span>
            {!compact && <span className="mono mute">#{r.block}</span>}
            <span className="r"><a className="lnk" href={`${EXPLORER}/tx/${r.txHash}`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>tx ↗</a></span>
          </div>
          {open === r.txHash && <div className="why"><b>Why</b>{r.reason || 'No signal: nothing held against this payment.'}<span className="mono mute">payment {short(r.paymentId)} · block #{r.block}</span></div>}
        </div>
      ))}
    </div>
  );
}

function Agents({ agents, add, remove, all, walletAddress }: { agents: Agent[]; add: (a: Agent) => void; remove: (id: string) => void; all: Decision[]; walletAddress?: string }) {
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const agent = agents.find((a) => a.id === sel);
  const demo = () => add({ id: newId(), name: 'Shopping agent (demo)', framework: 'hermes', useCase: 'shopping', issuer: DEMO_ISSUER, perPayment: 10000, daily: 30000,
    currency: 'EUR', actions: ['pay'], recipients: [], humanAbove: 0, createdAt: new Date().toISOString() });
  return (
    <>
      <header className="ph"><div><p className="eb">Agents</p><h1>Your agents</h1></div>
        <div className="row g8"><button className="btn ghost" onClick={demo}>Add the demo agent</button><button className="btn" onClick={() => setCreating(true)}>New agent</button></div></header>
      {!agents.length ? (
        <section className="card hero">
          <div className="badge">Hermès × Sentinel MCP</div>
          <h2>Create an agent, plug it into Sentinel, and every payment it makes is checked.</h2>
          <p className="mute">Your agent keeps working on its own. Sentinel sits in its MCP tools and stops what shouldn't leave.</p>
          <div className="row g8"><button className="btn" onClick={() => setCreating(true)}>Create my first agent</button><button className="btn ghost" onClick={demo}>Add the demo agent</button></div>
        </section>
      ) : (
        <div className="agents">{agents.map((a) => {
          const runs = all.filter((r) => r.issuer === a.issuer.toLowerCase());
          return (
            <button key={a.id} className={`agent ${sel === a.id ? 'on' : ''}`} onClick={() => setSel(a.id)}>
              <div className="row"><span className="av">{a.name.slice(0, 1).toUpperCase()}</span><span className={`dot ${runs.length ? 'live' : ''}`}>{runs.length ? 'Connected' : 'Waiting for its first call'}</span></div>
              <b>{a.name}</b>
              <span className="mute">{FRAMEWORK[a.framework]} · {USECASE[a.useCase]}</span>
              <div className="mini"><span>{runs.length} checked</span><span className="ko">{runs.filter((r) => r.verdict === 'block').length} blocked</span><span className="hu">{runs.filter((r) => r.verdict === 'needs_human').length} held</span></div>
            </button>
          );
        })}</div>
      )}
      {creating && <NewAgent onClose={() => setCreating(false)} onCreate={(a) => { add(a); setCreating(false); setSel(a.id); }} walletAddress={walletAddress} />}
      {agent && <AgentPanel a={agent} runs={all.filter((r) => r.issuer === agent.issuer.toLowerCase())} onClose={() => setSel(null)} onDelete={() => { remove(agent.id); setSel(null); }} />}
    </>
  );
}

function NewAgent({ onClose, onCreate, walletAddress }: { onClose: () => void; onCreate: (a: Agent) => void; walletAddress?: string }) {
  const [f, setF] = useState({ name: '', framework: 'hermes' as Framework, useCase: 'shopping' as Agent['useCase'], issuer: walletAddress || '', perPayment: 300, daily: 3000,
    currency: 'EUR', actions: ['pay'], recipients: '', humanAbove: 150 });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.name.trim() && /^0x[0-9a-fA-F]{40}$/.test(f.issuer.trim());
  const toggle = (act: string) => set('actions', f.actions.includes(act) ? f.actions.filter((x) => x !== act) : [...f.actions, act]);
  return (
    <div className="modal" onClick={onClose}><form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
      e.preventDefault(); if (!ok) return;
      onCreate({ id: newId(), name: f.name.trim(), framework: f.framework, useCase: f.useCase, issuer: f.issuer.trim(), perPayment: Number(f.perPayment), daily: Number(f.daily),
        currency: f.currency, actions: f.actions, recipients: f.recipients.split(/[\s,]+/).filter(Boolean), humanAbove: Number(f.humanAbove), createdAt: new Date().toISOString() });
    }}>
      <header className="row"><h2>New agent</h2><button type="button" className="x" onClick={onClose}>×</button></header>
      <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Treasury agent" autoFocus /></label>
      <div className="two">
        <label>Framework<select value={f.framework} onChange={(e) => set('framework', e.target.value)}>{Object.entries(FRAMEWORK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Use<select value={f.useCase} onChange={(e) => set('useCase', e.target.value)}>{Object.entries(USECASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label>Agent wallet (issuer)<input className="mono" value={f.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="0x…" />
        <small>{walletAddress && f.issuer === walletAddress ? 'Your Privy wallet. Use another address if the agent pays from its own.' : 'The address the agent pays from: Sentinel tracks its payments.'}</small></label>
      <p className="eb" style={{ marginTop: 6 }}>Mandate · read by Sentinel, never by the agent</p>
      <div className="three">
        <label>Max per payment<input type="number" min="0" value={f.perPayment} onChange={(e) => set('perPayment', e.target.value)} /></label>
        <label>Max per day<input type="number" min="0" value={f.daily} onChange={(e) => set('daily', e.target.value)} /></label>
        <label>Currency<select value={f.currency} onChange={(e) => set('currency', e.target.value)}><option>EUR</option><option>USDC</option><option>AVAX</option></select></label>
      </div>
      <div className="acts">{['pay', 'transfer', 'approve', 'swap'].map((x) => <label key={x} className={`tick ${f.actions.includes(x) ? 'on' : ''}`}><input type="checkbox" checked={f.actions.includes(x)} onChange={() => toggle(x)} />{x}</label>)}</div>
      <label>Allowed recipients <span className="mute">(optional)</span><textarea className="mono" rows={2} value={f.recipients} onChange={(e) => set('recipients', e.target.value)} placeholder="0x… or a merchant domain, one per line" /></label>
      <label>Ask a human above<input type="number" min="0" value={f.humanAbove} onChange={(e) => set('humanAbove', e.target.value)} /><small>Payments above this amount wait for your approval.</small></label>
      <footer className="row g8"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!ok}>Create agent</button></footer>
    </form></div>
  );
}

function AgentPanel({ a, runs, onClose, onDelete }: { a: Agent; runs: Decision[]; onClose: () => void; onDelete: () => void }) {
  const [mode, setMode] = useState<'local' | 'hosted'>('local');
  const cfg = mcpConfig(a, mode);
  return (
    <aside className="drawer">
      <header className="row"><div className="row g8"><span className="av lg">{a.name.slice(0, 1).toUpperCase()}</span><div><h2>{a.name}</h2><span className="mute">{FRAMEWORK[a.framework]} · {USECASE[a.useCase]} · <span className="mono">{a.id}</span></span></div></div><button className="x" onClick={onClose}>×</button></header>
      <section>
        <h3>Connect it to Sentinel</h3>
        <div className="seg"><button className={mode === 'local' ? 'on' : ''} onClick={() => setMode('local')}>Local · today</button><button className={mode === 'hosted' ? 'on' : ''} onClick={() => setMode('hosted')}>Hosted · soon</button></div>
        <pre className="code">{cfg}</pre>
        <div className="row g8"><Copy text={cfg} label="Copy config" /><span className="mute">{mode === 'local' ? 'Runs Sentinel\'s MCP server next to your agent.' : 'Your API key comes with the hosted endpoint.'}</span></div>
      </section>
      <section>
        <h3>Mandate</h3>
        <dl className="kv">
          <dt>Wallet</dt><dd className="mono">{short(a.issuer)} <Copy text={a.issuer} /></dd>
          <dt>Per payment</dt><dd>{fmt(a.perPayment)} {a.currency}</dd>
          <dt>Per day</dt><dd>{fmt(a.daily)} {a.currency}</dd>
          <dt>Actions</dt><dd>{a.actions.join(' · ') || '—'}</dd>
          <dt>Recipients</dt><dd>{a.recipients.length ? a.recipients.map(short).join(', ') : 'any, checked by Sentinel'}</dd>
          <dt>Human above</dt><dd>{a.humanAbove ? `${fmt(a.humanAbove)} ${a.currency}` : 'only when Sentinel is unsure'}</dd>
        </dl>
      </section>
      <section>
        <h3>Activity on Sentinel L1</h3>
        {runs.length ? <Table rows={runs.slice(0, 8)} agents={[a]} compact /> : <p className="empty">No payment yet. Plug the agent in: its first payment shows up here.</p>}
      </section>
      <footer><button className="btn ghost danger" onClick={onDelete}>Remove agent</button></footer>
    </aside>
  );
}

function Transactions({ mine, all, agents }: { mine: Decision[]; all: Decision[] | null; agents: Agent[] }) {
  const [scope, setScope] = useState<'mine' | 'all'>(mine.length ? 'mine' : 'all');
  const [v, setV] = useState<Verdict | 'any'>('any');
  const [q, setQ] = useState('');
  const base = scope === 'mine' ? mine : all || [];
  const rows = base.filter((r) => (v === 'any' || r.verdict === v) && (!q || [r.issuer, r.recipient, r.txHash, r.reason].join(' ').toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <header className="ph"><div><p className="eb">Transactions</p><h1>Every payment, checked</h1></div></header>
      <div className="filters">
        <div className="seg"><button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>My agents · {mine.length}</button><button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Sentinel L1 · {all?.length ?? '…'}</button></div>
        <div className="seg">{(['any', 'allow', 'needs_human', 'block'] as const).map((x) => <button key={x} className={v === x ? 'on' : ''} onClick={() => setV(x)}>{x === 'any' ? 'All' : VERDICT[x].label}</button>)}</div>
        <input className="search" placeholder="Search an address, a tx, a reason…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <section className="card flush">{scope === 'mine' && !agents.length ? <p className="empty">Create an agent to follow its payments here.</p> : <Table rows={rows} agents={agents} />}</section>
    </>
  );
}

function Approvals({ mine }: { mine: Decision[] }) {
  const held = mine.filter((r) => r.verdict === 'needs_human');
  return (
    <>
      <header className="ph"><div><p className="eb">Approvals</p><h1>Waiting for you</h1></div></header>
      <p className="lede">When Sentinel isn't sure, it doesn't guess: the payment waits for a human. Approve it, refuse it, or report a fraud: the scammer is then refused for every Sentinel customer.</p>
      {held.length ? held.map((r) => (
        <section key={r.txHash} className="card hold">
          <div className="row"><div className="row g8"><Pill v="needs_human" /><b className="mono">{fmt(r.amount)}</b><span className="mute">to</span><span className="mono">{short(r.recipient)}</span></div><span className="mono mute">trust {r.trust ?? '—'}/100 · #{r.block}</span></div>
          <p className="mute">{r.reason || 'Above your human-review amount.'}</p>
          <div className="row g8"><button className="btn sm" disabled title="Opens with the hosted MCP">Approve</button><button className="btn sm ghost" disabled>Refuse</button><button className="btn sm ghost danger" disabled>Report a fraud</button>
            <span className="mute">Answer from your agent's chat today; from here once the hosted MCP opens.</span></div>
        </section>
      )) : <section className="card"><p className="empty">Nothing waiting. Held payments from your agents appear here.</p></section>}
    </>
  );
}

function Registry() {
  const threats = useThreats();
  const [q, setQ] = useState('');
  const rows = (threats || []).filter((t) => t.isAddress && (!q || (t.subject + ' ' + t.reason).toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <header className="ph"><div><p className="eb">Registry</p><h1>Hackers' registry</h1></div></header>
      <p className="lede">Addresses Sentinel flagged, written on Sentinel L1 by the registry contract. Once an address is here, every agent of every customer refuses it at once.</p>
      <div className="filters"><input className="search" placeholder="Search an address or a reason…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="mute mono">{threats ? `${rows.length} addresses` : 'reading Sentinel L1…'}</span></div>
      <section className="card flush">{!threats ? <p className="empty">Reading Sentinel L1…</p> : rows.length ? (
        <div className="table">
          <div className="tr th reg"><span>Address</span><span>Severity</span><span className="r">Flagged</span><span>Last reason</span></div>
          {rows.map((t) => (
            <div className="tr reg" key={t.subject}>
              <span className="mono">{short(t.subject)} <a className="lnk" href={`${EXPLORER}/tx/${t.tx}`} target="_blank" rel="noopener">tx ↗</a></span>
              <span><span className={`pill ${t.severity >= 3 ? 'ko' : 'hu'}`}><i />severity {t.severity}</span></span>
              <span className="mono r">{t.times}×</span>
              <span className="mute clip" title={t.reason}>{t.reason}</span>
            </div>
          ))}
        </div>) : <p className="empty">No flagged address yet.</p>}</section>
    </>
  );
}

function Settings({ email, wallet, id, logout }: { email?: string; wallet?: string; id?: string; logout: () => void }) {
  return (
    <>
      <header className="ph"><div><p className="eb">Settings</p><h1>Account</h1></div></header>
      <section className="card">
        <dl className="kv">
          <dt>Email</dt><dd>{email || '—'}</dd>
          <dt>Wallet</dt><dd className="mono">{wallet || 'being created…'} {wallet && <Copy text={wallet} />}</dd>
          <dt>Network</dt><dd>Sentinel L1 · chainId 99999 · SEC</dd>
          <dt>Account id</dt><dd className="mono mute">{id}</dd>
        </dl>
        <p className="mute">Your wallet was created by Privy from your email: no extension, no seed phrase.</p>
      </section>
      <section className="card">
        <h3>API keys</h3>
        <p className="mute">Keys to call Sentinel's hosted MCP come with its opening. Today, plug your agents in locally (Agents → Connect it to Sentinel).</p>
      </section>
      <section className="card"><div className="row"><div><h3>Log out</h3><p className="mute">You can log back in with the same email: your wallet stays yours.</p></div><button className="btn ghost danger" onClick={logout}>Log out</button></div></section>
    </>
  );
}

/* ---------- the shell ---------- */

const PAGES = [['overview', 'Overview'], ['agents', 'Agents'], ['transactions', 'Transactions'], ['approvals', 'Approvals'], ['registry', 'Registry'], ['settings', 'Settings']] as const;

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
  const { agents, add, remove } = useAgents(user?.id);
  const issuers = new Set(agents.map((a) => a.issuer.toLowerCase()));
  const mine = (all || []).filter((r) => issuers.has(r.issuer));
  const email = user?.email?.address;
  const wallet = user?.wallet?.address;

  if (!ready) return <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><p className="mute">Loading…</p></div>;
  if (!authenticated) return (
    <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><h1>Sentinel</h1><p className="mute">Log in to see your agents and their payments.</p>
      <button className="btn lg" onClick={login}>Log in</button><a className="mute lnk" href={here('index.html')}>← Back to the site</a></div>
  );
  return (
    <div className="shell">
      <nav className="side">
        <a className="brand" href={here('index.html')}><img src={here('assets/logo-white.png')} alt="" />Sentinel<small>L1</small></a>
        <div className="ws"><span className="av">{(email || wallet || 'S').slice(0, 1).toUpperCase()}</span><div><b>{email || short(wallet)}</b><span className="mono">{wallet ? short(wallet) : 'wallet…'}</span></div></div>
        <div className="nav">{PAGES.map(([k, l]) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => go(k)}><Ico n={k} />{l}
            {k === 'agents' && agents.length > 0 && <em>{agents.length}</em>}
            {k === 'approvals' && mine.some((r) => r.verdict === 'needs_human') && <em className="hu">{mine.filter((r) => r.verdict === 'needs_human').length}</em>}</button>
        ))}</div>
        <div className="foot">
          <a href={here('index.html#start')}><Ico n="docs" />How it works</a>
          <a href={here('terms.html')} target="_blank" rel="noopener"><Ico n="docs" />Terms</a>
          <button onClick={logout}><Ico n="out" />Log out</button>
          <p className={`status ${error ? 'off' : ''}`}><i />{error ? 'Sentinel L1 unreachable' : 'Sentinel L1 live'}</p>
        </div>
      </nav>
      <main className="main">
        {page === 'overview' && <Overview agents={agents} mine={mine} all={all} go={go} email={email} />}
        {page === 'agents' && <Agents agents={agents} add={add} remove={remove} all={all || []} walletAddress={wallet} />}
        {page === 'transactions' && <Transactions mine={mine} all={all} agents={agents} />}
        {page === 'approvals' && <Approvals mine={mine} />}
        {page === 'registry' && <Registry />}
        {page === 'settings' && <Settings email={email} wallet={wallet} id={user?.id} logout={logout} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider appId={appId} config={privyConfig}><App /></PrivyProvider>
  </StrictMode>,
);
