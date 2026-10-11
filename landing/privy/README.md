# Kit Privy - login wallet pour la landing (petroi.fr)

Petit client Privy prêt à brancher dans la landing page (Next.js / React). Login par **wallet** (MetaMask, Rabby, WalletConnect…) ou **email** (wallet embarqué créé auto). Le wallet connecté peut servir d'**identité de l'agent / issuer** côté SentinelL1.

## 1. Installer
```bash
npm i @privy-io/react-auth @privy-io/server-auth
```

## 2. Variables d'env (déjà dans le `.env` du repo, ne pas committer le secret)
```
NEXT_PUBLIC_PRIVY_APP_ID=cmv3iedam01wy0fia8oa685mj     # client (public)
PRIVY_APP_ID=cmv3iedam01wy0fia8oa685mj                 # serveur
PRIVY_APP_SECRET=***                                   # serveur UNIQUEMENT, jamais client
PRIVY_JWKS_URL=https://auth.privy.io/api/v1/apps/cmv3iedam01wy0fia8oa685mj/jwks.json
```

## 3. Brancher (Next.js App Router)
`app/layout.tsx` :
```tsx
import PrivyProviderWrapper from '@/privy/PrivyProviderWrapper';

export default function RootLayout({ children }) {
  return (
    <html><body>
      <PrivyProviderWrapper>{children}</PrivyProviderWrapper>
    </body></html>
  );
}
```
Dans le header / le CTA de la landing :
```tsx
import ConnectWallet from '@/privy/ConnectWallet';
// ...
<ConnectWallet />
```

## 4. Vérifier côté serveur (optionnel, pour gated/identité)
```ts
import { verifyPrivyToken, getUserWallet } from '@/privy/verifyPrivyToken';

// dans une API route / server action :
const claims = await verifyPrivyToken(token);   // token = access token Privy du client
if (!claims) return new Response('unauthorized', { status: 401 });
const wallet = await getUserWallet(claims.userId);   // l'adresse du user, à utiliser comme issuer SentinelL1
```

## 5. ⚠️ À faire dans le dashboard Privy (sinon le login échoue)
Ajouter les **domaines autorisés** de l'app Privy : `http://localhost:3000` (dev) + **`https://petroi.fr`** (prod). Sans ça, Privy refuse l'origine.

## 6. Logo
Mettre `sentinel-logo.png` (fourni dans `landing/`) dans le `public/` de la landing : il sert de favicon + de logo dans la modale Privy (`https://petroi.fr/sentinel-logo.png`).

## Notes
- Le composant `ConnectWallet` est auto-stylé (look Sentinel, pas besoin de CSS externe).
- `verifyPrivyToken.ts` est **server-only** (il utilise `PRIVY_APP_SECRET`). Ne jamais l'importer dans un composant client.
- Si la landing n'est pas en React/Next, me le dire : Privy a un SDK core/headless, j'adapte.
