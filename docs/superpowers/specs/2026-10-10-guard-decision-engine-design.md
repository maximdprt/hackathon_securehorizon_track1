# Spec : moteur de décision "guard" (serveur MCP de vérification des paiements d'agents)

Date : 2026-10-10. Auteurs : Bruno + Corentin. Statut : approuvé, en construction.
Référence : `detection/research/taxonomie.md`, `detection/research/features_scoring.json`, `detection/research/scenarios_red_team.md`, `detection/verdict.schema.json`, `contracts/AuthorityRegistry.sol`.

## 1. Objectif
Un serveur MCP posé devant tout paiement d'agent IA. Avant d'exécuter, l'agent appelle `verify_payment`.
Le garde décide `allow` / `needs_approval` / `block` à partir de signaux multi-couches (taxonomie),
du jugement de Claude (Bedrock) et de la lecture on-chain de l'autorité. Chaque décision est
expliquée (preuves) et journalisée.

## 2. Outils MCP exposés
| Outil | Entrées | Sortie |
|---|---|---|
| `verify_payment` | `order` {issuer, action, amount, currency, recipient, calldata?, nonce?}, `source_context` (texte ou HTML brut lu par l'agent), `context_type` ("html" \| "text" \| "tool_output" \| "email"), `task` (ce que l'agent croit devoir faire, texte libre) | Verdict conforme à `verdict.schema.json` + `severity` (1..3) + `signals[]` |
| `list_pending` | aucune | liste des verdicts `needs_approval` en attente |
| `approve_pending` | `instruction_id`, `decision` ("allow" \| "block"), `approver`, `note` | verdict final, journalisé |

**Le mandat n'est jamais fourni par l'agent.** Il est résolu côté serveur depuis `data/mandates.json`
(clé = adresse de l'émetteur) et le plafond on-chain. `task` sert uniquement à mesurer l'écart
entre ce que l'agent croit faire et ce qu'il a le droit de faire.

## 3. Pipeline de décision
1. **Validation** de la requête (types, adresse, montant > 0).
2. **Sanitisation** (`sanitize.py`) : HTML → texte visible + texte caché (display:none, visibility,
   opacity 0, font-size 0, hors écran, commentaires, alt/aria/title/meta). Normalisation NFKC.
   Détection et retrait : Unicode tags (U+E0000..U+E007F), zero-width (U+200B..D, U+FEFF),
   bidi (U+202A..E, U+2066..69). Décodage des blobs base64 ≥ 16 chars. Sortie : `Cleaned`
   {visible, hidden, decoded_blobs, unicode_findings, script_mix}.
3. **Signaux** (`features/*`) : fonctions pures → `list[Signal]`. `Signal` = {id, layer, weight,
   hard, evidence}. Couches et poids : voir taxonomie §3. Blocs durs (weight 1.0, hard=True) :
   canary sortant, ordre qui modifie les règles, émetteur inactif/révoqué/flaggé, destinataire
   flaggé sévérité 3, approve illimité / setApprovalForAll / permit vers inconnu, nonce rejoué.
4. **Blocs durs** : si ≥ 1 → risk 1.0, `block`, Claude non appelé.
5. **Sinon** : `risk_h = 1 - Π(1 - w_i)`. Appel `llm.py` (enveloppe de `detection/scorer.py`) avec
   contexte nettoyé + flags. `risk_llm` accepté seulement si `poison_check.evidence` ou `reasons`
   non vide. `risk = max(risk_h, risk_llm)`.
6. **Seuils** : allow < 0.30 ≤ needs_approval < 0.70 ≤ block. Si `amount ≥ 0.5 × maxAmount` :
   0.20 / 0.60. Calldata présent mais indécodable → verdict ≥ needs_approval.
7. **Claude indisponible** : allow seulement si zéro signal, sinon needs_approval. Raison
   `llm_unavailable` ajoutée.
8. **Sévérité** (1 info, 2 warn, 3 block) : 3 si block ou bloc dur ; 2 si needs_approval ou
   montant > 50 % plafond ; 1 sinon. Répétition (émetteur/destinataire déjà vu en block) → +1, plafonné à 3.
9. **Effets** : `sinks.py` journalise (JSONL local, et `recordDecision` on-chain si configuré).
   needs_approval → `queue.py`. block → destinataire et émetteur inscrits au registre menaces
   (mock : `threats.mock.json` ; chaîne : `flagThreat` si clé owner configurée).
10. `instruction_id` = keccak256 du JSON canonique de `order` (clé on-chain). `reasons[]` = une
    ligne par signal avec sa preuve, plus les raisons de Claude.

## 4. Modules
```
guard/models.py        PaymentOrder, Mandate, VerifyRequest, Verdict, Signal
guard/sanitize.py      clean(source, context_type) -> Cleaned
guard/features/content.py, mandate.py, authority.py, counterparty.py, transaction.py
guard/scoring.py       combine(signals, llm) -> (risk, verdict, severity)
guard/llm.py           score_with_claude(payload) -> dict | None   (jamais lève, None si échec)
guard/sources.py       AuthoritySource(Protocol): get_authority(addr), is_flagged(key), mark_threat(key, sev, reason)
                       MockJsonSource(data/), ChainSource(web3, Fuji) activée si GUARD_CONTRACT_ADDRESS
guard/sinks.py         DecisionSink(Protocol): record(verdict). JsonlSink, ChainSink
guard/queue.py         PendingQueue (data/pending.json)
guard/engine.py        Engine(sources, sink, queue, llm).verify(request) -> Verdict ; approve(...)
mcp_server.py          FastMCP "guard", 3 outils, construit Engine depuis l'env
data/                  mandates.json, authorities.mock.json, threats.mock.json, allowlist.json,
                       brands.json, domains.mock.json, addresses.mock.json
redteam/cases/*.json   {name, family, request, expected} ; run.py → métriques
tests/                 pytest, Claude et chaîne mockés
```

## 5. Formats de données
- `mandates.json` : `{ "<issuer>": {"role", "allowed_actions": [], "max_amount", "currency", "allowed_recipients": [], "description"} }`
- `authorities.mock.json` : `{ "<addr>": {"active", "max_amount", "role"} }`
- `threats.mock.json` : `{ "<key>": {"flagged", "severity", "reason"} }` (clé = adresse ou instruction_id)
- `domains.mock.json` : `{ "<domain>": {"age_days", "tls", "legal_pages", "redirects_to"} }`
- `addresses.mock.json` : `{ "<addr>": {"age_days", "tx_count", "verified_contract"} }`
- Log JSONL : une ligne par verdict, avec `signals` et `timestamp`.

## 6. Gestion d'erreurs
- Requête invalide → erreur MCP explicite, rien journalisé.
- Source on-chain injoignable → repli sur mock avec signal `authority_source_unavailable` (poids 0.30).
- Claude injoignable → voir §3.7.
- Sink on-chain injoignable → log local quand même, erreur loguée, verdict renvoyé.

## 7. Tests
- Unitaires par module (sanitize : texte caché, Unicode, base64 ; features : chaque signal ;
  scoring : noisy-OR, seuils, ajustement montant, sévérité ; engine : les 3 verdicts, Claude mocké).
- Red-team : un cas par famille A à I de la taxonomie + 10 cas légitimes. `redteam/run.py` affiche
  detection rate, faux positifs, time to detect moyen, et échoue si detection rate < 90 %.

## 8. Hors scope
Hébergement AWS des agents, UI 3D, dashboard, déploiement du contrat (Walid), WHOIS en direct.

## 9. Stack
Python 3.12 (uv), `mcp`, `beautifulsoup4`, `boto3`, `pytest`, `web3` en extra optionnel.

## 10. Alignement avec la recherche (ajout après fusion du scrap)
- Les identifiants de signaux reprennent les `name` de `detection/research/features_scoring.json`
  (ex. `imperative_to_agent`, `mandate_override_attempt`, `brand_lookalike_score`, `nonce_replay`).
- Le corpus red-team = scénarios S1..S7 et M1..M10 de `scenarios_red_team.md`, plus un cas pour les
  familles A (injection directe) et I (boucle d'approbation) qui manquent.
- La requête `verify_payment` accepte un bloc `context` optionnel porté par l'agent pour les features
  qui ne se déduisent pas du texte : `origin` (user|document|tool_output|agent|email|webpage),
  `signed` (bool, message inter-agent signé), `merchant` {domain, price, market_price, payment_methods,
  checkout_domain, is_ad, redirect_final_domain}, `x402` {quote_amount, facilitator, nonce},
  `tools` [{name, description, pinned_hash}], `history` {avg_amount, payments_last_hour, prior_purchase}.
  Tout champ absent = feature non évaluée, jamais un signal.
