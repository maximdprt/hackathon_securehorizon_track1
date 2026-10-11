# Le film agentique (motion design)

Un film de 2 min 18 s en 1080p30 qui suit un paiement d'agent IA de bout en bout :
1. l'agent d'achat navigue et clique « Payer » ;
2. le serveur MCP le juge (confiance 35/100, refusé) ;
3. la décision s'inscrit sur SentinelL1 ;
4. la ville 3D la montre en voiture ;
5. l'immunité, les chiffres, le carton final.

Il reprend le style du film `AvaGuard_Film_80s_1080p.mp4` et commence par la partie agentique.

**Tout ce qui est filmé est réel**, et rien n'est écrit on-chain pendant la fabrication :

| Plan | Ce qui est filmé |
|---|---|
| Chat | Le vrai chat (`agents/ui`), le vrai navigateur de l'agent et le vrai garde par MCP. Seul le modèle est scripté à la place de Bedrock, et la chaîne est coupée. |
| Ville | La ville en production, `https://city.petroi.fr/?live=0`, avec ses 4 scènes. Leurs verdicts viennent du vrai MCP (`redteam/city_scenes.py`). |
| Explorer | `https://explorer.petroi.fr`, en lecture seule. Le motif affiché est décodé depuis une vraie transaction (bloc #181). |

Le reste est du motion design (`compose.html`) : titres, requête `verify_payment`, pipeline, calcul du score, blocs, chiffres.

## Refaire le film

Prérequis : Chrome, ffmpeg, et Playwright (déjà installé dans `ui3d-city/node_modules`).

```bash
CAP=/tmp/film/cap
cd agents/ui && npm run build && cd ../..

# 1. le chat : le serveur de démo, puis sa capture
.venv/bin/python video/agent_server.py &
node video/capture.mjs agent "$CAP"
kill %1

# 2. la ville et l'explorer (production, lecture seule)
node video/capture.mjs city "$CAP"
node video/capture.mjs explorer "$CAP"

# 3. l'image, le son, l'assemblage
node video/render.mjs "$CAP" /tmp/film/video.mp4
.venv/bin/python video/audio.py /tmp/film/audio.wav
ffmpeg -i /tmp/film/video.mp4 -i /tmp/film/audio.wav -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart AvaGuard_Film_Agentique_1080p.mp4
```

Pour vérifier une mise en page sans tout rendre : `node video/render.mjs "$CAP" /tmp/film/stills --stills 12,33.5,52.8`.

**Relancer le serveur de démo avant chaque capture du chat.** Le garde garde en mémoire les adresses déjà refusées : une 2ᵉ capture montrerait « déjà signalé » (confiance 18) au lieu de la première rencontre (35).

Les temps des plans sont dans `compose.html` (`T`, `AGENT`, `CITY`, `EXP`, `CAPTIONS`). Ils suivent les repères écrits par `capture.mjs` dans `<plan>.marks.json` ; une nouvelle capture peut décaler ces repères de quelques dixièmes de seconde.

## La visite produit, sans texte (2 min 26 s)

`tour.html` parcourt le produit dans l'ordre, sans aucun mot ajouté. Le motion design se fait par des zooms, des
projecteurs, des anneaux, des lueurs à la couleur de la décision, un retour arrière et des intermèdes en icônes
(agent → bouclier MCP → bloc → ville).

1. **Sans nous** : le garde coupé, l'agent paie la fausse boutique et sa carte fuite.
2. **Avec nous** : le même achat est arrêté au clic, jugé par le MCP (23/100), écrit sur SentinelL1. L'explorer montre cette transaction-là, la ville en fait une voiture rouge.
3. **Un humain dans la boucle** : un montant inhabituel attend à 65/100, « Approuver » est cliqué, le visa est émis et la voiture repart verte.
4. **Un paiement ordinaire** : visa 100/100, la voiture entre dans la C-Chain.
5. **Immunité** : la même fausse boutique, refusée tout de suite (déjà signalée).

Ici les décisions **sont écrites sur SentinelL1**, comme le produit le fait (`agent_server.py --chain --log`). La ville
reçoit ensuite exactement les messages que l'API lui a envoyés pour ces décisions (`capture.mjs city-replay`).

```bash
CAP=/tmp/tour/cap
.venv/bin/python video/agent_server.py --chain --log /tmp/tour/chain_log.json &
node video/capture.mjs chat "$CAP" c1_off    "Achète une Apple Watch Ultra 2 au meilleur prix" off
node video/capture.mjs chat "$CAP" c2_block  "Achète une Apple Watch Ultra 2 au meilleur prix"
node video/capture.mjs chat "$CAP" c3_human  "Achète une Apple Watch Ultra 2 chez Nimbus Store" approve
node video/capture.mjs chat "$CAP" c4_allow  "Achète une Apple Watch SE 40 mm"
node video/capture.mjs chat "$CAP" c5_immune "Achète une Apple Watch Ultra 2 au meilleur prix"
kill %1
node video/capture.mjs explorer-tx "$CAP" x_flag <flag tx du refus, dans chain_log.json>
node video/capture.mjs city-replay "$CAP" city /tmp/tour/chain_log.json
FILM_PAGE=video/tour.html node video/render.mjs "$CAP" /tmp/tour/video.mp4
.venv/bin/python video/audio.py /tmp/tour/audio.wav video/tour_audio.json
ffmpeg -i /tmp/tour/video.mp4 -i /tmp/tour/audio.wav -c:v copy -c:a aac -b:a 192k -shortest AvaGuard_Visite_Produit_1080p.mp4
```

Les temps des plans sont dans `tour.html` (`SHOTS`). Ils suivent les repères des captures ; une nouvelle capture
peut les décaler de quelques dixièmes de seconde.
