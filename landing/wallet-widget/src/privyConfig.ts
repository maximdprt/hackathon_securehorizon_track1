import type { PrivyClientConfig } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import { avalanche, avalancheFuji } from 'viem/chains';

/* Privy, as both the landing's widget (main.tsx) and the app (app.tsx) use it: an email is enough, Privy creates the
   user's wallet on their first log-in, on Sentinel L1 by default. */

const script = (document.getElementById('sentinel-auth') || document.getElementById('sentinel-app')) as HTMLScriptElement | null;
export const appId: string = script?.dataset.privyAppId || (window as any).SENTINEL_PRIVY_APP_ID || 'cmv3iedam01wy0fia8oa685mj';
/** one of the landing's own files, wherever the landing is served from */
export const here = (path: string) => new URL(path, document.baseURI).href;

/** Sentinel L1, our Avalanche L1 */
export const sentinelL1 = defineChain({
  id: 99999,
  name: 'Sentinel L1',
  nativeCurrency: { name: 'SEC', symbol: 'SEC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.petroi.fr/rpc'] } },
  blockExplorers: { default: { name: 'SentinelScan', url: 'https://explorer.petroi.fr' } },
});

export const privyConfig: PrivyClientConfig = {
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
};

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
