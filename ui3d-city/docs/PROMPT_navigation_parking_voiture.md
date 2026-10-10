# PROMPT : navigation par bâtiment, écrans Transactions et Registre, parking fermé, voiture builders-hub

> Rôle : expert UI design 3D et UX produit. Projet : `ui3d-city/` (City 3D extraite de builders-hub, BSD-3, plus la
> parcelle AvaGuard+). Règle d'exécution : **un point à la fois**. Un point n'est terminé que lorsque tous ses critères
> d'acceptation sont vérifiés (typecheck, tests, capture d'écran relue). On ne passe pas au suivant avant.
>
> Contraintes héritées (toujours valables) : pas de tiret cadratin dans l'UI, pas de logo ni de navigation Avalanche,
> toute modification d'un fichier vendored marquée `// AVAGUARD:`, pas de setState React par frame, `useStill` respecté,
> thème sombre par défaut et thème clair fonctionnel, données synthétiques signalées « simulé », aucune clé dans le code.

---

## Principe UX : chaque bâtiment est une porte

La ville est le menu. Chaque objet de la scène a un **survol** (curseur main, plaque d'info au style de la City : la
`TipPlate` de builders-hub, avec une dernière ligne « Cliquer pour ouvrir ») et un **clic** qui ouvre une destination.

| Objet 3D | Survol (plaque) | Clic : destination |
| --- | --- | --- |
| Tour C-Chain (hub) | Validators, messages, partenaire principal (déjà fourni par la City) | Écran **Transactions** (toutes les transactions AvaGuard réglées sur la C-Chain) |
| Conteneur rouge « Registre des hackers » | Nombre d'adresses bannies, dernière entrée | Écran **Registre des hackers** (la DB des adresses et clés bannies) |
| Parking « Validation humaine » | Places occupées, demandes en attente | Écran **Validation humaine** (file d'attente et historique des décisions humaines) |
| Péage « Contrôle AvaGuard+ » | Transaction en cours, étape d'analyse | Écran **Transactions** ouvert sur la transaction en cours (ou la dernière) |
| Déchetterie (presse) | Transactions détruites, montant protégé | Écran **Transactions** filtré « Bloquées » |
| Colonne « Preuve on-chain » | Dernier bloc, nombre de preuves | Écran **Transactions** filtré « Avec preuve on-chain » |
| Tour AvaGuard L1 (QG) | Validators, flux avec la C-Chain | Écran **Audit** (KPIs, seuils, conformité) |
| Voiture AvaGuard | Agent → bénéficiaire, montant, méthode, tx_id | Écran **Transactions** ouvert sur cette transaction |
| Toute autre chaîne | Plaque de la City (inchangée) | Comportement de la City (vol caméra) plus **Fiche chaîne** à droite |

Navigation : les écrans s'ouvrent **par-dessus la ville** (la scène 3D reste montée, rien n'est recalculé), avec un fil
d'Ariane `City / Transactions / tx_0042`, la touche `Échap` et un bouton « Retour à la ville ». L'URL suit l'écran
(`?view=transactions&tx=tx_0042`, `?view=registry`, `?view=parking`, `?view=audit`) via `history.pushState`, donc le
bouton Précédent du navigateur fonctionne et un lien est partageable.

---

## Point 1 : la couche de données (prête pour le MCP agent)

Fichier `data/source.ts` : une seule interface lue par tous les écrans, pour brancher le MCP agent de Walid sans
toucher l'UI.

```ts
export interface AuditSource {
  name: string;                       // "Simulation locale" | "MCP agent"
  connected: boolean;
  transactions(): AuditTx[];          // plus récentes d'abord
  banned(): BannedEntry[];
  subscribe(f: () => void): () => void;
}
```

- `AuditTx` = `TxEvent` (sim/types.ts) plus `status: "ALLOW" | "BLOCK" | "HUMAN" | "PENDING"`, `via: "AvaGuard" | "humain" | "registre"`, `decided_at`.
- `BannedEntry` = `{ address, label, domain?, first_tx, reason, attempted: {value, token}, hits, banned_at, by, onchain: {block, tx_hash}, key_fingerprint }`.
- `data/history.ts` : un historique **synthétique et déterministe** (graine fixe) de 36 transactions passées, réparties
  sur les 2 use cases (shopping, agent à agent / x402), environ 70 % visas, 20 % refus, 10 % humain, avec des scores et
  des contrôles cohérents avec les seuils (visa < 40, humain 40 à 69, refus ≥ 70), et 6 adresses déjà bannies. Un des
  enregistrements porte le canary `FLAG{team2-canary}` (règle du repo).
- `simSource` fusionne cet historique et le journal vivant du Director (sim/store.ts) : une transaction jouée dans la
  ville apparaît en tête de l'écran Transactions, une adresse bannie par la presse apparaît en tête du Registre.
- `mcpSource` : lit `NEXT_PUBLIC_AVAGUARD_MCP_URL` (`GET /transactions`, `GET /banned`), mappe avec `verdictToTx`.
  Inactif sans URL. L'en-tête des écrans affiche la source : « Source : simulation locale · MCP agent : non connecté ».

Acceptation : typecheck ; test unitaire `tests/unit/data/source.test.ts` (36 + journal, tri, seuils respectés, bannis
uniques, le canary présent une fois).

## Point 2 : le routeur d'écrans et la plaque de survol de la parcelle

- `sim/store.ts` : `view: null | "transactions" | "registry" | "parking" | "audit"`, `viewTx: string | null`,
  `viewFilter`, et `hoverTip` (objet survolé, position écran). Le survol met à jour un store hors React par frame
  seulement au changement d'objet (pas à chaque mouvement : la position est écrite dans le DOM par ref).
- `app/avaguard/views/ViewHost.tsx` : rend l'écran courant par-dessus la ville (fond `zinc-950/96` avec flou, entrée en
  fondu 180 ms, `prefers-reduced-motion` respecté), fil d'Ariane, Échap, synchronisation de l'URL (push à l'ouverture,
  `popstate` à la fermeture), focus piégé dans l'écran.
- `components/.../city3d/Pickable.tsx` : enveloppe R3F qui donne à un groupe `onPointerOver/Out/Move` et `onClick`
  (stopPropagation, curseur main via `document.body.style.cursor`), et pousse la plaque. Plaque rendue dans le shell
  avec la `TipPlate` et les `TipRow` de builders-hub.
- Le clic sur la C-Chain : `onSelect(hubId)` intercepté dans le shell → `openView("transactions")` (la City garde son
  vol caméra). Autre chaîne : `selected` → Fiche chaîne.

Acceptation : survoler le conteneur affiche la plaque ; cliquer la C-Chain ouvre l'écran ; Échap et Précédent ferment ;
capture relue.

## Point 3 : écran Transactions (clic sur la tour C-Chain)

Mise en page desktop 1920 : en-tête (logo bouclier, « Transactions · C-Chain », sous-titre « Paiements d'agents IA
vérifiés par AvaGuard+ avant règlement »), badge source, bouton Retour.

1. **Bande de KPIs** (6 cartes) : Transactions, Visas émis, Bloquées, En attente humaine, Montant protégé, Décision
   moyenne. Chiffres mono tabulaires, sous-texte, couleur d'état.
2. **Barre d'outils** : onglets d'état avec compteurs (Toutes, Visas, Bloquées, Humain, En attente), recherche
   (tx_id, agent, adresse, domaine), sélecteur de use case (Tous, Shopping, Agent à agent), tri (date, montant, score).
3. **Table** (sticky header, lignes de 44 px, survol, ligne active surlignée, navigation clavier ↑ ↓ Entrée) :
   État (pastille + icône), tx_id, Agent, Bénéficiaire (label + adresse courte), Montant, Score (mini barre colorée sur
   l'échelle 0 à 100 avec les seuils 40 et 70), Décidé par (AvaGuard, humain, registre), Bloc on-chain, Heure.
4. **Panneau de détail** (droite, 480 px) au clic d'une ligne, URL `&tx=` :
   - en-tête : tx_id, badge décision, « décidé en 1,8 s », source ;
   - résumé : agent → bénéficiaire, montant, use case, méthode du contrat ;
   - **scoring d'audit** : jauge du risque avec seuils, radar des 5 contrôles, les 5 contrôles (score, raison, barre),
     seuils KPMG rappelés ;
   - **chaîne d'autorité** : Humain → Agent → Outil → Document, maillon rompu en rouge avec la note ;
   - **contrat** : code avec la ligne risquée encadrée ; extrait d'injection si présent ;
   - **preuve on-chain** : chaîne, bloc, hash, visa ; **conformité** : DORA (n° d'incident), OWASP ASI03/ASI07, ATLAS, NIST ;
   - onglet **JSON brut** ; bouton « Copier » ; mention « Branchement MCP agent : à venir » si source locale.
5. État vide, état « aucune correspondance », état chargement (pour la source MCP).

Acceptation : capture de l'écran avec une ligne ouverte ; jouer `1` puis cliquer la C-Chain montre tx_0042 en tête.

## Point 4 : écran Registre des hackers (clic sur le conteneur rouge)

- En-tête « Registre des hackers · AvaGuard L1 », sous-titre « Adresses et clés bannies : tout paiement vers elles est
  refusé sans analyse (immunité) ».
- KPIs : adresses bannies, tentatives bloquées par immunité, montant tenté total, dernière entrée.
- Table : Adresse (complète, mono, bouton copier), Empreinte de clé (`0x` 8 octets), Label et domaine, Raison,
  Montant tenté, Tentatives (hits), Bannie le, Par (AvaGuard ou humain), Preuve on-chain (bloc, hash court).
- Recherche, filtre « par AvaGuard / par un humain », export CSV (Blob, sans serveur), détail en tiroir avec la
  transaction d'origine (lien vers l'écran Transactions).
- Une adresse ajoutée par la presse arrive en tête avec un surlignage rouge bref.

Acceptation : capture ; après `1`, `0xBad1…7e3A` est en tête ; après `4`, ses tentatives passent à 2.

## Point 5 : parking fermé « Validation humaine » (refonte 3D) et son écran

Le parking actuel n'est qu'un dallage et des lignes. Le remplacer par un **parking couvert et clos**, dans la grammaire
de la City (blancs mats MASS3, acier ROOF, ambre AVAGUARD3, pas de néon saturé) :

1. **Dalle** légèrement surélevée (0,25 m) avec bordure en acier, enrobé sombre, flèches de circulation au sol.
2. **Enceinte** : muret bas sur trois côtés plus grille à barreaudage (poteaux et lisses), coins renforcés.
3. **Entrée contrôlée** : îlot avec borne, barrière levante ambre et blanche (s'ouvre à l'entrée de la voiture, se
   referme derrière), petit portique avec bandeau « VALIDATION HUMAINE ».
4. **Auvent** (carport) sur les places : poteaux, poutres, toiture plate avec panneaux solaires (bleu nuit mat), bande
   lumineuse ambre sous l'auvent qui pulse doucement quand une demande attend.
5. **Places** numérotées P1 à P6 (lignes ambre, numéros au sol), butées de roue, place active cernée d'un halo ambre.
6. **Éclairage** : 4 lampadaires aux angles (poteau, tête, petite source chaude), visibles de nuit.
7. **Guérite** de l'agent humain avec fenêtre éclairée et le gyrophare ambre sur son toit (tourne en phase humaine).
8. Le trajet de la voiture passe par la barrière (la barrière s'ouvre pendant `toParking` et `fromParking`).
9. Survol : « Validation humaine · 1 demande en attente · P3 occupée ». Clic : écran **Validation humaine** : file
   d'attente (carte de la demande avec compte à rebours, Approuver A / Refuser R), historique des décisions humaines
   (qui, quand, délai, issue), délai moyen de décision.

Acceptation : captures jour et nuit du parking en gros plan ; scène `3` : la barrière s'ouvre, la voiture se gare en P3.

## Point 6 : la voiture, celle de builders-hub

Reprendre **exactement** le véhicule de la City (`city3d/Traffic.tsx`) au lieu de notre approximation :

- coque : `podGeometry()` (capsule aplatie, section `CLEAR/LOWER/UPPER`), longueur `PODS.car.length = 2.2` largeurs,
  posée sur `EQUATOR` ;
- verrière : même géométrie, mise à l'échelle comme le shader `VEH_POD` (largeur `0.72`, hauteur `CANOPY_H × 0.72`,
  flancs raccourcis de `(1.2 / 0.72 − 2.2) / 2`), placée à `x = 0.1`, `y = ROOF − 0.055`, matériau Phong `#EBF0FA`
  spéculaire `#5C6674` brillance 60 et `cityEnv 0.35` ;
- **bande lumineuse** des flancs : même patch de shader `strip` (`STRIP_Y = 0.045`, demi-largeur au moins un pixel),
  sa couleur est **la couleur d'état** (bleu vérification, vert visa, rouge refus, ambre humain), émissive comme la City ;
- coque `#3B484B` de nuit, `#A2AFB2` de jour (les teintes de la flotte), ombre douce elliptique (`1.1 × 1.3`) ;
- taille : celle d'un `van` de la flotte (lisible mais de la même famille), pas de barre de toit inventée ;
- le halo au sol reste, discret ; le givre (refus) et la vue rayons X (scan) sont conservés.
- Survol : plaque « agent-compta-07 → 0xBad1…7e3A · 4 800 USDC · transfer() · tx_0042 ». Clic : Transactions sur cette tx.

Acceptation : capture côte à côte de notre voiture et d'une voiture de la flotte, même silhouette.

## Point 7 : les autres portes (péage, déchetterie, preuves, QG, chaînes)

Brancher le survol et le clic de la table du principe UX : péage, presse, colonne de preuves, tour AvaGuard L1 (écran
Audit : KPIs detection rate, faux positifs, délai de décision, incidents DORA, montant protégé, répartition par
contrôle, seuils KPMG), et la Fiche chaîne pour toute autre tour (nom, logo, validators, messages, « Paiements AvaGuard
vers cette chaîne : 0 (simulé) »).

Acceptation : chaque porte testée au clic (Playwright `tests/visual/doors.spec.ts`), captures relues.

## Point 8 : finitions et livraison

- thème clair vérifié sur chaque écran ; aucune régression de fps visible ; `npm test`, `npm run test:visual`, typecheck ;
- README mis à jour (carte des portes) ; synchronisation et rapport.
