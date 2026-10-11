import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import { avalanche, avalancheFuji } from 'viem/chains';

/* Sentinel's account on the static landing: Privy behind every [data-auth] button. An email is enough: Privy sends a
   code, and creates the user's wallet on their first log-in (an embedded wallet, no extension, no seed phrase).
   Built as one IIFE (vite.config.ts) and loaded by a single <script id="sentinel-auth" data-privy-app-id="…">. */

const script = document.getElementById('sentinel-auth') as HTMLScriptElement | null;
const appId = script?.dataset.privyAppId || (window as any).SENTINEL_PRIVY_APP_ID || 'cmv3iedam01wy0fia8oa685mj';
// the page's own files, wherever the landing is served from
const here = (path: string) => new URL(path, document.baseURI).href;

/** Sentinel L1, our Avalanche L1: the wallet's default chain */
const sentinelL1 = defineChain({
  id: 99999,
  name: 'Sentinel L1',
  nativeCurrency: { name: 'SEC', symbol: 'SEC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.petroi.fr/rpc'] } },
  blockExplorers: { default: { name: 'SentinelScan', url: 'https://explorer.petroi.fr' } },
});

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/** wires the landing's buttons: Log in opens Privy (or logs out once in); Get started / Connect Hermès open Privy on
    sign-up, and once in show the account card instead */
function AuthBridge({ onAccount }: { onAccount: () => void }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  useEffect(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-auth]'));
    const onClick = (e: Event) => {
      e.preventDefault();
      const kind = (e.currentTarget as HTMLElement).dataset.auth;
      if (!ready) return;
      if (!authenticated) return login();
      if (kind === 'signin') return void logout();
      onAccount();
    };
    btns.forEach((b) => {
      if (b.dataset.origLabel === undefined) b.dataset.origLabel = b.innerHTML;
      b.addEventListener('click', onClick);
      if (!authenticated) b.innerHTML = b.dataset.origLabel;
      else if (b.dataset.auth === 'signin') b.textContent = 'Log out';
      else b.innerHTML = `My wallet <span class="arr">${short(user?.wallet?.address) || '…'}</span>`;
    });
    return () => btns.forEach((b) => b.removeEventListener('click', onClick));
  }, [ready, authenticated, user, login, logout, onAccount]);
  return null;
}

/** the account card: who is in, and the wallet Privy created for them */
function Account({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { authenticated, user, logout } = usePrivy();
  const [copied, setCopied] = useState(false);
  const address = user?.wallet?.address;
  if (!authenticated || !open) return null;
  const copy = async () => {
    if (!address) return;
    await navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const s = STYLE;
  return (
    <div style={s.card} role="dialog" aria-label="Your Sentinel account">
      <button style={s.x} onClick={onClose} aria-label="Close">×</button>
      <div style={s.row}><img src={here('assets/logo-white.png')} alt="" style={{ width: 22, height: 22 }} /><b style={s.title}>Your Sentinel account</b></div>
      {user?.email?.address && <p style={s.line}><span style={s.k}>Email</span>{user.email.address}</p>}
      <p style={s.k}>Wallet · Sentinel L1</p>
      {address ? (
        <button style={s.addr} onClick={copy} title="Copy the address">{copied ? 'Copied' : address}</button>
      ) : (
        <p style={s.line}>Creating your wallet…</p>
      )}
      <p style={s.hint}>Created from your email by Privy: no extension, no seed phrase. Use it as your agent's identity on Sentinel L1.</p>
      <div style={s.row}>
        {address && <a style={s.btn} href={`https://explorer.petroi.fr/address/${address}`} target="_blank" rel="noopener">Explorer →</a>}
        <button style={{ ...s.btn, ...s.ghost }} onClick={() => { onClose(); logout(); }}>Log out</button>
      </div>
    </div>
  );
}

const STYLE: Record<string, React.CSSProperties> = {
  card: { position: 'fixed', right: 24, top: 76, zIndex: 50, width: 360, padding: '20px 20px 18px', borderRadius: 16, background: '#121620', color: '#E8EBF0',
    boxShadow: 'inset 0 0 0 1px #2A3440, 0 30px 80px -20px #000', fontFamily: 'Geist, Inter, system-ui, sans-serif' },
  x: { position: 'absolute', right: 10, top: 8, width: 30, height: 30, border: 0, borderRadius: 999, background: 'none', color: '#8E959F', fontSize: 20, cursor: 'pointer' },
  row: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 },
  title: { font: '600 16px Geist, system-ui, sans-serif' },
  k: { display: 'block', margin: '14px 0 6px', font: '500 11px "Geist Mono", ui-monospace, monospace', letterSpacing: '.14em', textTransform: 'uppercase', color: '#8E959F' },
  line: { margin: '4px 0 0', font: '400 14px Geist, system-ui, sans-serif', color: '#c9ced6', overflowWrap: 'anywhere' },
  addr: { width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: 0, cursor: 'pointer', background: '#07090D', color: '#E8EBF0',
    boxShadow: 'inset 0 0 0 1px #3FD08F55', font: '400 12.5px "Geist Mono", ui-monospace, monospace', overflowWrap: 'anywhere' },
  hint: { margin: '12px 0 14px', font: '400 12.5px/1.5 Geist, system-ui, sans-serif', color: '#8E959F' },
  btn: { display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 14px', borderRadius: 999, border: 0, cursor: 'pointer', background: '#E8EBF0', color: '#07090D',
    font: '500 13px Geist, system-ui, sans-serif', textDecoration: 'none' },
  ghost: { background: 'none', color: '#E8EBF0', boxShadow: 'inset 0 0 0 1px #2A3440' },
};

function App() {
  const [open, setOpen] = useState(false);
  const { authenticated, user } = usePrivy();
  // show the card once, right after a log-in, so the new wallet is seen
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    if (authenticated && user?.id && seen !== user.id) { setOpen(true); setSeen(user.id); }
    if (!authenticated) setOpen(false);
  }, [authenticated, user?.id, seen]);
  return (
    <>
      <AuthBridge onAccount={() => setOpen(true)} />
      <Account open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const mount = document.createElement('div');
mount.id = 'sentinel-auth-root';
document.body.appendChild(mount);
createRoot(mount).render(
  <StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#D7263D',
          logo: here('assets/logo-white.png'),
          landingHeader: 'Log in or create your account',
          loginMessage: 'Your email is enough: we create your wallet.',
          showWalletLoginFirst: false,
          walletChainType: 'ethereum-only',
        },
        loginMethods: ['email', 'wallet'],
        legal: { termsAndConditionsUrl: here('terms.html') },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: sentinelL1,
        supportedChains: [sentinelL1, avalancheFuji, avalanche],
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
);
