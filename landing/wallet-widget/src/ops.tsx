import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { appId, here, privyConfig, short } from './privyConfig';
import { API, EXPLORER, merchantOf, money, REQUEST_LABEL, useDecisions, useRequests, useThreats, when, type UserRequest, type Verdict } from './data';

/* Sentinel Ops (ops.html): the team's console. Users never see the chain; we do, and we act on it when something goes
   wrong. Three views: the users' requests (approve, block, report a fraud, mark as legit) with the on-chain action that
   answers each one, every decision on Sentinel L1 with its transaction, and the hackers' registry.
   Access: a Privy log-in whose email is in ops.html's data-ops-emails. That is a screen, not a lock: the write itself
   goes through POST /authorize, which has to be protected server-side (authorizer key, API auth) before production. */

const script = document.getElementById('sentinel-ops') as HTMLScriptElement | null;
const OPS_EMAILS = (script?.dataset.opsEmails || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const PREVIEW = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('preview');

const V: Record<Verdict, { label: string; cls: string }> = { allow: { label: 'allow', cls: 'ok' }, needs_human: { label: 'needs_human', cls: 'hu' }, block: { label: 'block', cls: 'ko' } };

/** the on-chain answer to a request: a flag for a reported or blocked recipient, a visa for an approved payment */
async function authorize(r: UserRequest, verdict: 'block' | 'allow') {
  const body = {
    payment: { issuer: r.issuer, recipient: r.recipient, amount: Math.round((r.amount || 0) * 100).toString() + '0'.repeat(16), nonce: Date.now() * 1000 },
    verdict, ttl: 300,
    reason: verdict === 'block' ? `ops: ${REQUEST_LABEL[r.kind].toLowerCase()} by the user (${r.id}) · ${r.merchant}` : `ops: approved by the user (${r.id}) · ${r.merchant}`,
    context: { issuer_label: r.agent, recipient_label: r.merchant, source: 'sentinel-ops', request: r.id },
  };
  const res = await fetch(`${API}/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.detail || `HTTP ${res.status}`);
  return out as { payment_id?: string; decision_tx?: string; flag_tx?: string; visa_tx?: string };
}

function Requests() {
  const { all, settle } = useRequests();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const run = async (r: UserRequest, verdict: 'block' | 'allow') => {
    if (!r.recipient) return setMsg((m) => ({ ...m, [r.id]: 'No recipient on record: act from the guard instead.' }));
    if (!confirm(`${verdict === 'block' ? 'Flag' : 'Grant a visa to'} ${short(r.recipient)} (${r.merchant}) on Sentinel L1? This writes on-chain.`)) return;
    setBusy(r.id);
    try {
      const out = await authorize(r, verdict);
      const tx = out.flag_tx || out.visa_tx || out.decision_tx;
      settle(r.id, 'applied', tx ? `on-chain ${verdict === 'block' ? 'flag' : 'visa'} ${tx}` : 'applied on-chain');
      setMsg((m) => ({ ...m, [r.id]: tx ? `Written: ${short(tx)}` : 'Written.' }));
    } catch (e: any) { setMsg((m) => ({ ...m, [r.id]: `Failed: ${e.message}` })); }
    setBusy(null);
  };
  const open = all.filter((r) => r.status === 'sent');
  return (
    <>
      <header className="ph"><div><p className="eb">Ops · requests</p><h1>Users' requests</h1></div><span className="mute mono">{open.length} open · {all.length} total</span></header>
      <p className="lede">What users asked on their payments. Answer each one on Sentinel L1: flag a reported or blocked recipient (every customer then refuses it), grant a visa to an approved payment. A cleared flag or a decision on a held payment in the guard is done with the registry owner's key, outside this console.</p>
      <section className="card flush">{all.length ? (
        <div className="table">
          <div className="tr th rq"><span>Request</span><span>User · agent</span><span>Merchant</span><span className="r">Amount</span><span>Status</span><span className="r">Act on Sentinel L1</span></div>
          {all.map((r) => (
            <div className="tr rq" key={r.id}>
              <span><span className={`pill ${r.kind === 'approve' || r.kind === 'legit' ? 'ok' : 'ko'}`}><i />{REQUEST_LABEL[r.kind]}</span><small className="mono mute">{when(Date.parse(r.at))}</small></span>
              <span className="clip">{r.email || r.userId}<small className="mute">{r.agent}</small></span>
              <span className="clip">{r.merchant}<small className="mono mute">{r.recipient ? short(r.recipient) : '—'}</small></span>
              <span className="mono r">{money(r.amount)}</span>
              <span className="clip">{r.status === 'sent' ? <span className="hu">open</span> : r.status === 'applied' ? <span className="ok">applied</span> : <span className="mute">dismissed</span>}
                {(msg[r.id] || r.note) && <small className="mono mute">{msg[r.id] || r.note}</small>}</span>
              <span className="r acts">{r.status === 'sent' && (<>
                {(r.kind === 'report' || r.kind === 'block') && <button className="btn xs danger-solid" disabled={busy === r.id} onClick={() => run(r, 'block')}>{busy === r.id ? 'Writing…' : 'Flag on-chain'}</button>}
                {r.kind === 'approve' && <button className="btn xs" disabled={busy === r.id} onClick={() => run(r, 'allow')}>{busy === r.id ? 'Writing…' : 'Grant visa'}</button>}
                {r.kind === 'legit' && <button className="btn xs ghost" onClick={() => settle(r.id, 'applied', 'merchant allowed for this agent')}>Mark applied</button>}
                <button className="btn xs ghost" onClick={() => settle(r.id, 'dismissed')}>Dismiss</button></>)}
                <a className="lnk" href={`${EXPLORER}/tx/${r.txHash}`} target="_blank" rel="noopener">tx ↗</a></span>
            </div>
          ))}
        </div>) : <p className="empty">No request yet. Requests from the app (on this machine) appear here until the operations API opens.</p>}</section>
    </>
  );
}

function Decisions() {
  const { rows } = useDecisions();
  const [v, setV] = useState<Verdict | 'any'>('any');
  const [q, setQ] = useState('');
  const list = (rows || []).filter((r) => (v === 'any' || r.verdict === v) && (!q || [r.issuer, r.recipient, r.txHash, r.paymentId, r.reason].join(' ').toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <header className="ph"><div><p className="eb">Ops · Sentinel L1</p><h1>Every decision on-chain</h1></div><span className="mute mono">{rows ? `${rows.length} decisions` : 'reading…'}</span></header>
      <div className="filters"><div className="seg">{(['any', 'allow', 'needs_human', 'block'] as const).map((x) => <button key={x} className={v === x ? 'on' : ''} onClick={() => setV(x)}>{x === 'any' ? 'All' : x}</button>)}</div>
        <input className="search" placeholder="Search an address, a tx, a payment id, a signal…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <section className="card flush"><div className="table">
        <div className="tr th dc"><span>Block</span><span>Verdict</span><span>Trust</span><span>Issuer</span><span>Recipient</span><span className="r">Amount</span><span>Signals</span><span className="r">Tx</span></div>
        {list.map((r) => (
          <div className="tr dc" key={r.txHash + r.paymentId}>
            <span className="mono">#{r.block}<small className="mute">{when(r.at)}</small></span>
            <span><span className={`pill ${V[r.verdict].cls}`}><i />{V[r.verdict].label}</span></span>
            <span className="mono">{r.trust ?? '—'}</span>
            <span className="mono">{short(r.issuer)}</span>
            <span className="mono clip">{r.recipient ? `${short(r.recipient)} · ${merchantOf(r.recipient)}` : '—'}</span>
            <span className="mono r">{r.amount != null ? r.amount.toFixed(2) : '—'}</span>
            <span className="mute clip" title={r.reason}>{r.signals.join(', ') || '—'}</span>
            <span className="r"><a className="lnk mono" href={`${EXPLORER}/tx/${r.txHash}`} target="_blank" rel="noopener">{r.txHash.slice(0, 8)}… ↗</a></span>
          </div>
        ))}
      </div></section>
    </>
  );
}

function Registry() {
  const { rows } = useThreats();
  const list = (rows || []).filter((t) => t.isAddress);
  return (
    <>
      <header className="ph"><div><p className="eb">Ops · registry</p><h1>Hackers' registry</h1></div><span className="mute mono">{rows ? `${list.length} addresses` : 'reading…'}</span></header>
      <p className="lede">ThreatFlagged events of AuthorityRegistry ({short('0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6')}). A flag at severity 3 refuses the address for every customer.</p>
      <section className="card flush"><div className="table">
        <div className="tr th reg"><span>Address</span><span>Severity</span><span className="r">Flagged</span><span>Last reason</span></div>
        {list.map((t) => (
          <div className="tr reg" key={t.subject}>
            <span className="mono">{short(t.subject)} · {merchantOf(t.subject)} <a className="lnk" href={`${EXPLORER}/tx/${t.tx}`} target="_blank" rel="noopener">↗</a></span>
            <span><span className={`pill ${t.severity >= 3 ? 'ko' : 'hu'}`}><i />severity {t.severity}</span></span>
            <span className="mono r">{t.times}×</span>
            <span className="mute clip" title={t.reason}>{t.reason}</span>
          </div>
        ))}
      </div></section>
    </>
  );
}

const PAGES = [['requests', 'Requests'], ['decisions', 'Decisions'], ['registry', 'Registry']] as const;

function Ops() {
  const privy = usePrivy();
  const { ready, authenticated, user, login, logout } = PREVIEW ? { ...privy, ready: true, authenticated: true, user: { email: { address: 'ops@example.com' } } as any } : privy;
  const [page, setPage] = useState(() => location.hash.slice(1) || 'requests');
  useEffect(() => { const f = () => setPage(location.hash.slice(1) || 'requests'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const { all } = useRequests();
  const email = (user?.email?.address || '').toLowerCase();
  if (!ready) return <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><p className="mute">Loading…</p></div>;
  if (!authenticated) return <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><h1>Sentinel Ops</h1><p className="mute">For Sentinel's team.</p><button className="btn lg" onClick={login}>Log in</button></div>;
  if (!PREVIEW && !OPS_EMAILS.includes(email)) return (
    <div className="gate"><img src={here('assets/logo-white.png')} alt="" /><h1>Not on the team</h1>
      <p className="mute">{email || 'This account'} isn't allowed in Sentinel Ops.<br />Add it to <span className="mono">data-ops-emails</span> in ops.html.</p>
      <button className="btn ghost" onClick={logout}>Log out</button></div>
  );
  return (
    <div className="shell">
      <nav className="side">
        <a className="brand" href={here('index.html')}><img src={here('assets/logo-white.png')} alt="" />Sentinel<small>OPS</small></a>
        <div className="ws"><span className="av">{(email || 'O').slice(0, 1).toUpperCase()}</span><div><b>{email}</b><span className="mono">Sentinel team</span></div></div>
        <div className="nav">{PAGES.map(([k, l]) => (
          <button key={k} className={page === k ? 'on' : ''} onClick={() => { location.hash = k; setPage(k); }}>{l}
            {k === 'requests' && all.some((r) => r.status === 'sent') && <em className="hu">{all.filter((r) => r.status === 'sent').length}</em>}</button>
        ))}</div>
        <div className="foot">
          <a href={EXPLORER} target="_blank" rel="noopener">Explorer ↗</a>
          <a href="https://city.petroi.fr/" target="_blank" rel="noopener">3D city ↗</a>
          <button onClick={logout}>Log out</button>
        </div>
      </nav>
      <main className="main">
        {page === 'requests' && <Requests />}
        {page === 'decisions' && <Decisions />}
        {page === 'registry' && <Registry />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider appId={appId} config={privyConfig}><Ops /></PrivyProvider>
  </StrictMode>,
);
