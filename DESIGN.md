# DESIGN.md — Système de design (Vercel-inspired)

Source de vérité UI pour **tout** ce qu'on génère sur le projet SentinelL1 (explorer, dashboards, landing, slides produit). Direction : le langage **Vercel** — duo noir-encre sur blanc cassé, une seule couleur de CTA (le noir), hairlines fines, ombres empilées très subtiles, titres en sans géométrique à tracking négatif, mono pour tout ce qui est technique (hash, adresses, code).

## Palette
| Rôle | Token | Hex |
|---|---|---|
| Encre / texte / CTA primaire | `ink` / `primary` | `#171717` |
| Texte sur primaire | `on-primary` | `#ffffff` |
| Corps de texte | `body` | `#4d4d4d` |
| Texte discret | `mute` | `#888888` |
| Canvas (fond page) | `canvas-soft` | `#fafafa` |
| Surface carte | `canvas` | `#ffffff` |
| Inset / hover | `canvas-soft-2` | `#f5f5f5` |
| Hairline (bordures 1px) | `hairline` | `#ebebeb` |
| Hairline fort | `hairline-strong` | `#a1a1a1` |
| Lien / info | `link` | `#0070f3` |
| Succès | `success` | `#0070f3` |
| Erreur (paiement bloqué) | `error` | `#ee0000` |
| Warning (needs_human) | `warning` | `#f5a623` |

Gradient de marque (hero uniquement, jamais en petit) : mesh cyan→bleu→magenta→ambre (`#007cf0`→`#00dfd8`, `#7928ca`→`#ff0080`, `#ff4d4d`→`#f9cb28`). C'est la SEULE déco couleur. Pas de 6e accent.

## Typographie
- **Sans** : `Geist` (fallback `Inter, system-ui`). Poids 400/500/600. Le display plafonne à **600** (jamais 700).
- **Mono** : `Geist Mono` (fallback `ui-monospace, Menlo`) pour hash, adresses, code, eyebrows techniques.
- Titres : **sentence-case**, tracking **négatif** (-2.4px à 48px, -1.28px à 32px, -0.6px à 20px). Jamais d'ALL CAPS hors labels mono.
- Échelle : display-xl 48/600/-2.4 · display-lg 32/600/-1.28 · display-md 24/600/-0.96 · body-md 16/400 · body-sm 14/400/-0.28 · caption 12/400 · code 13/400 mono.

## Espacement (base 4px)
`xxs 4 · xs 8 · sm 12 · md 16 · lg 24 · xl 32 · 2xl 40 · 3xl 48 · 4xl 64 · 5xl 96`. Bandes de section : 64→96px haut/bas. Intérieur carte : 24→32px. Gap inline : 12→24px. Container max ~1200-1400px, gouttières 24px desktop / 16px mobile.

## Rayons
`sm 6px` (boutons in-app, inputs) · `md 8px` (cartes feature) · `lg 12px` (grosses cartes) · `pill 100px` (**tous les CTA marketing**) · `full 9999px` (pills de nav, icon-buttons). Deux échelles de pill coexistent : 100px marketing, 6px nav. Ne pas mélanger sur le même écran.

## Élévation (ombres empilées, jamais une seule grosse ombre)
- L1 hairline : `inset 0 0 0 1px #00000014`
- L2 subtle : `0 1px 1px #00000005, 0 2px 2px #0000000a` + hairline
- L4 float : `0 2px 2px #0000000a, 0 8px 16px -4px #0000000a` + hairline
- Profondeur entre bandes = flip de polarité : passer le fond de `#fafafa` à `#171717` (bande sombre).

## Composants clés
- **Bouton primaire** : pill 100px, fond `#171717`, texte blanc, label 16/500. Le noir EST la cible de conversion (1 seul primaire par écran).
- **Bouton secondaire** : pill blanc, texte encre, même géométrie.
- **Carte** : fond blanc, bordure hairline 1px `#ebebeb`, ombre L2, rayon 8-12px.
- **Nav** : barre 64px, fond blanc, logo gauche, liens centre (ghost pill au hover), CTA à droite en pill 6px.
- **Badge/état** : `Live` / `Beta` en caption sur `#fafafa`, pill full. États : succès bleu, erreur rouge (paiement bloqué), warning ambre (needs_human).
- **Table** : header `#fafafa` en caption-mono majuscule, corps body-sm, lignes séparées par hairline.
- **Bloc technique** (hash, adresse, code, calldata) : **toujours en mono**.

## Do / Don't
- ✅ Réserver `#171717` au CTA primaire. ✅ Pills 100px marketing. ✅ Titres 600 sentence-case tracking négatif. ✅ Mono pour le technique. ✅ Ombres empilées + hairline. ✅ Bande sombre = repère de profondeur.
- ❌ Pas de 6e couleur d'accent. ❌ Pas d'ALL CAPS sur les titres. ❌ Pas d'ombre unique lourde. ❌ Pas de gradient en petit/icône. ❌ Pas de sans en 700. ❌ Pas de corps de texte en mono.

## Application à l'explorer SentinelScan (explorer.petroi.fr)
Thème daisyUI surchargé : `base-100 #fff`, `base-200 #fafafa`, `base-300 #ebebeb`, `base-content #171717`, `primary #171717`, `info/success #0070f3`, `error #ee0000`, `warning #f5a623`, radius-box 12px, radius-field 100px, police Geist + Geist Mono (hash/adresses en mono). Détail dans `app.css` du front EROL sur l'EC2.
