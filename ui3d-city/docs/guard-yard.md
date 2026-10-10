# Guard Yard : scanner et broyeur

La séquence qui montre ce que Sentinel fait d'une transaction refusée : la voiture traverse un portique de
radiographie, la card construit la radiographie et les 5 critères, le score tombe (BLOCK), une grue la charge dans une
presse à épaves, la presse la compacte en 3 temps (couvercles, vérin latéral, vérin d'extrémité), le bloc est éjecté
puis posé dans la benne « REGISTRE DES HACKERS ». Référence : `docs/reference/avaguard-fx.html` (elle fait foi).

## Où est le code

- `components/guard-yard/three/` : la scène, en three impératif.
  - `constants.ts` : tous les repères (à ne pas modifier, la logique de contact en dépend ; pour changer la taille,
    mettre la scène dans un groupe et changer son `scale`).
  - `crush.ts` et `timeline.ts` : **purs**, sans scène (écrasement, grue, presse, éjection, caméras, libellés). Ce sont
    eux que testent `components/guard-yard/__tests__/`.
  - `materials.ts`, `environment.ts`, `portal.ts`, `car.ts`, `baler.ts`, `crane.ts`, `skip.ts` : la construction.
  - `frame.ts` : `frame(t, yard)` pose toute la scène à l'instant `t` (idempotent).
- `components/guard-yard/GuardScene.tsx` : construit la scène une fois, joue `frame(T)` dans `useFrame`, libère tout au
  démontage. `GuardYard.tsx` : le Canvas, le HUD, les boutons. `hud/` : la card, le cartouche, l'étiquette (mis à jour
  par refs DOM, jamais de state React par frame).
- `components/guard-yard/GuardYardModal.tsx` : la modale plein écran ouverte depuis la City. `app/guard/page.tsx` : la
  route `/guard`.

## Changer les timings

Tous les instants sont dans `three/timeline.ts` (`craneAt`, `lidAngle`, `sideZ`, `ramX`, `doorAngle`, `baleOut`,
`CAMS`, `phaseAt`) et dans `three/frame.ts` (approche, scan, verdict, card). Les durées globales sont dans
`three/constants.ts` (`DURATION` 22,6 s, `SCAN_END` 8 s, `CRUSH_FROM` 7,6 s). Après un changement : `npm test` (les
contacts sont vérifiés à chaque centième de seconde) puis les captures.

## Brancher un autre verdict

`GuardYard` prend un `GuardVerdict` (`components/guard-yard/types.ts`). `components/guard-yard/verdict.ts` convertit
une transaction de la City (`TxEvent`, issue du schéma `detection/verdict.schema.json`) ; une ligne lue seulement
on-chain (sans les 5 scores) n'ouvre pas le contrôle. Dans la City : le bouton « Voir le contrôle » apparaît sur la
carte d'analyse et dans l'audit d'une transaction refusée ; il fait `sim.set({ guard: verdict })`. Pour l'ouvrir
ailleurs, même appel. `/guard` joue le verdict de démo, `/guard?tx=fraud` ou `?tx=immunity` un scénario.

Seule la décision **block** est mise en scène pour l'instant (`allow` et `human` : étape optionnelle du prompt).

## Relancer les captures

```bash
npm run dev                                                   # dans un autre terminal
node --experimental-strip-types scripts/guard-yard-shots.ts   # artifacts/guard-yard/compare_<t>.png
```

Chaque image met la référence à gauche et notre rendu à droite, aux 12 instants du prompt. `window.__guardSeek(t)`
(dev seulement) pose la scène à `t`.

## Écarts avec la référence

- three r180 au lieu de r128 : les couleurs hex de la référence sont lues comme r128 les lisait (valeurs linéaires,
  `raw()` dans `materials.ts`), et les lumières sont recalibrées en unités physiques (`LIGHT` dans `environment.ts`).
- Polices du projet (Geist) au lieu des polices web de la référence ; libellés « Sentinel » (le nom du produit sur main).
- Les boucles d'échantillonnage de `pressState` ajoutent l'instant `t` lui-même ; la tige du grappin suit le balancement.
- La scène est construite dans un effet (pas un `useMemo`) : le mode strict de React exécute un memo deux fois.
