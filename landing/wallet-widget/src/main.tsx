import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { appId, here, privyConfig } from './privyConfig';

/* Sentinel's account on the static landing: Privy behind every [data-auth] button. An email is enough: Privy sends a
   code and creates the user's wallet on their first log-in. Once logged in, the user lands in the app (app.html).
   Built as one IIFE (vite.config.ts) and loaded by a single <script id="sentinel-auth" data-privy-app-id="…">. */

const APP = here('app.html');

function AuthBridge() {
  const { ready, authenticated } = usePrivy();
  // a fresh log-in takes the user to their app
  const { login } = useLogin({ onComplete: ({ wasAlreadyAuthenticated }) => { if (!wasAlreadyAuthenticated) window.location.href = APP; } });
  useEffect(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-auth]'));
    const onClick = (e: Event) => {
      e.preventDefault();
      if (!ready) return;
      if (authenticated) window.location.href = APP;
      else login();
    };
    btns.forEach((b) => {
      if (b.dataset.origLabel === undefined) b.dataset.origLabel = b.innerHTML;
      b.addEventListener('click', onClick);
      b.innerHTML = authenticated ? `Open app <span class="arr">→</span>` : b.dataset.origLabel;
    });
    return () => btns.forEach((b) => b.removeEventListener('click', onClick));
  }, [ready, authenticated, login]);
  return null;
}

const mount = document.createElement('div');
mount.id = 'sentinel-auth-root';
document.body.appendChild(mount);
createRoot(mount).render(
  <StrictMode>
    <PrivyProvider appId={appId} config={privyConfig}>
      <AuthBridge />
    </PrivyProvider>
  </StrictMode>,
);
