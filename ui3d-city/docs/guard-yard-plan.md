# Guard Yard : plan d'intégration

Référence : `docs/reference/avaguard-fx.html` (three r128, une seule fonction `frame(t)`). Elle fait foi pour toutes les
valeurs, les timings et le rendu.

## Stack constatée

- Next.js 16 (app router), React 19, TypeScript 5.9, `three` 0.180, `@react-three/fiber` 9.5, `@react-three/drei` 10.7.
- La City (builders-hub) a son propre Canvas, son rig et du post-processing (N8AO) : le Guard Yard a son **propre Canvas**.
- Verdicts : `sim/types.ts` (`TxEvent`, `AuditTx`), adaptateur du schéma de l'équipe
  (`detection/verdict.schema.json`) dans `sim/adapters/verdictToTx.ts`, source des écrans `data/source.ts`.

## Fichiers

```
components/guard-yard/
  GuardYard.tsx          racine : <Canvas> + HUD + boutons, reçoit un GuardVerdict
  GuardScene.tsx         crée la scène une fois (useMemo), frame(T) dans useFrame, dispose au démontage
  GuardYardModal.tsx     la modale plein écran ouverte depuis la City
  hud/GuardCard.tsx      card radiographie + score + critères + détails (mise à jour par refs DOM)
  hud/PhaseLabel.tsx     cartouche en haut à gauche (aria-live)
  hud/HackerTag.tsx      étiquette finale en bas à gauche
  hud/xray.ts            radiographie 2D (canvas hors écran, révélée de droite à gauche)
  hud/guard-yard.css     styles repris de la référence
  three/constants.ts     repères et dimensions (§5), à l'identique
  three/materials.ts     textures procédurales (graine 7, Lehmer) et matériaux (§6)
  three/environment.ts   renderer, lumières (intensités recalibrées en unités physiques), sol, PMREM
  three/portal.ts        portique de radiographie (§7)
  three/car.ts           voiture extrudée, hologramme, setScan, crush (§8, §9)
  three/crush.ts         crushMap, topOf, halfWOf, halfLOf, solveK : PUR
  three/baler.ts         presse (§10)
  three/crane.ts         grue, IK, grappin, setCrane, hang (§11)
  three/skip.ts          benne et anciens blocs (§12)
  three/timeline.ts      craneAt, swingAt, lidAngle, sideZ, ramX, doorAngle, pressState, baleOut, camAt : PUR
  three/frame.ts         frame(t, ctx) : applique l'état à l'instant t, idempotent
  types.ts               GuardVerdict
  demo-verdict.ts        valeurs de démo, fictives
  verdict.ts             TxEvent/AuditTx -> GuardVerdict
  __tests__/timeline.test.ts, __tests__/collisions.test.ts
app/guard/page.tsx       route /guard (verdict de démo, ou ?tx=<id> lu dans la source)
scripts/guard-yard-shots.ts  captures référence | nous aux 12 instants du §15
```

## Branchement

- Route `/guard` : la scène seule, boutons « Lancer la séquence », « Scanner seulement », « Broyer seulement »,
  « Réinitialiser ».
- Modale depuis la City : un bouton « Voir le contrôle » sur la carte d'analyse quand le verdict est un refus, et dans
  l'audit d'une transaction refusée (écran Transactions). L'état `guard` du store ouvre la modale avec ce verdict.
- Le verdict arrive déjà mappé (`TxEvent` : checks, score, seuils, raisons, preuve, incident DORA). Les lignes lues
  seulement on-chain (`partial`, sans les 5 scores) n'ouvrent pas le contrôle : on n'invente pas de scores.
- Aucune modification du code builders-hub.

## Écarts assumés avec la référence

- three r180 : `colorSpace` au lieu de `encoding`, lumières en unités physiques (calibrées par captures).
- Les boucles d'échantillonnage de `pressState` ajoutent l'instant `t` comme dernier échantillon (§13.3).
- `tEdge` de `baleOut` mémoïsé.
