# Test end to end : le moteur guard contre le vrai contrat AuthorityRegistry.sol

Fichier : `tests/test_chain_e2e.py`. Lancer : `.venv/bin/pytest -q tests/test_chain_e2e.py`.

But : prouver que le garde (`guard/engine.py`) fonctionne avec le **vrai** `contracts/AuthorityRegistry.sol`, sans attendre le deploiement Fuji. Pas de reseau, pas de cle, pas de faucet : tout tourne dans le process pytest en une seconde.

## 1. Comment ca marche

1. **Compilation** : `py-solc-x` compile `contracts/AuthorityRegistry.sol` avec solc 0.8.20 (telecharge une fois, puis en cache dans `~/.solcx`). Si solc est indisponible (pas de reseau au premier run), le test est `skip`, pas en echec.
2. **Deploiement** : `web3.EthereumTesterProvider` (py-evm) = une EVM en memoire, blocs mines instantanement. Le compte 0 deploie, il devient `owner`.
3. **Seed de la chaine d'autorite**, comme `data/authorities.mock.json` :
   - `grantAuthority(0xA11ce...0001, 100_000_000, "treasury-agent")` (100 USDC en 6 decimales)
   - `grantAuthority(0xA11ce...0003, 0, "reader")`
   - `0xBAD...0BAD` reste inconnu du registre.
4. **Branchement du guard sans modifier `guard/`** : on instancie `ChainSource(url_bidon, adresse, owner_key, fallback=MockJsonSource(tmp))` (le constructeur ne se connecte pas), puis on remplace `.w3` et `.contract` par le provider de test. Le handle `.contract` utilise l'ABI de `guard/sources.py`, donc c'est bien cette ABI qui est exercee. La cle owner vient de `w3.provider.ethereum_tester.backend.account_keys[0]`.
5. **Moteur** : `Engine(source=ChainSource, sink=CompositeSink(JsonlSink, ChainSink), queue=PendingQueue, llm=ClaudeScorer(enabled=False), data=load_data(tmp))`. Claude est coupe : les acts sont deterministes (les hard blocks suffisent).
6. **Chemin dore** rejoue sur la meme chaine, avec assertions on-chain apres chaque acte :

| Acte | Requete | Verdict moteur | Etat on-chain verifie |
|---|---|---|---|
| 1 | M1 : le reader relaie un ordre empoisonne "tresorerie migree", 5000 USDC vers 0xBAD, origin agent non signe | `block`, severite 3, `authority_check.source == "onchain"` | `threats(addressKey(0xBAD))` flagged severite 3 ; `threats(instructionId)` flagged 3 ; 1 event `DecisionRecorded(verdict=2, issuer=reader, amount=5000e6)` envoye par l'owner ; le reader n'est pas flaggue (il est `active`, c'est son role qui interdit de payer) |
| 2 | Facture legitime 80 USDC du treasury agent vers un vendeur allowlist, origin user | `allow`, `authorized=True, within_limit=True` | 2e event `DecisionRecorded(verdict=0, issuer=treasury)` ; `assess(treasury, id, 80e6) == 0` |
| 3 | M7 : le treasury agent (autorise) paie 10 USDC a 0xBAD | `block`, signal `recipient_flagged_onchain` hard, poids 1.0, `onchain_flagged=True` | 3e event `DecisionRecorded(verdict=2)` ; le treasury agent n'est pas flaggue |

7. **`assess()` du contrat vs moteur (acte 1)** : avant que le moteur parle, `assess(reader, instructionId, 5000e6)` renvoie **0 = ALLOW** (voir ecart A ci-dessous). Apres l'acte 1 il renvoie **2 = BLOCK**, parce que le moteur a flaggue le hash d'instruction en severite 3. C'est donc le moteur qui rend le contrat strict, pas l'inverse. Le test verifie les deux valeurs.

Tests annexes dans le meme fichier :
- `test_guard_abi_is_a_subset_of_the_compiled_contract` : chaque fonction de l'ABI codee en dur dans `guard/sources.py` existe dans le .sol avec les memes types, noms de sortie et mutabilite (garde contre la derive d'ABI si Walid modifie le contrat).
- `test_subject_key_matches_contract_addressKey` : `subject_key(adresse)` == `addressKey(adresse)` on-chain.
- `test_chain_source_reads_authorities_in_token_units` : 100_000_000 on-chain devient 100.0 cote moteur.
- `test_read_only_chain_source_cannot_flag_but_fails_loudly` : sans cle owner, le verdict est rendu mais le flag est perdu et l'erreur apparait dans `sink_errors` (bug 2).
- `test_flags_survive_when_blocks_are_not_mined_instantly` : **xfail strict**, reproduit le bug 1 en desactivant le minage instantane. Quand le bug sera corrige, ce test passera et pytest signalera "XPASS(strict)" : il faudra alors retirer le decorateur.

## 2. Brancher le vrai deploiement Fuji (Walid)

`Engine.from_env()` lit ces variables (a mettre dans `.env`, jamais commite) :

```bash
GUARD_CONTRACT_ADDRESS=0x...      # adresse du AuthorityRegistry deploye (Remix, Fuji chainId 43113)
AVAX_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
GUARD_OWNER_KEY=0x...             # cle privee du compte qui a deploye (= owner). Sans elle : lecture seule, voir bug 2
GUARD_TOKEN_DECIMALS=6            # USDC. Doit correspondre a l'unite utilisee dans grantAuthority
```

Puis `pip install -e ".[chain]"` (ou `uv pip install -e ".[chain]"`). Si `GUARD_CONTRACT_ADDRESS` est vide, le moteur reste sur le mock JSON.

Seed a faire dans Remix, en respectant les **6 decimales** :
- `grantAuthority(0xA11ce00000000000000000000000000000000001, 100000000, "treasury-agent")`
- `grantAuthority(0xA11ce00000000000000000000000000000000002, 300000000, "shopping-agent")`
- `grantAuthority(0xA11ce00000000000000000000000000000000004, 5000000, "service-agent")`
- reader `0x...0003` : voir ecart A avant de choisir `maxAmount`.

Pour flaguer a la main un domaine (pas une adresse) : la cle bytes32 est `keccak256(utf8(domaine en minuscules))`, par exemple dans la console Remix `web3.utils.keccak256("evil.shop")`. Pour une adresse : `addressKey(adresse)` ou `subject_key()` de `guard/sources.py`, les deux donnent la meme chose (test a l'appui). Un `instruction_id` du moteur (`0x` + 64 hex) est passe tel quel en bytes32.

Avant de brancher sur Fuji, lire le bug 1 : en l'etat, les flags seront perdus sur une vraie chaine.

## 3. Ecarts contrat / moteur (pas des bugs, mais a connaitre)

**A. `maxAmount == 0` veut dire "sans plafond" dans le contrat, "ne paie jamais" dans `data/mandates.json`.** Le reader est seed avec `maxAmount=0` dans `authorities.mock.json`. On-chain, `isAuthorized(reader, 5000e6)` est donc **vrai** et `assess()` ne connait pas les roles : seul, le contrat laisse passer l'acte 1 (ALLOW). Le moteur bloque grace au role `reader` (`issuer_role_mismatch`) et au relais inter-agent non signe (hard). Options : ne pas granter les readers (alors `issuer_in_registry` hard-block), ou les granter avec `maxAmount=1` (1 micro-USDC), ou ajouter un `bool canPay` dans `Authority`. Important pour le pitch : dire "le contrat + le moteur" et pas "le contrat seul".

**B. `assess(issuer, instructionId, amount)` n'a pas de parametre `recipient`.** Le registre des destinataires malveillants (acte 3, "2e agent immunise") n'est applique que par le moteur via `is_flagged(recipient)`. Pour un vrai pare-feu on-chain, ajouter `assess(issuer, recipient, instructionId, amount)` qui teste aussi `addressKey(recipient)`. Le test montre qu'un hash d'ordre neuf du treasury vers 0xBAD donne `assess == 0`.

**C. `recordDecision` est ouvert a tous** (pas de `onlyOwner`). N'importe qui peut ecrire de fausses lignes dans la piste d'audit DORA. Mettre `onlyOwner` (ou un role `recorder`), et cote dashboard filtrer les events dont le `tx.from` est l'owner.

**D. Unites.** On-chain tout est en entier 6 decimales ; `mandates.json` et le moteur sont en USDC humains. `ChainSource` fait la conversion avec `GUARD_TOKEN_DECIMALS`. Si le contrat est reutilise avec un autre token (18 decimales), changer la variable.

**E. ABI.** L'ABI de `guard/sources.py` est un sous-ensemble exact (noms, types, mutabilite verifies). Elle n'inclut pas `assess`, `addressKey`, `grantAuthority`, `revokeAuthority`, `clearThreat`, ni les events : le dashboard de Maxime devra prendre l'ABI complete (sortie du compilateur ou Remix).

**F. Agents revoques.** `get_authority` renvoie `None` si `!active && role == ""` (inconnu), et `Authority(active=False)` si le role est reste (revoque). Dans les deux cas le moteur hard-block (`issuer_in_registry`). Coherent.

**G. Version web3.** `ChainSource._send` utilise `signed.raw_transaction` : c'est le nom web3 >= 7 (web3 6 disait `rawTransaction`). `pyproject.toml` a ete passe a `web3>=7.0` dans l'extra `chain`.

## 4. Bugs trouves dans guard/ (NON corriges ici, a patcher par le proprietaire du code)

**Bug 1 (bloquant sur Fuji) : nonce "latest" sans attente de receipt.**
Fichier `guard/sources.py`, ligne 130 :
```python
tx = fn.build_transaction({"from": acct.address, "nonce": self.w3.eth.get_transaction_count(acct.address)})
```
`Engine._effects` (engine.py lignes 161 a 169) envoie a la suite 2 ou 3 `flagThreat` puis 1 `recordDecision` sans attendre qu'un bloc soit mine. Sur Fuji (~2 s par bloc) ces transactions prennent toutes le meme nonce : selon le noeud elles sont rejetees ("nonce too low" / "replacement transaction underpriced") ou se remplacent. Reproduit dans `test_flags_survive_when_blocks_are_not_mined_instantly` (minage instantane desactive) : verdict `block`, aucune `sink_errors`, mais apres minage 0xBAD n'est **pas** flaggue et une seule des 3 transactions a survecu (le `recordDecision`). Le "2e agent immunise" de l'acte 3 ne marcherait donc pas en demo live.
Patch propose :
```python
def _send(self, fn):
    from web3 import Web3
    if not self.owner_key:
        raise RuntimeError("GUARD_OWNER_KEY not set: cannot write on-chain")
    acct = self.w3.eth.account.from_key(self.owner_key)
    with self._tx_lock:  # threading.Lock() cree dans __init__
        nonce = self.w3.eth.get_transaction_count(acct.address, "pending")
        tx = fn.build_transaction({"from": acct.address, "nonce": nonce})
        signed = acct.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
    return Web3.to_hex(tx_hash)
```
Le `wait_for_transaction_receipt` ajoute ~2 s par ecriture sur Fuji (jusqu'a 8 s pour un block). Alternative plus rapide : garder le nonce `pending` + le lock, sans attendre, et verifier les receipts en tache de fond.

**Bug 2 : en lecture seule, le flag est perdu partout, et le fallback n'est jamais lu.**
`guard/sources.py` lignes 134 a 137 : `mark_threat` appelle `_send` d'abord et n'ecrit `self.fallback.mark_threat` qu'apres. Sans `GUARD_OWNER_KEY` (mode que `Engine.from_env` autorise), `_send` leve, donc ni la chaine ni le mock local ne gardent l'incident. Et `is_flagged` (ligne 121) ne consulte jamais `self.fallback`. Resultat : le registre d'adresses hackers ne memorise rien en mode lecture seule. Reproduit par `test_read_only_chain_source_cannot_flag_but_fails_loudly`.
Patch propose : ecrire le fallback en premier (ou dans un `finally`), et dans `is_flagged` combiner `chaine OR fallback` :
```python
def is_flagged(self, key):
    flagged, severity, reason, _d, _a = self.contract.functions.threats(subject_key(key)).call()
    if not flagged and self.fallback:
        return self.fallback.is_flagged(key)
    return bool(flagged), int(severity), str(reason)

def mark_threat(self, key, severity, reason):
    if self.fallback:
        self.fallback.mark_threat(key, severity, reason)
    self._send(self.contract.functions.flagThreat(subject_key(key), severity, reason[:200]))
```

**Bug 3 : `decisions.jsonl` ne contient jamais `onchain_tx`.**
`guard/sinks.py` lignes 40 a 44 : `ChainSink.record` ecrit `verdict["onchain_tx"]` apres l'envoi. Mais dans `Engine.from_env` (engine.py) le `CompositeSink` est construit `[JsonlSink, ChainSink]` : la ligne JSONL est ecrite avant que le hash existe. Le dashboard d'audit ne peut donc pas lier une decision locale a sa preuve on-chain. Verifie dans `test_golden_path_on_the_real_contract` (les 3 lignes locales n'ont pas `onchain_tx`, les verdicts en memoire l'ont).
Patch propose : dans `from_env`, inserer le `ChainSink` **avant** le `JsonlSink` (`sinks.insert(0, ChainSink(chain))`), ou faire ecrire le JSONL par le `ChainSink` apres coup.

**Bug 4 (cosmetique) : hash de transaction sans `0x`.**
`guard/sources.py` ligne 132 : `return self.w3.eth.send_raw_transaction(...).hex()`. Avec web3 >= 7 (hexbytes >= 1.0), `HexBytes.hex()` ne prefixe plus `0x` : `onchain_tx` vaut `41b8cf...` au lieu de `0x41b8cf...`, ce qui casse les liens Snowtrace construits par concatenation. Patch : `return Web3.to_hex(self.w3.eth.send_raw_transaction(signed.raw_transaction))`.

**Bug 5 (mineur) : troncature des montants.**
`guard/sources.py` ligne 146 : `int(amount * 10 ** self.decimals)` tronque les erreurs flottantes. Exemple verifie : `2.01 * 10**6 == 2009999.9999999998`, donc `recordDecision` enregistre `2009999` (2.009999 USDC) au lieu de `2010000` ; pareil pour 2.03, 2.05, 2.07... Le montant on-chain ne correspond plus exactement a l'ordre, genant pour une preuve d'audit. Patch : `int(round(amount * 10 ** self.decimals))`.

## 5. Resultat

```
.venv/bin/pytest -q tests/test_chain_e2e.py   ->  5 passed, 1 xfailed
.venv/bin/pytest -q                           -> 43 passed, 1 xfailed
```

Dependances ajoutees dans `.venv` et dans l'extra `chain` de `pyproject.toml` : `web3` 8.0.0, `py-solc-x` 2.0.5, `eth-tester[py-evm]` 0.14.0b1 (py-evm 0.12.1b1). solc 0.8.20 telecharge par py-solc-x dans `~/.solcx`.


## Mise à jour (2026-10-10, après correction)
Les 5 bugs de la section 4 sont corrigés dans `guard/sources.py` et `guard/engine.py` :
1. `_send` : nonce lu en `pending`, verrou pour sérialiser les envois, attente du reçu (`GUARD_TX_TIMEOUT`, 60 s par défaut). Le test "blocs non instantanés" tourne désormais avec un mineur en arrière-plan et passe.
2. `mark_threat` écrit d'abord la mémoire locale ; `is_flagged` lit la chaîne puis le repli local. Le registre fonctionne même sans `GUARD_OWNER_KEY`.
3. `Engine.from_env` place `ChainSink` avant `JsonlSink` : `decisions.jsonl` contient `onchain_tx`.
4. Hash de tx renvoyé via `w3.to_hex` (préfixe 0x).
5. Montants convertis via `Decimal(str(amount))`, plus de troncature.
Les écarts contrat / moteur de la section 3 restent à traiter côté Walid (sémantique `maxAmount == 0`, `assess` sans destinataire, `recordDecision` sans `onlyOwner`).
