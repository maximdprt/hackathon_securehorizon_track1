# Sentinel — Pitch 4 minutes

**Accroche (20 s)** — « J'ai créé un agent IA connecté à mon wallet pour qu'il achète et investisse à ma place. Le problème : si on lui glisse un document ou une page piégée, il paie un escroc **tout seul**, et je perds mon wallet. C'est le problème 2 du Track 01, et c'est déjà réel (Scamlexity). »

**Le trou (30 s)** — Un agent a le pouvoir de signer et agit seul sur ce qu'il lit. Qui contrôle ses entrées contrôle ses paiements : prompt injection, tool poisoning, confusion d'autorité (OWASP ASI03/ASI07). **Personne ne vérifie qui a le droit de donner l'ordre, ni si l'ordre est piégé.**

**La solution (40 s)** — Sentinel : un **garde de vérification devant chaque paiement d'agent**. Avant la signature, on vérifie **l'autorité** (lecture on-chain : cet émetteur a-t-il le droit ?) et **l'intention** (7 couches de signaux + Claude : l'ordre est-il injecté ?). Verdict : **visa** si OK, **refus + flag** si arnaque, **humain** si doute. Chaque décision est une **preuve inviolable sur notre L1 Avalanche**.

**Démo (90 s)** — *le chemin doré, voir golden-path-demo.md* :
1. **Agent vidé** : garde OFF, l'agent se fait piéger, paie l'escroc.
2. **Agent sauvé** : garde ON, même attaque → **BLOCK**, visa refusé, flag on-chain. Dans la ville, la voiture fait demi-tour. On ouvre la carte d'analyse : score, signaux, motif — tout est explicable.
3. **2e agent immunisé** : un autre agent vise la même adresse → **refus direct** (registre on-chain). La protection est collective.

**Preuves (30 s)** — Détection **100 %**, faux positifs **0 %** ; batterie **100/100** (10 stratégies × 10) ; évasion **814 essais, 0 faille** ; latence **~1,4 ms**. 20 transactions réelles vérifiables dans l'explorateur. Honnête : chaque test est rejouable, on a trouvé et corrigé nos propres failles (ex. évasion ROT13).

**Pourquoi ça gagne (20 s)** — Marche pour le **shopping** ET la **finance/crypto** (même garde, zéro modification). Conforme **DORA / MiCA / AML / AI Act** par conception (trace on-chain + human-in-the-loop). Sur **Avalanche** (requis), avec **ERC-8004** + **x402**.

**Clôture (10 s)** — « L'agent fait ce qu'on lui demande. Sentinel s'assure qu'il ne fait pas ce qu'un escroc lui demande. »
