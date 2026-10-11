# Photos des produits

Déposez ici les photos des produits vendus par les boutiques du bac à sable. Sans photo, la boutique affiche une
illustration dessinée (SVG) : la démo fonctionne donc aussi avec ce dossier vide.

## Où et sous quel nom

Un fichier par produit, nommé par l'identifiant du produit (`world.PRODUCTS`) :

| Fichier                 | Produit                              |
|-------------------------|--------------------------------------|
| `se-40.<ext>`           | Apple Watch SE (2e génération) 40 mm |
| `series-10-42.<ext>`    | Apple Watch Series 10 42 mm          |
| `series-10-46.<ext>`    | Apple Watch Series 10 46 mm          |
| `ultra-2.<ext>`         | Apple Watch Ultra 2 49 mm            |
| `bracelet.<ext>`        | Bracelet sport pour Apple Watch      |
| `cable-usb-c.<ext>`     | Câble de recharge USB-C 2 m          |

- Formats acceptés : `png`, `jpg`, `jpeg`, `webp`, `avif`. La casse du nom ne compte pas (`SE-40.PNG` convient).
- `agents/sites/images/se-40.png` : l'image commune, affichée par les 5 boutiques.
- `agents/sites/images/<boutique>/se-40.png` : une image propre à une boutique, prioritaire sur l'image commune.
  Les boutiques : `nimbus`, `orchard`, `meridian`, `techbazaar`, `tempo`.
- Tout autre fichier du dossier est ignoré (ce README compris).

## Ce qui se passe ensuite

La photo apparaît sur le catalogue, la fiche produit, le panier et la vignette des résultats de recherche. Il n'y a
rien à redémarrer : le dossier est relu à chaque page. Une photo remplacée est rechargée d'elle-même.

Les photos sont servies par `agents/app.py` à l'adresse `/sites/images/<boutique>/<produit>`. Elles sont affichées
entières (`object-fit: contain`) sur fond blanc, dans une boîte de taille fixe : un fond blanc ou transparent et un
cadrage serré donnent le meilleur rendu, quelle que soit la proportion de l'image. Préférez des fichiers légers
(quelques centaines de Ko au plus).

## Droits

Ce dépôt sera public. N'y déposez que des photos dont vous avez les droits (vos propres photos, images libres de
droits, visuels de presse dont la licence autorise la republication). Dans le doute, gardez les photos sur votre
machine sans les committer : la démo fonctionne de la même façon.
