import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';

const appId =
  (document.getElementById('sentinel-auth') as HTMLScriptElement | null)?.dataset.privyAppId ||
  (window as any).SENTINEL_PRIVY_APP_ID ||
  'cmv3iedam01wy0fia8oa685mj';

function short(a?: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''; }

// Wires every [data-auth] button in the static landing to Privy (no markup change needed).
function AuthBridge() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  useEffect(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-auth]'));
    const onClick = (e: Event) => { e.preventDefault(); authenticated ? logout() : login(); };
    btns.forEach((b) => b.addEventListener('click', onClick));
    // reflect state on the buttons
    const addr = user?.wallet?.address;
    const label = short(addr) || user?.email?.address || 'Connecté';
    btns.forEach((b) => {
      if (!b.dataset.origLabel) b.dataset.origLabel = b.textContent || '';
      if (authenticated) b.textContent = b.dataset.auth === 'signin' ? 'Déconnexion' : label;
      else b.textContent = b.dataset.origLabel;
    });
    return () => btns.forEach((b) => b.removeEventListener('click', onClick));
  }, [ready, authenticated, user, login, logout]);
  return null;
}

const mount = document.createElement('div');
mount.id = 'sentinel-auth-root';
document.body.appendChild(mount);
createRoot(mount).render(
  <StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: 'dark', accentColor: '#D7263D', logo: '/assets/logo-white.png', walletChainType: 'ethereum-only' },
        loginMethods: ['wallet', 'email'],
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
      }}
    >
      <AuthBridge />
    </PrivyProvider>
  </StrictMode>,
);
