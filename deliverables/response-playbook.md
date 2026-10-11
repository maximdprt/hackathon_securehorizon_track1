# Sentinel — Response Playbook

Que fait le système à chaque verdict, et qui agit. Tout est automatique sauf l'escalade humaine.

## ALLOW (confiance ≥ 70)
1. `AuthorityRegistry.grantVisa(paymentId, issuer, recipient, amount, ttl)` → **visa à usage unique** (expire, non rejouable).
2. `recordDecision(...)` → événement d'audit `DecisionRecorded(verdict="allow")`.
3. Le `GuardedVault.pay(...)` vérifie le visa en-EVM (`useVisa`) et laisse passer le paiement, **ce paiement et lui seul**.
4. UI : la voiture **passe le péage** (vert).

## BLOCK (confiance < 30, ou signal dur)
1. `flagThreat(addressKey(recipient), 3, reason)` → **bénéficiaire signalé on-chain** (sévérité 3).
2. `recordDecision(verdict="block")` → audit + **incident DORA** ouvert (`INC-AAAA-xxxx`).
3. Aucun visa délivré → `GuardedVault.pay` **revert** (fail-closed) : l'argent reste dans le wallet.
4. **La fois suivante** : toute tentative vers cette adresse est refusée d'office (lecture on-chain `ChainSource`).
5. UI : la voiture fait **demi-tour** (rouge). Motif lisible affiché (ex. « adresse sosie + domaine de 5 jours »).

## NEEDS_HUMAN (30 ≤ confiance < 70)
1. `recordDecision(verdict="needs_human")` → audit ; transaction **mise en file** (`data/pending.json`).
2. **Surveillance humaine (AI Act)** : un opérateur voit l'ordre + les signaux + le contexte source et tranche.
3. `approve_pending(instruction_id, "allow"|"block", who, note)` → applique le verdict humain, tracé (qui, quand, pourquoi) → visa ou flag.
4. UI : la voiture **se gare** (ambre) en attendant l'humain.

## Après incident (block)
- **Contestation / due process** : `clearThreat(subject)` (owner) si faux positif avéré — révocabilité exigée par l'AI Act.
- **Partage** : le registre de menaces on-chain est lisible par tous les agents/équipes → protection collective.
- **Mesure** : l'incident alimente les KPIs (détection, temps de réponse) et le recalibrage.

## Rôles
- **Garde (Corentin/Bruno)** : décide (verdict + preuve). Ne touche pas aux fonds.
- **Chaîne (Walid)** : exécute on-chain (visa/flag/pending) et prouve. Ne décide pas.
- **Humain (opérateur)** : tranche la zone de doute. Décision tracée.
- **UI/Compliance (Maxime)** : lit la chaîne, affiche, mappe DORA/MiCA/AI Act.
