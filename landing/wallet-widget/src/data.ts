import { useCallback, useEffect, useState } from 'react';

/* What the app and the ops console read from Sentinel L1, and the requests a user sends to Sentinel.
   The user's app only ever shows money, merchants, dates and plain reasons; the ops console shows the chain itself. */

export const API = 'https://rpc.petroi.fr';
export const EXPLORER = 'https://explorer.petroi.fr';
export const REGISTRY = '0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6';
const THREAT_FLAGGED = '0x9abb13be9a0053b631b6b00e953a4b28135079122d2812a1fde4ff9e63b60956';

/** the PoC's merchants and placements by wallet (agents/world.py ALL_SITES, agents/assets.py, data/domains.mock.json) */
const MERCHANTS: Record<string, string> = {
  '0x5e11e40000000000000000000000000000000002': 'Nimbus Store', '0x0c4a2d000000000000000000000000000000e1ec': 'Orchard Electronics',
  '0x3e21d1a400000000000000000000000000000c7b': 'Meridian Watch Co', '0x7ec4ba2a00000000000000000000000000000001': 'TechBazaar',
  '0x7e3b09f1000000000000000000000000000051a7': 'Tempo Wearables', '0x9b1dca11ce0000000000000000000000000d4ead': 'TurboStake Finance',
  '0x5e11e40000000000000000000000000000000003': 'RunStep', '0x9b1dca11ce000000000000000000000000ac5e77': 'AirMax Outlet',
  '0x7f00ab000000000000000000000000000beef016': 'iPhone Mega Deal', '0x5e11e40000000000000000000000000000000004': 'StagePass',
  '0xbada550000000000000000000000000000711c77': 'Ticket Resale Now', '0x5e11e4dead000000000000000000000000000002': 'CryptoCashback',
  '0x5e11e40000000000000000000000000000000001': 'StableHarbor', '0x40ba71e1d000000000000000000000000000f1a2': 'NovaYield',
  '0x5e11e4dead0000000000000000000000000d0001': 'StableHarb0r', '0x5e12e40000000000000000000000000000000001': 'Weather API',
};
export const merchantOf = (addr: string | null, fallback = 'Merchant under review') => (addr ? MERCHANTS[addr.toLowerCase()] || `Merchant ${addr.slice(2, 6).toUpperCase()}` : fallback);

/* ---------- decisions ---------- */

export type Verdict = 'allow' | 'block' | 'needs_human';
export type Decision = {
  verdict: Verdict; issuer: string; recipient: string | null; amount: number | null; trust: number | null;
  reason: string; signals: string[]; txHash: string; block: number; paymentId: string; at: number | null;
};

/** a guard reason ("id: evidence; id: evidence") as plain sentences for a user */
const PLAIN: Record<string, string> = {
  recipient_flagged_onchain: 'This merchant was already reported as a scam',
  new_merchant_first_payment: 'First payment to a brand-new merchant',
  domain_age_days: 'The shop\'s website was created very recently',
  amount_vs_history_zscore: 'Much more than this agent usually spends',
  amount_within_mandate: 'Above the agent\'s spending limit',
  imperative_to_agent: 'Hidden instructions aimed at your agent',
  override_lexicon: 'Text trying to override your agent\'s rules',
  mandate_override_attempt: 'Attempt to lift your agent\'s limits',
  hidden_text_ratio: 'Hidden text on the merchant\'s page',
  address_poisoning_similarity: 'Look-alike of a merchant you trust',
  approve_unlimited: 'Asked for unlimited access to your wallet',
  bank_detail_change_notice: 'Payment details changed',
  approval_claimed_in_data: 'The page pretends the payment is already approved',
  counterparty_unverified: 'Unknown merchant',
  brand_lookalike_score: 'Website imitating a known brand',
  invisible_unicode_count: 'Invisible characters in the content',
  urgency_secrecy_markers: 'Pressure to act fast or keep it secret',
  issuer_role_mismatch: 'Your agent isn\'t allowed to do this',
  action_not_in_mandate: 'Your agent isn\'t allowed to do this',
  recipient_whitelisted: 'Merchant not in your agent\'s allowed list',
};
export const plainReasons = (signals: string[]) => [...new Set(signals.map((id) => PLAIN[id]).filter(Boolean))];

/** the subject flagged at each block (ThreatFlagged), to name a refused payment's merchant */
async function flagsByBlock(): Promise<Map<number, string>> {
  const res = await fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: REGISTRY, fromBlock: '0x0', toBlock: 'latest', topics: [THREAT_FLAGGED] }] }) });
  const m = new Map<number, string>();
  for (const l of ((await res.json()).result || []) as any[]) {
    const subject: string = l.topics[1];
    if (/^0x0{24}/.test(subject)) m.set(parseInt(l.blockNumber, 16), '0x' + subject.slice(26));
  }
  return m;
}

export function useDecisions() {
  const [rows, setRows] = useState<Decision[] | null>(null);
  const [error, setError] = useState('');
  const [times, setTimes] = useState<Record<number, number>>({});
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}/cars`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const out: Decision[] = (d.cars || []).map((c: any) => {
          const reason: string = c.reason || '';
          const m = /trust=(\d+)\/100/.exec(reason);
          const clean = reason.replace(/trust=\d+\/100;?\s*/g, '').trim();
          const signals = [...clean.matchAll(/([a-z_]{6,}):/g)].map((x) => x[1]);
          const amt = c.amount ? Number(BigInt(c.amount) / 10n ** 16n) / 100 : (() => { const a = /amount (\d+(?:\.\d+)?)/.exec(reason); return a ? Number(a[1]) : null; })();
          return { verdict: c.verdict, issuer: (c.issuer || '').toLowerCase(), recipient: c.recipient ? c.recipient.toLowerCase() : null, amount: amt,
            trust: m ? Number(m[1]) : null, reason: clean, signals, txHash: c.txHash, block: c.block, paymentId: c.paymentId, at: null };
        });
        out.sort((a, b) => b.block - a.block);
        const flags = await flagsByBlock().catch(() => new Map<number, string>());
        for (const r of out) if (!r.recipient && r.verdict === 'block') r.recipient = flags.get(r.block - 1) || flags.get(r.block) || null;
        if (alive) { setRows(out); setError(''); }
      } catch (e: any) { if (alive) setError(e.message || 'unreachable'); }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  // each block's time, read once in one batched call
  useEffect(() => {
    if (!rows) return;
    const missing = [...new Set(rows.map((r) => r.block))].filter((b) => times[b] === undefined);
    if (!missing.length) return;
    fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(missing.map((b, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] }))) })
      .then((r) => r.json()).then((list: any[]) => {
        const t: Record<number, number> = {};
        for (const x of list) if (x?.result) t[parseInt(x.result.number, 16)] = parseInt(x.result.timestamp, 16) * 1000;
        setTimes((prev) => ({ ...prev, ...t }));
      }).catch(() => {});
  }, [rows]); // eslint-disable-line
  return { rows: rows && rows.map((r) => ({ ...r, at: times[r.block] ?? null })), error };
}

/* ---------- the hackers' registry (ops only) ---------- */

export type Threat = { subject: string; isAddress: boolean; severity: number; times: number; reason: string; block: number; tx: string };

export function useThreats() {
  const [rows, setRows] = useState<Threat[] | null>(null);
  const load = useCallback(async () => {
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
        const reason = new TextDecoder().decode(new Uint8Array(bytes.map((h) => parseInt(h, 16)))).replace(/trust=\d+\/100;?\s*/g, '').trim();
        const isAddress = /^0x0{24}/.test(subject);
        const key = isAddress ? '0x' + subject.slice(26) : subject;
        const prev = by.get(key);
        const block = parseInt(l.blockNumber, 16);
        const latest = !prev || block >= prev.block;
        by.set(key, { subject: key, isAddress, severity: Math.max(severity, prev ? prev.severity : 0), times: (prev ? prev.times : 0) + 1,
          reason: latest ? reason : prev!.reason, block: latest ? block : prev!.block, tx: latest ? l.transactionHash : prev!.tx });
      }
      setRows([...by.values()].sort((a, b) => b.block - a.block));
    } catch { setRows([]); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  return { rows, reload: load };
}

/* ---------- what a user asks Sentinel to do on a payment ---------- */

export type RequestKind = 'approve' | 'block' | 'report' | 'legit';
export type UserRequest = {
  id: string; kind: RequestKind; at: string; status: 'sent' | 'applied' | 'dismissed'; note?: string;
  userId: string; email?: string; agent: string; issuer: string; paymentId: string; merchant: string; recipient: string | null; amount: number | null; txHash: string;
};
export const REQUEST_LABEL: Record<RequestKind, string> = { approve: 'Approve', block: 'Block', report: 'Report fraud', legit: 'Mark as legit' };

/* Until Sentinel's operations API opens, a request is kept in this browser's shared queue, where the ops console of the
   same machine reads it. The ops team applies it on Sentinel L1. */
const QUEUE = 'sentinel.requests';
const read = (): UserRequest[] => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { return []; } };
const write = (all: UserRequest[]) => { try { localStorage.setItem(QUEUE, JSON.stringify(all)); } catch { /* private window */ } window.dispatchEvent(new Event('sentinel-requests')); };

export function useRequests() {
  const [all, setAll] = useState<UserRequest[]>(read);
  useEffect(() => {
    const f = () => setAll(read());
    addEventListener('storage', f); addEventListener('sentinel-requests', f);
    return () => { removeEventListener('storage', f); removeEventListener('sentinel-requests', f); };
  }, []);
  const send = (r: Omit<UserRequest, 'id' | 'at' | 'status'>) => write([{ ...r, id: 'req_' + Math.random().toString(36).slice(2, 9), at: new Date().toISOString(), status: 'sent' }, ...read()]);
  const settle = (id: string, status: UserRequest['status'], note?: string) => write(read().map((x) => (x.id === id ? { ...x, status, note } : x)));
  return { all, send, settle };
}

export const money = (n: number | null, cur = '€') => (n == null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);
export const when = (t: number | null) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…');
