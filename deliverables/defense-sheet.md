# Sentinel — Defense Sheet (1 page)

**ESSECKATHON Secure Horizons · Track 01 Fintech Security · Équipe 2**
Un garde de vérification devant tout paiement d'agent IA : avant qu'un agent ne paie, on vérifie **l'autorité** (qui a le droit d'ordonner) et **l'intention** (l'ordre est-il piégé), on délivre un **visa on-chain** si OK, on refuse et on **flag** si c'est une arnaque, on **escalade à un humain** en cas de doute. Chaque décision est une **preuve inviolable sur Avalanche**.

## La menace (réponse directe au problème 2 du Track 01)
> *« a low-privilege agent, fed a booby-trapped document, tells a financial agent to execute a payment. Without authority-chain checks, it goes through. »*

- **OWASP ASI03 — Privilege / authority compromise** : un agent peu privilégié (lecteur) déclenche un paiement qu'il n'a pas le droit d'ordonner.
- **OWASP ASI07 — Agent / tool misuse** : une instruction injectée (document, page, autre agent) détourne l'outil de paiement.
- **Scamlexity** : un agent de shopping achète sur un faux site et livre les données de paiement.
- Vecteurs couverts : injection indirecte (HTML caché, PDF, mail), tool poisoning (MCP), confusion d'autorité, address poisoning, « trésorerie migrée » (ingénierie sociale), encodage (base64/hex/url/ROT13), homoglyphes, unicode invisible, dépassement de mandat, contrepartie frauduleuse (domaine neuf, marque sosie, honeypot).

## La parade : `verify_payment` (le garde)
Pipeline pur, explicable, avant la signature : **sanitisation** (HTML caché, unicode invisible, blobs encodés) → **7 couches de signaux** (contenu, mandat, autorité on-chain, contrepartie, transaction, outils, comportement) → **blocs durs** → **Claude (Bedrock) pour l'intention/injection** → **score de confiance dégressif** (part de 100, OU bruité `1 − ∏(1−poids)`, bloc dur = 0) → **seuils** `allow ≥ 70 · humain 30–70 · block < 30` → file humaine + journal + **registre de menaces on-chain**. Le mandat est **résolu côté serveur**, jamais déclaré par l'agent. Une adresse flaguée → **refus direct** la fois suivante (lecture on-chain, `ChainSource`).

## Cadres
| Cadre | Couverture |
|---|---|
| **NIST CSF** | Identify (mandats/autorités) · **Protect** (visa à usage unique, vault gardé) · **Detect** (7 couches + Claude) · **Respond** (block + flag + escalade humaine) · Recover (trace on-chain, incident DORA) |
| **OWASP ASI** | ASI03 (authority-chain on-chain) · ASI07 (détection d'injection/tool poisoning) |
| **MITRE ATLAS** | Prompt injection indirecte, évasion (encodage/obfuscation), manipulation d'agent |

## Preuves (chiffres réels, reproductibles)
- **Détection 100 %** (23 attaques) · **Faux positifs 0 %** (52 contrôles) — `redteam/run.py`.
- **Batterie 100/100** : 10 stratégies × 10, shopping + finance — 90/90 pièges, 0/10 faux positifs — `redteam/battery100.py`.
- **Évasion** : 814 essais (casse, espaces, homoglyphes, unicode, base64/hex/url/ROT13, langues, split) → **100 % détection, 0 gap** — `redteam/evasion.py`.
- **Latence** : ~0,8 ms (heuristiques seules) · ~3 s (avec Claude).
- **Bout-en-bout on-chain** : 20 transactions (shopping + finance) → 20/20 verdicts justes, 20/20 minées, visibles dans l'explorateur et la ville 3D — `redteam/validate_onchain.py`.
- **156+ tests** (moteur, sanitizer, fuzzing, protocole MCP, e2e chaîne).

## On-chain (Avalanche SentinelL1 · chainId 99999 · token SEC)
`AuthorityRegistry 0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6` (autorité + flags + visa) · `GuardedVault 0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0` (paiement gardé : pas de visa valide = revert). API `https://rpc.petroi.fr` · Explorer `https://explorer.petroi.fr` · Ville 3D `https://city.petroi.fr`. Protocoles : **ERC-8004** (registre d'agents) + **x402** (paiement IA-à-IA).

## Limites (honnêtes)
- Le jugement d'intention fin dépend de Claude ; sans LLM, on **ne devine jamais `allow`** (plancher humain).
- La mémoire des menaces est on-chain (durable) ; le jugement reste **par transaction** (pas de corrélation multi-tx avancée encore).
- L'exécution réelle du paiement (`GuardedVault.pay`) exige un wallet agent autorisé + approvisionné (fait côté L1).
- Un adversaire peut toujours inventer une stratégie inédite : on mesure et on recalibre en continu (banc de tests honnête, aucune triche).
