# Synthèse recherche : comment un agent IA se fait voler, et quels signaux détectent la fraude

**Auteur** : Bruno (+ Claude). **Date** : 10 oct 2026. **Pour** : scoring Corentin/Bruno, API de vérification Walid, defense sheet Maxime.

Sources : guard.io (Labs + blog + page Tech), Trustpilot (Trust Report 2025, page "Use of AI"), OWASP Agentic Top 10 2026, Simon Willison (lethal trifecta), Invariant Labs (tool poisoning), Lakera (indirect prompt injection), Stripe Radar (doc officielle), FBI/NCSC (BEC), 2 papiers arXiv sur x402, 1 papier arXiv sur les domaines de phishing. Données brutes du scrapper local : `scrape_guardio_trustpilot.json` (même dossier).

---

## 1. Le problème en une image

Un agent IA qui paie a trois pouvoirs en même temps (le "lethal trifecta" de Willison) :

1. **Accès à des données privées** (carte bancaire, wallet, clés, carnet d'adresses).
2. **Exposition à du contenu non fiable** (pages web, emails, docs, descriptions d'outils, autres agents).
3. **Capacité d'agir vers l'extérieur** (payer, transférer, approuver, envoyer).

Un LLM ne distingue pas de manière fiable "instruction de l'opérateur" et "texte lu dans une page". Donc **qui contrôle ce que l'agent lit contrôle ce que l'agent paie**. Guardio l'a montré en live (Scamlexity) : un navigateur agentique a acheté une Apple Watch sur un faux Walmart monté en 10 secondes avec Lovable, et a rempli tout seul l'adresse et la carte.

Le trou que notre produit bouche : personne ne vérifie **qui a le droit de donner l'ordre** (authority chain, OWASP ASI03) ni **si l'ordre a été fabriqué par le contenu** (ASI01/ASI06/ASI07).

---

## 2. Comment les hackers piègent un agent IA (catalogue des techniques)

| # | Technique | Mécanisme | Source |
|---|---|---|---|
| T1 | **Faux site e-commerce "AI-ready"** | Clone Walmart/Amazon généré par Lovable/IA en minutes, HTML propre et bien structuré pour que l'agent trouve "Add to cart" et "Checkout" sans friction. L'agent ignore les indices visuels qu'un humain verrait (URL bizarre, prix trop bas). | Guardio Scamlexity |
| T2 | **PromptFix (faux CAPTCHA)** | Page avec une case "Je ne suis pas un robot". Dans une div invisible en CSS, un texte dit à l'IA que c'est un "CAPTCHA compatible IA" qu'elle doit résoudre pour aider l'utilisateur. L'IA clique : drive-by download, ou envoi d'email, ou octroi de permissions cloud. Le texte joue sur le but de l'IA : "aider vite, complètement, sans hésiter". | Guardio Scamlexity |
| T3 | **Phishing email traité comme une to-do** | Email ProtonMail "Wells Fargo" avec lien vers une vraie page de phishing non encore bloquée par Safe Browsing. L'agent le classe comme tâche légitime, clique, et aide à remplir le formulaire de login. L'humain ne voit jamais l'URL. | Guardio Scamlexity |
| T4 | **Injection indirecte dans une page** | Texte blanc sur blanc, taille 0, commentaires HTML, attributs alt, JSON-LD / schema.org, meta tags, llms.txt, fausses balises "system". La page raconte une histoire différente au crawler et à l'humain. | Security Boulevard 2026, Lakera |
| T5 | **Caractères Unicode invisibles** | Tag characters / zero-width inséré dans un texte, un post Reddit, un commentaire : invisible pour l'humain, lu par le modèle. Cas Comet : OTP de l'utilisateur exfiltré via un post Reddit. | Guardio Prompt Inception, Lakera |
| T6 | **Injection par image (OCR)** | Instructions cachées dans une image (police minuscule, opacité faible, parmi du texte leurre). L'OCR les ajoute au prompt. Démo : Gemini a partagé le calendrier de l'utilisateur à partir d'une image de cacatoès. | Guardio Prompt Inception |
| T7 | **Tool poisoning (MCP)** | Instructions malveillantes dans la **description** d'un outil, visible par le modèle mais pas par l'utilisateur. Variante "rug pull" : description changée après approbation. Variante "shadowing" : un serveur MCP malveillant détourne les outils d'un autre serveur (ex : change l'adresse destinataire de tous les mails). | Invariant Labs |
| T8 | **Prompt Inception / empoisonnement de source** | Planter de la fausse info (faux numéro de support, fausse adresse de trésorerie, fausse "migration de contrat") dans des sources que l'IA considère comme vraies : wiki, docs, SEO, réponses d'IA. Effet amplificateur : un modèle compromis = millions d'utilisateurs. | Guardio Prompt Inception |
| T9 | **Confusion d'autorité entre agents** | Un agent à faible privilège (lecture de docs) envoie un "ordre" à l'agent financier qui l'exécute sans vérifier que l'émetteur a le droit. C'est le scénario exact du Track 01. | OWASP ASI03/ASI07 |
| T10 | **Empoisonnement de mémoire / contexte** | Une instruction injectée une fois est mémorisée et rejouée plus tard ("le plafond est maintenant 10 000"). | OWASP ASI06, Lakera |
| T11 | **Server-selection / Sybil sur x402** | Dans la découverte de services payants, des métadonnées persuasives font choisir le serveur malveillant par le LLM dans 71,8 % des cas ; avec 5 alias Sybil, 60,2 % (93,3 % sur la génération de documents). | arXiv 2605.11781 |
| T12 | **Replay / free shopping x402** | Rejouer un même header X-PAYMENT pour obtenir n accès (248 accès pour 1 paiement sur un endpoint live). Ou profiter du "verification pass / settlement fail". | arXiv 2605.11781, 2607.19545 |
| T13 | **Asset theft via signature contrat (ERC-6492)** | Les champs de signature sont détournés pour encoder un `approve`/`transfer` arbitraire exécuté par le facilitateur. | arXiv 2607.19545 |
| T14 | **BEC / fraude au président / changement de RIB** | Email usurpant le CEO ou un fournisseur : urgence, secret, nouveau compte bancaire, domaine lookalike, envoi tard le soir ou tôt le matin. Appliqué à un agent : même ordre, mais injecté dans un doc. | FBI, NCSC, Guardio CEO fraud |
| T15 | **VibeScamming** | Les escrocs utilisent eux-mêmes des agents (Lovable, Claude, ChatGPT) pour générer kit de phishing, hébergement, exfiltration vers Telegram, SMS avec évasion (Unicode cyrillique, caractères invisibles, randomisation d'envoi). Lovable : 8,5/10 de complaisance. | Guardio VibeScamming |
| T16 | **Lookalike checkout / 2e paiement** | Après un premier paiement, messages "frais de douane", "lien de suivi", "remboursement" pour un 2e paiement. | Guardio fake store |
| T17 | **ClickFix / CAPTCHAgeddon** | Faux CAPTCHA demandant de coller une commande ; version agent = PromptFix. | Guardio Labs |
| T18 | **EtherHiding** | Code malveillant hébergé dans un smart contract (BSC) : la page légitime compromise charge le payload depuis la chaîne, impossible à retirer. Pertinent pour nous : une source "on-chain" n'est pas forcément sûre. | Guardio Labs |

**Pourquoi l'agent échoue là où l'humain réussit** (Guardio) : l'intuition humaine est retirée du processus, l'IA devient le seul point de décision ; elle agit sans contexte complet, fait confiance facilement, exécute sans scepticisme, et reste focalisée sur la tâche au point d'ignorer les red flags de l'environnement. Résultats non déterministes : sur le faux Walmart, Comet refusait parfois, et parfois achetait sans aucune supervision.

---

## 3. Signaux qu'un **site / marchand** est frauduleux (features)

### 3.1 Domaine et infrastructure (forts, automatisables)
- **Âge du domaine** : médiane < 28 jours pour les fausses boutiques ; WHOIS < 30 jours + registrar masqué = 0,87 d'accuracy en XGBoost. Prédicteur n°1 dans la littérature.
- **TLD** : 61 % des 2,3 M de faux sites e-commerce analysés sont en `.shop`, `.store`, `.online` ; 24 % en nouveaux gTLD (`.xyz`) ; < 4 % chez les vrais retailers UK/US. Attention : 89 % des pages de phishing sur hébergeurs gratuits ont un `.com` (sous-domaine de la plateforme, donc âge WHOIS = celui de la plateforme).
- **Hébergement** : hébergeur gratuit, sous-domaine `*.lovable.app`, `*.vercel.app`, `*.netlify.app`, `*.pages.dev` pour un "Walmart".
- **Certificat TLS** : Let's Encrypt domine chez les domaines de phishing (gratuit, auto, 90 jours) ; validité courte ; pas d'OV/EV.
- **Nom de domaine** : longueur, nombre de sous-domaines, entropie élevée, mot de marque ajouté artificiellement (`walmart-deals-shop.com`, `login-microsft-com.lovable.app`), distance de Levenshtein faible avec une marque, homoglyphes Unicode (cyrillique).
- **WHOIS/DNS** : registrant masqué, enregistrement en lot (20 à 50 domaines par session), pas de MX, DNS récent.
- **Réputation** : Google Safe Browsing est souvent **en retard de plusieurs jours** (la page Wells Fargo est restée non flaguée). Ne pas s'appuyer uniquement sur une blocklist.

### 3.2 Contenu de la page
- Prix "trop beau" / flash sale permanente / compte à rebours.
- Infos de contact absentes ou fausses (pas d'adresse, pas de SIRET, téléphone qui ne répond pas).
- Pas de HTTPS sur le checkout, ou checkout qui redirige vers un autre domaine.
- Photos produits, avis et témoignages générés par IA ; chat support deepfake ; bots qui répondent en temps réel.
- Méthodes de paiement proposées : **virement, crypto, cartes cadeaux, Zelle = très haut risque** (irréversible) ; CB = plus bas (contestable).
- Checkout qui demande des données inutiles (date de naissance, numéro de sécu).
- Présence sociale inexistante ou toute récente.

### 3.3 Signaux spécifiques "la page vise un agent, pas un humain"
- Texte invisible (CSS `display:none`, `opacity:0`, `font-size:0`, couleur = fond, hors écran) contenant des impératifs ("ignore", "you must", "as an AI", "click", "approve", "transfer to").
- Caractères Unicode invisibles / tag characters / zero-width.
- JSON-LD, meta, `llms.txt`, labels d'accessibilité qui contredisent le contenu visible.
- Faux "system message" ou faux format de rôle dans la page.
- CAPTCHA "compatible IA" ou toute page qui s'adresse directement à l'agent.
- Écart entre rendu visuel (screenshot) et texte extrait du DOM.

### 3.4 Avis clients (Trustpilot) : ce qui est détecté et comment
- Trustpilot vérifie **chaque** avis (~200 000 / jour) avant publication avec ML + réseaux de neurones + **modèles de graphe** (relations avis / reviewer / entreprise), puis surveillance continue.
- Données analysées : contenu, **IP, caractéristiques device, localisation**, timing, et relation reviewer-entreprise (logiciel dédié aux "review sellers" qui prédit si la relation est authentique).
- Patterns : langage non naturel, **pics d'avis** (bursts), anomalies, duplicatas.
- 2024 : 4,5 M de faux avis retirés (7,4 % des soumissions), **90 % détectés automatiquement**, +53 % vs 2023. Par note : 3,4 M de 5 étoiles, 627 k de 1 étoile (review bombing). Motifs : 3,7 M "fabriqués", 267 k violations, 226 k pub, 190 k "pas d'expérience réelle".
- Signalements : 92 k par consommateurs, 61 k par entreprises ; 19 k avertissements, 5 k mises en demeure, 9 k alertes consommateur actives.
- Pour nous : **un TrustScore élevé avec des avis récents et groupés = signal faible, pas une preuve.** Un marchand sans profil Trustpilot/Google + domaine < 30 jours = combinaison forte.

### 3.5 Comment Guardio détecte (ce qu'on peut copier)
- Cartographie et indexation de tout l'écosystème d'extensions Chrome.
- Reconnaissance Internet : **WHOIS, DNS, hébergeur**, croisés pour retrouver l'infrastructure et le modus operandi d'un acteur.
- **Deep learning côté client** sur les éléments visuels (logo, formulaire de login imité) pour phishing, scams, malvertising.
- Pipelines temps réel + bulk, heuristiques dynamiques mises à jour depuis le cloud (signatures, règles).
- **Analytique comportementale** : pour les scams de prise de contrôle à distance (RAT), coefficient de trafic : peu de visites répétées par utilisateur + trafic erratique dans la journée (Di > 1) = site utilisé pour cibler une victime à la fois.
- Recommandations Guardio pour les navigateurs IA : réputation d'URL avant navigation, alerte de spoofing de domaine, scan des fichiers, **détection d'anomalie comportementale adaptée à l'IA**, le tout **dans la boucle de décision de l'agent**, pas "bolt-on".

---

## 4. Signaux qu'un **virement / paiement** est frauduleux

### 4.1 Signaux "ordre de paiement" (BEC transposé aux agents)
- **Nouveau bénéficiaire** ou **changement de RIB/adresse** récent (vendor email compromise).
- **Urgence** ("avant 17 h", "dernier rappel"), **secret** ("ne pas en parler"), **contournement de procédure** ("skip review", "ignore la limite").
- Horaire inhabituel (nuit, très tôt, week-end), canal inhabituel (email au lieu du portail, doc partagé au lieu de l'ERP).
- Émetteur : display name ≠ adresse, domaine lookalike, reply-to différent, email gratuit (ProtonMail/Gmail) pour une banque.
- **Ordre qui provient d'un contenu lu** (doc, page, email, output d'outil) et non du mandat de l'utilisateur.
- Montant juste sous un seuil d'approbation, ou fractionné.
- Destination : crypto, virement international, pays à risque, compte ouvert récemment.

### 4.2 Signaux "transaction" (façon Stripe Radar)
Stripe score chaque paiement de 0 à 99 avec des centaines de facteurs + données réseau ; **≥ 65 = risque élevé (revue manuelle), ≥ 75 = très élevé (bloqué par défaut)**. Les règles font 4 choses : demander 3DS, autoriser, bloquer, mettre en revue. Le feedback (remboursement "fraudulent") alimente des blocklists email + empreinte carte. C'est exactement le modèle allow / needs_approval / block de notre verdict.
Facteurs typiques : vélocité (n paiements / heure / carte / IP), mismatch géographique IP vs adresse de facturation vs pays carte, email jetable, device fingerprint déjà vu en fraude, historique de litiges, montant atypique pour le marchand, heure.

### 4.3 Signaux on-chain / x402 (notre terrain)
- Adresse destinataire **jamais vue** par l'émetteur, créée récemment, sans historique, ou présente dans notre registre d'incidents.
- `approve` illimité ou vers un contrat non vérifié ; signature contrat (ERC-6492) contenant un call arbitraire.
- Nonce / header X-PAYMENT réutilisé (replay) ; `resource_url`/`description`/`reason` en clair contenant des PII ou des instructions.
- Ressource délivrée avant finalité : exiger k ≥ 3 confirmations pour < 1 $ et k ≥ 12 pour ≥ 10 $ (arXiv).
- Facilitateur : 15/15 facilitateurs étudiés violaient au moins une règle ; 14/15 acceptaient des règlements économiquement absurdes ; 93 % des serveurs dépendent d'un seul facilitateur. Signal : facilitateur hors liste d'endorsement, ou `msg.sender` ≠ facilitateur endorsé.
- Montant ≠ prix annoncé dans le 402 (overpayment / drain), gas anormal (ATA creation spam : 22,9 k tx suspectes, 5,7 k $).

---

## 5. Données d'entrée que notre scoring doit collecter

Voir `features_scoring.json` pour la version machine. Résumé par bloc, avec le poids suggéré et la "preuve" à logger on-chain (exigence KPMG : chaque décision a une preuve, seuils clairs).

| Bloc | Feature | Type | Poids (0-1) | Seuil / règle |
|---|---|---|---|---|
| Autorité | `issuer_in_registry` | bool | 0.35 | faux → block |
| Autorité | `amount_within_mandate` | bool | 0.25 | faux → needs_approval ; > 2× limite → block |
| Autorité | `recipient_whitelisted` | bool | 0.15 | nouveau destinataire + montant > seuil → needs_approval |
| Autorité | `order_origin` | enum user / doc / tool / agent | 0.20 | origine ≠ user → +0.2 risque |
| Poison | `hidden_text_ratio` | float | 0.20 | > 0 avec impératifs → block |
| Poison | `imperative_to_agent` | bool | 0.25 | "ignore", "as an AI", "skip review" → block |
| Poison | `invisible_unicode_count` | int | 0.15 | > 0 → needs_approval |
| Poison | `mandate_override_attempt` | bool | 0.30 | changement de limite / trésorerie dans le contenu → block |
| Poison | `dom_vs_visual_mismatch` | float | 0.15 | > 0.3 → needs_approval |
| Marchand | `domain_age_days` | int | 0.20 | < 30 → +0.3 ; < 7 → +0.5 |
| Marchand | `tld_risk` | enum | 0.10 | .shop/.store/.online/.xyz → +0.15 |
| Marchand | `free_hosting_subdomain` | bool | 0.15 | lovable.app, vercel.app… pour une marque → +0.4 |
| Marchand | `brand_lookalike_score` | float | 0.20 | Levenshtein ≤ 2 ou homoglyphe → +0.4 |
| Marchand | `tls_issuer_validity` | tuple | 0.05 | LE + 90 j + domaine < 30 j → +0.1 |
| Marchand | `safe_browsing_flag` | bool | 0.15 | vrai → block (mais absence ≠ sûr) |
| Marchand | `review_profile` | obj | 0.10 | pas de profil ou avis groupés < 14 j → +0.15 |
| Marchand | `payment_methods_offered` | set | 0.10 | crypto/virement/gift card seuls → +0.3 |
| Marchand | `price_deviation` | float | 0.10 | > 50 % sous le marché → +0.2 |
| Transaction | `amount_vs_history_zscore` | float | 0.15 | > 3 → needs_approval |
| Transaction | `velocity_1h` | int | 0.10 | > 3 paiements/h pour un agent → needs_approval |
| Transaction | `time_of_day_anomaly` | bool | 0.05 | hors fenêtre habituelle → +0.05 |
| Transaction | `urgency_secrecy_markers` | int | 0.15 | ≥ 2 marqueurs → +0.2 |
| Transaction | `bank_detail_change_recent` | bool | 0.20 | vrai → needs_approval |
| On-chain | `recipient_flagged_onchain` | bool | 0.40 | vrai → block direct (2e fois) |
| On-chain | `recipient_age_tx_count` | tuple | 0.10 | adresse < 24 h et 0 tx → +0.2 |
| On-chain | `approve_unlimited` | bool | 0.20 | vrai → needs_approval |
| On-chain | `facilitator_endorsed` | bool | 0.15 | faux → block |
| On-chain | `nonce_replay` | bool | 0.30 | vrai → block |
| On-chain | `amount_matches_402_quote` | bool | 0.15 | faux → block |

Décision (seuils façon Stripe, calibrés sur 0-1) : **score < 0.35 → allow ; 0.35 à 0.70 → needs_approval ; > 0.70 ou toute règle "block" → block.** Toute règle "block" dure (autorité, flag on-chain, replay) court-circuite le score.

---

## 6. Chiffres clés pour le pitch et la defense sheet

| Chiffre | Source |
|---|---|
| 10 s pour générer un faux Walmart fonctionnel (Lovable) | Guardio Scamlexity |
| Page de phishing Wells Fargo non flaguée par Safe Browsing pendant plusieurs jours | Guardio Scamlexity |
| Comet : phishing réussi en < 4 min ; OTP exfiltré via post Reddit | THN, Lakera |
| 71,8 % de sélection du serveur malveillant par métadonnées ; 93,3 % avec Sybil | arXiv x402 |
| 248 accès pour 1 paiement (replay x402, endpoint live) | arXiv x402 |
| 15/15 facilitateurs x402 avec au moins une violation ; 119 M tx analysées | arXiv 2607.19545 |
| Faux sites : médiane < 28 jours d'âge ; 61 % en .shop/.store/.online | recherche e-commerce |
| Trustpilot : 4,5 M faux avis retirés en 2024, 90 % auto, 200 k avis vérifiés / jour | Trust Report 2025 |
| Fraude consommateurs US 2024 : 12,5 Md$, +25 % | FTC via memx |
| Stripe Radar : 0-99, ≥ 65 revue, ≥ 75 bloqué | doc Stripe |
| VibeScamming : Lovable 8,5/10, Claude 6,5/10, ChatGPT 3,5/10 de complaisance | Guardio |
| Guardio : valorisation 1,1 Md$ | Guardio |

---

## 7. Mapping OWASP Agentic Top 10 (2026)

ASI01 Goal Hijack · ASI02 Tool Misuse · **ASI03 Identity & Privilege Abuse** · ASI04 Supply Chain · ASI05 Code Execution · ASI06 Memory & Context Poisoning · **ASI07 Insecure Inter-Agent Communication** · ASI08 Cascading Failures · ASI09 Human-Agent Trust Exploitation · ASI10 Rogue Agents.

Notre garde couvre directement ASI03 (l'émetteur a-t-il l'autorité ?) et ASI07 (l'ordre inter-agents est-il authentifié et non rejoué ?), et détecte les symptômes de ASI01/ASI06 (ordre fabriqué par le contenu) et ASI09 (l'humain est mis dans la boucle seulement quand c'est nécessaire).

---

## 8. Ce que ça change pour notre archi

1. **Le visa doit être lié** à (émetteur, action, montant, destinataire, nonce, facilitateur) : sinon replay et preemption (arXiv M1/M2/M3).
2. **Séparer les trois pouvoirs** : l'agent qui lit les pages ne doit pas être celui qui signe ; le garde est le seul à pouvoir délivrer le visa.
3. **Origine de l'ordre** = feature de premier rang : un ordre né d'un doc, d'une page ou d'un autre agent est par défaut `needs_approval`.
4. **Blocklist ≠ sécurité** : Safe Browsing est en retard de jours ; nos features de domaine et de contenu doivent fonctionner à froid (zero-day).
5. **Registre on-chain des adresses hackers** = le "feedback loop" de Stripe : chaque block alimente la liste, la 2e fois est un refus direct.
6. **Logger la preuve** : pour chaque décision, les features déclenchées et leurs valeurs (exigence KPMG, DORA/MiCA).

---

## 9. Sources

- https://guard.io/labs/scamlexity-we-put-agentic-ai-browsers-to-the-test-they-clicked-they-paid-they-failed
- https://guard.io/labs/vibescamming-from-prompt-to-phish-benchmarking-popular-ai-agents-resistance-to-the-dark-side
- https://guard.io/labs/prompt-inception-when-ai-becomes-the-single-source-of-truth-whose-truth-will-it-be
- https://guard.io/labs/oh-rats-how-guardio-found-a-way-to-detect-the-nastiest-of-scams
- https://guard.io/tech
- https://guard.io/blog/detect-fake-shopping-sites
- https://guard.io/blog/fake-store-red-flags-what-to-do-if-you-paid
- https://guard.io/blog/why-the-ceo-phishing-scam-is-more-dangerous-than-ever
- https://corporate.trustpilot.com/trust/trust-report-2025
- https://corporate.trustpilot.com/trust/trustpilot-use-of-ai
- https://securityboulevard.com/2026/09/when-phishing-sites-are-built-to-fool-your-ai-agent-not-you/
- https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- https://www.lakera.ai/blog/indirect-prompt-injection
- https://docs.stripe.com/radar/risk-evaluation
- https://arxiv.org/html/2605.11781v1 (Five Attacks on x402)
- https://arxiv.org/html/2607.19545v1 (When HTTP 402 Meets the Blockchain)
- https://arxiv.org/pdf/2603.21652 (TLS/domain features of phishing domains)
- https://www.humansecurity.com/learn/blog/owasp-top-10-agentic-applications/
- https://memx.app/blog/ai-shopping-agents-fake-stores-scam/
