# Sentinel : le garde des paiements d'agents IA

> **ESSECKATHON Secure Horizons · Track 01 Fintech Security.** Un pare-feu qui vérifie *qui a le droit de payer* avant qu'un
> agent IA n'exécute un paiement, délivre un **visa on-chain** si c'est légitime, bloque si c'est une arnaque, escalade à un
> humain en cas de doute. Chaque décision est **prouvée et rejouable** sur notre blockchain Avalanche (audit DORA / MiCA).

| Démo live | URL |
|---|---|
| 🌐 Landing + dashboard (login, crée un agent, récupère sa clé) | **https://petroi.fr** · **https://petroi.fr/app** |
| 🤖 Agents de démo (shopping + IA-à-IA) | **https://agents.petroi.fr** |
| 🏙️ Ville 3D (transactions = voitures) | **https://city.petroi.fr** |
| 🔎 Explorer de blocs (SentinelScan) | **https://explorer.petroi.fr** |
| 🔌 API / RPC du garde | **https://rpc.petroi.fr** (`GET /health`) |

### 📦 Repos produit open-source (MIT)

| Repo | Quoi |
|---|---|
| **[sentinel-guard](https://github.com/walidb212/sentinel-guard)** | Le **garde** : serveur MCP à brancher sur n'importe quel agent (Claude, Cursor, Hermès) en une ligne `uvx`. Screene chaque paiement, répond `allow` / `needs_approval` / `block`. |
| **[secure-agent-starter](https://github.com/walidb212/secure-agent-starter)** | L'**agent de référence "Jarvis"** clé-en-main : clone, `uv run`, et regarde un agent se faire bloquer sur une arnaque (garde câblé dans le wallet). |

```bash
# Essayer en 30 s : l'agent se fait piéger, le garde bloque avant la signature
git clone https://github.com/walidb212/secure-agent-starter && cd secure-agent-starter
uv run secure-agent run shopping --variant scam --guard off --offline   # sans garde : paie 500 USDC à l'arnaque
uv run secure-agent run shopping --variant scam --offline               # avec garde : bloqué
```

---

## 1. Le problème

Un agent IA a le pouvoir de signer des paiements et agit seul sur ce qu'il lit (documents, pages web, autres agents), sans
jugement humain. **Qui contrôle ses entrées contrôle son argent.**

> Track 01, problème 2 : *« un agent à faibles privilèges, nourri d'un document piégé, dit à un agent financier d'exécuter un
> paiement. Sans vérification de la chaîne d'autorité, ça passe. »* (OWASP **ASI03** prompt injection, **ASI07** confusion
> d'autorité). Cas réel : **Scamlexity**, un agent achète sur un faux site et livre les infos de paiement.

Le vrai trou : **personne ne vérifie qui a le droit de donner l'ordre.** Sentinel comble ce trou.

## 2. Comment ça marche (le flux)

```
  Agent IA veut payer
        │
        ▼
  ┌──────────────────────────── LE GARDE (décision) ────────────────────────────┐
  │  sanitisation (HTML caché, Unicode invisible, base64)                        │
  │  → 7 couches de signaux (contenu · mandat · autorité · contrepartie ·        │
  │     transaction · outils · comportement)                                     │
  │  → blocs durs  → fusion Claude (Bedrock)  → score de confiance 0..100        │
  └──────────────────────────────────────────────────────────────────────────────┘
        │
   verdict ├─ confiance ≥ 70  → ALLOW   → visa on-chain (usage unique) → paiement exécuté
           ├─ 30 à 70         → HUMAIN  → se met en file, un humain tranche
           └─ confiance < 30  → BLOCK   → adresse flaggée au registre, refus direct la 2e fois
        │
        ▼
  Tout écrit sur SentinelL1 : une décision = une preuve inviolable, horodatée, rejouable (DORA / MiCA)
```

Point clé : **l'enforcement est dans l'EVM** (contrat `GuardedVault`), pas dans le code de l'agent. Un agent compromis ne
peut pas payer sans visa valide. C'est **fail-closed** : en cas de doute, rien ne part.

## 3. Architecture

| Brique | Rôle | Techno | Où |
|---|---|---|---|
| **Le garde** | sanitisation + scoring multi-couches + décision | Python, serveur MCP, Claude Bedrock | `guard/`, `mcp_server.py` |
| **Les agents** | 2 vrais agents (shopping + paiement x402) avec le garde devant le wallet | Bedrock Haiku, tool use | `agents/` (AWS Lambda) |
| **Les contrats** | `AuthorityRegistry` (autorité + flags + visa) · `GuardedVault` (paiement gardé) | Solidity, Subnet-EVM | `contracts/` |
| **La chaîne** | SentinelL1, Avalanche L1 (ACP-77), chainId **99999**, token SEC | avalanchego 1.15.1 + subnet-evm | AWS EC2 |
| **L'API on-chain** | reçoit le verdict → écrit visa / flag / pending → renvoie les preuves (tx) | FastAPI, web3 | `api/` |
| **L'explorer** | lecture bloc par bloc, chaque décision vérifiable | SvelteKit (SentinelScan) | `explorer/` |
| **La ville 3D** | le wow démo : chaque transaction = une voiture au péage | Next.js, React Three Fiber | `ui3d-city/` |
| **La compliance** | DORA / MiCA / AML / AI Act + fiche défense + dashboard KPI | Markdown, HTML | `deliverables/` |

**Contrats déployés (LIVE sur SentinelL1)** :
- `AuthorityRegistry` : `0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6`
- `GuardedVault` : `0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0`

## 4. Installation

Prérequis : **Python ≥ 3.11**. Pour le garde seul, aucune clé AWS n'est requise (mode heuristiques).

```bash
git clone https://github.com/maximdprt/hackathon_securehorizon_track1
cd hackathon_securehorizon_track1
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e .                                        # garde + serveur MCP
cp .env.example .env                                    # puis remplir si besoin (voir §6)
```

**Lancer le garde en 30 secondes** (heuristiques, sans AWS) :
```bash
GUARD_LLM=off python redteam/run.py          # 21 scénarios d'attaque → détection 100 %, faux positifs 0 %
```

**Avec la fusion IA** (nécessite des creds AWS Bedrock, région us-west-2) :
```bash
GUARD_LLM=on python redteam/run.py
```

**Le serveur MCP** (3 outils : `verify_payment`, `list_pending`, `approve_pending`) :
```bash
python mcp_server.py
```

**Options utiles** : `pip install -e ".[chain]"` (tests EVM in-process), `pip install -e ".[dev]"` (pytest).

## 5. Résultats (reproductibles)

| Test | Commande | Résultat |
|---|---|---|
| 21 scénarios d'attaque | `python redteam/run.py` | **détection 100 %, faux positifs 0 %** |
| Durcissement faux positifs | `python redteam/battery100.py` | 47 cas bénins : **38 % → 0 %** de FP |
| Évasion | `python redteam/evasion.py` | 850 mutations tenues |
| **Adversaire réel adaptatif** | `python redteam/adaptive_cap.py` | attaquant Claude en boucle, ~24 mutations : **0 bypass** |
| Preuve on-chain E2E | `python redteam/validate_onchain.py` | dépôt → pay sans visa REVERT → visa → pay OK → re-pay REVERT |
| Latence | (mesure) | **< 1 ms** (heuristiques) · ~3 s (fusion IA) |

L'attaquant adaptatif (Claude Sonnet 4.5) reçoit à chaque tour le verdict + les raisons du garde et mute pour les contourner.
L'allowlist bloque le détournement de fonds, le plafond de mandat escalade à l'humain, la fusion Claude bloque la manipulation.
Détail complet et honnête dans [`deliverables/audit-report.md`](deliverables/audit-report.md).

## 6. Configuration (`.env`)

Le garde tourne sans rien. Pour la fusion IA et l'écriture on-chain :
```
GUARD_LLM=on                       # off = heuristiques seules, pas d'AWS
GUARD_KYB=on                       # opt-in : vérifie le bénéficiaire au registre d'entreprises de l'État (data.gouv), off par défaut
AWS_DEFAULT_REGION=us-west-2       # Bedrock Claude
AWS_ACCESS_KEY_ID=...              # creds temporaires
AWS_SECRET_ACCESS_KEY=...
L1_RPC_URL=https://rpc.petroi.fr/rpc
REGISTRY_ADDRESS=0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6
VAULT_ADDRESS=0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0
```
⚠️ **Le `.env` n'est jamais commité** (il est dans `.gitignore`, il contient des secrets). Données synthétiques uniquement,
canary `FLAG{team2-canary}`, jamais de vraie donnée.

## 7. Limites connues (en toute transparence)

- **L1 mono-validateur** : à date un seul validateur (nous), donc l'immuabilité est « relative », pas encore décentralisée.
  Mitigation : passer en multi-validateurs ou ancrer périodiquement une empreinte sur la C-Chain Fuji.
- **Données synthétiques (PoC)** : montants, agents et boutiques sont simulés, pas du volume de production.
- **Métriques auto-évaluées** : le 100 % / 0 % est mesuré sur *notre* banc. L'adversaire adaptatif n'a produit aucun bypass,
  mais la campagne est courte et ne couvre pas encore la menace « bénéficiaire whitelisté compromis ».
- **Conformité = alignement, pas certification** : on démontre qu'on répond aux exigences DORA / MiCA / AML / AI Act, ce n'est
  pas un audit certifié par un tiers agréé.
- **Pas de vrais fonds** : le `GuardedVault` est prouvé, mais sur des montants de test.

## 8. Livrables jury

Dans [`deliverables/`](deliverables/) : fiche défense 1 page, mapping compliance (DORA / MiCA / AML / AI Act), response
playbook, pitch 4 min, démo en 3 actes (golden path), dashboard KPI (`dashboard.html`), et le **rapport d'audit vérifiable
on-chain** (`audit-report.md`).

## 9. Équipe

**Corentin** & **Bruno** (le cerveau : garde, scoring, agents, red-team) · **Walid** (exécution on-chain : L1, contrats, API,
explorer) · **Maxime** (UI 3D, compliance, pitch).

---
*Repo : https://github.com/maximdprt/hackathon_securehorizon_track1*
