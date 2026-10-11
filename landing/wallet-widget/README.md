# sentinel-auth.js - login wallet Privy pour la landing statique

La landing (`landing/index.html`) est en **HTML statique** et a déjà ses boutons d'auth (`data-auth="signin"` / `data-auth="signup"`). Ce widget les **câble à Privy** sans rien changer au markup : un seul `<script>` à ajouter.

## Intégration (2 choses)
1. Copier le fichier buildé `dist/sentinel-auth.js` (déjà copié dans `landing/sentinel-auth.js`) à la racine du déploiement de la landing.
2. Juste avant `</body>` dans `index.html` :
```html
<script id="sentinel-auth" data-privy-app-id="cmv3iedam01wy0fia8oa685mj" src="/sentinel-auth.js"></script>
```
C'est tout. Le widget :
- câble **tous** les `[data-auth]` de la page → clic = ouvre Privy (wallet externe ou email → wallet embarqué).
- une fois connecté, remplace le libellé des boutons par l'**adresse** (et "Sign in" devient "Déconnexion").
- thème sombre accordé au look Sentinel (accent rouge `#D7263D`, logo blanc).

## ⚠️ Dashboard Privy (sinon le login échoue)
Ajouter dans l'app Privy (`cmv3iedam01wy0fia8oa685mj`) les **domaines autorisés** : `http://localhost:*` (dev) + **`https://petroi.fr`** (prod).

## Rebuild (si on change le widget)
```bash
cd landing/wallet-widget
npm install --legacy-peer-deps
npm run build          # -> dist/sentinel-auth.js
cp dist/sentinel-auth.js ../sentinel-auth.js
```

## Source
`src/main.tsx` = un îlot React (React + `@privy-io/react-auth`) bundlé en IIFE, monté sur un div invisible, qui ne sert qu'à piloter les boutons existants. App ID lu depuis l'attribut `data-privy-app-id` du script (ou `window.SENTINEL_PRIVY_APP_ID`).

> Si Maxime passe la landing en React/Next, utiliser plutôt le kit `landing/privy/` (provider + composant), plus propre.
