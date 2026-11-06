# Mint — référence design

Ce document accompagne les maquettes du dossier `design/`. Il donne les valeurs exactes à reproduire et les comportements qu'une image fixe ne montre pas.

## 1. Décisions prises

| Sujet | Décision |
|---|---|
| Nom du jeu | **Mint** (état neuf + frapper monnaie) |
| Monnaie | **Credits**, abrégé `CR` (ex. `4,870 CR`) |
| Langue | Interface entièrement en anglais, termes CS gardés tels quels (Mil-Spec, FN, StatTrak™…) |
| Plateformes | Web desktop d'abord, tablette, mobile, et activité Discord |
| Connexion | On joue d'abord en invité (première caisse tout de suite), connexion Discord pour sauvegarder |
| Identité visuelle | Galerie de collection (calme, aérée, objets exposés) + touches HUD (labels mono, coins en équerre, biseaux) |
| Couleur | Thème sombre, **aucune couleur d'accent** : noirs, gris, blanc pour les actions. La couleur vient uniquement des raretés |
| Navigation | Desktop : barre latérale gauche (logo, 9 sections, solde et profil en bas). Mobile : barre d'onglets Home, Cases, Inventory, Albums, More |
| Carte d'objet | Barre fine de rareté en bas + halo de rareté derrière l'arme |
| Ouverture | Révélation graduée : discrète pour Mil-Spec, marquée pour Covert, plein écran or pour couteau/gants |
| Typographie | Grotesque pour le texte, mono pour tous les chiffres |
| Inventaire | Grille aérée, 4 à 5 colonnes sur desktop |
| Barre de float | Dégradé vert → rouge par zone d'état |

## 2. Tokens

### Couleurs de l'interface

| Rôle | Valeur |
|---|---|
| Fond de page | `#0A0B0D` |
| Rails (barre latérale, bandeau global, barre d'onglets) | `#0D0E11` |
| Surface (cartes, panneaux) | `#0E1013` |
| Surface relevée (tuiles internes, roulette) | `#121417` |
| Barre de sélection, toasts | `#111316` |
| Item de nav actif / survol | `#16181C` / `#15171B` |
| Bordure | `#1C1F24` |
| Séparateur | `#1A1D22` |
| Bordure forte (champs, boutons secondaires) | `#2C3138` |
| Bordure au survol | `#4A5059` |
| Coins en équerre (HUD) | `#5A616B` |
| Fond de barre de progression vide | `#1E2227` |
| Texte principal | `#ECEDEF` |
| Texte secondaire | `#A1A7AF` |
| Texte tertiaire, labels | `#858B94` |
| Bouton désactivé | fond `#3A3F46`, texte `#A1A7AF` |
| Bouton principal | fond `#ECEDEF`, texte `#0A0B0D`, survol `#FFFFFF` |
| Erreur | texte `#F27D7D` |
| Point « urgent » (enchères) | `#C8382F` |

Contraste vérifié : `#858B94` reste au-dessus de 4.5:1 sur toutes les surfaces.

### Raretés

| Rareté | Couleur (barres, pastilles) | Texte sur fond sombre | Halo |
|---|---|---|---|
| Mil-Spec | `#4B69FF` | `#8197FF` | `rgba(75,105,255,0.30)` |
| Restricted | `#8847FF` | `#A983FF` | `rgba(136,71,255,0.32)` |
| Classified | `#D32CE6` | `#E57AF0` | `rgba(211,44,230,0.30)` |
| Covert | `#EB4B4B` | `#F27D7D` | `rgba(235,75,75,0.32)` |
| Couteau / gants (★) | `#E4AE39` | `#ECC163` | `rgba(228,174,57,0.36)` |

Les couleurs de base ne passent pas toutes 4.5:1 en texte : utiliser la colonne « Texte » pour tout libellé coloré. Skin manquant dans un album : barre de rareté à 30 % d'opacité.

### Usure (barre de float uniquement)

| État | Abr. | Float | Couleur | Largeur de zone |
|---|---|---|---|---|
| Factory New | FN | 0.00–0.07 | `#3FB950` | 7 |
| Minimal Wear | MW | 0.07–0.15 | `#9BC53D` | 8 |
| Field-Tested | FT | 0.15–0.38 | `#E3B341` | 23 |
| Well-Worn | WW | 0.38–0.45 | `#F0883E` | 7 |
| Battle-Scarred | BS | 0.45–1.00 | `#F05D52` | 55 |

### Typographie

- Texte : **Instrument Sans** 400/500/600/700, repli `'Helvetica Neue', Arial, sans-serif`.
- Chiffres et labels : **JetBrains Mono** 400/500/600, repli `ui-monospace, 'SF Mono', Menlo, monospace`, toujours avec `font-variant-numeric: tabular-nums`.
- Label HUD : mono 11 px, 500, majuscules, `letter-spacing: .14em`, `#858B94`, souvent préfixé `// ` (ex. `// DAILY DROP`).
- Échelle : titre de page 40 px / 600 / `-0.02em` ; hero 52–56 px ; nom d'objet en fiche 48–52 px ; titre de section 18 px / 600 ; corps 14–15 px ; secondaire 12–13 px.
- Floats affichés à 4 décimales sur les cartes (`0.2381`), 9 sur les fiches (`0.238104546`).
- Logo : carré blanc 16 px au coin inférieur droit coupé (`clip-path: polygon(0 0,100% 0,100% 62%,62% 100%,0 100%)`) + `MINT` en mono 600, `letter-spacing: .34em`.

### Formes, espacements, tailles

- Rayons : 2 px boutons, champs, puces ; 4 px cartes et tuiles ; 6 px panneaux ; avatars ronds.
- Biseau des actions principales : `clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)`.
- Coins HUD : 4 équerres de 18–22 px, trait 1 px `#5A616B` (ou couleur de rareté pour un objet mis en avant), posées à 12–28 px des bords.
- Halo : `radial-gradient(closest-side, <halo>, transparent)` derrière l'image, environ 80 % de la zone.
- Barre latérale 248 px ; contenu `max-width: 1240px`, marges 48 px ; gouttières 8 à 40 px.
- Boutons : 48 px (principal), 44 px (secondaire), 52–56 px (hero, mobile) ; puces 36–40 px ; cible tactile minimale 44 px.
- Mobile : 390 px de large, 50 px laissés libres en haut pour la barre d'état, barre d'onglets de 84 px.

### Animations

| Élément | Valeur |
|---|---|
| Roulette | `transform` 6.2 s `cubic-bezier(0.1, 0.62, 0.1, 1)` |
| Apparition de l'objet | scale .9→1, 480 ms `cubic-bezier(.2,.9,.3,1.2)` |
| Panneau d'infos | translateY 12 px→0, 500 ms, délai 150 ms |
| Halo Covert | pulsation d'opacité .7↔1, 2.6 s |
| Rayons or (couteau) | rotation 80 s, linéaire, en boucle |
| Chrono urgent | point qui clignote, 1 s |

Toutes les animations se coupent avec `prefers-reduced-motion: reduce` (roulette ramenée à 0.6 s).

## 3. Composants

- **Carte d'objet** : surface `#0E1013`, bordure `#1C1F24`, rayon 4. Zone image 4:3 avec halo et silhouette, puis arme (12 px, gris), nom du skin (15 px, 600), ligne mono `FT · 0.2381` avec un carré de la couleur d'usure, valeur `2,500 CR` à droite. Barre de rareté 3 px en bas. Badge `ST™` blanc en haut à droite. Sélectionnée : bordure `#ECEDEF` + case cochée blanche en haut à gauche. Verrouillée (en vente, en trade) : image à 40 %, étiquette cadenas `LISTED` / `IN TRADE`, pas de case.
- **Barre de float** : 5 zones à l'échelle (2 px d'écart), curseur blanc de 2 px à la position exacte, abréviations en mono 10 px dessous. Hachures sombres en dehors du min/max du skin.
- **Bandeau global** : 40 px, en haut du contenu sur tous les écrans desktop, `★ GLOBAL DROP` en or, joueur, objet en texte or, ancienneté à droite. Uniquement pour couteaux et gants.
- **Compte à rebours** : normal = mono sur fond sombre. Dans les 2 dernières minutes = bloc inversé (fond blanc, texte noir) + point rouge qui clignote + « A bid now adds 2 minutes ».
- **Boutons** : principal blanc biseauté ; secondaire contour `#2C3138` ; tertiaire texte gris souligné.
- **Onglets** : texte 15 px, actif blanc avec soulignement 2 px. Sur mobile : contrôle segmenté, segment actif blanc.
- **Puce de rareté** : carré de couleur 8 px + libellé ; active = fond `#1E2227` et contour blanc.
- **Barre de sélection** : apparaît au-dessus de la grille dès qu'un objet est coché (nombre, valeur, Clear, List on market, Recycle).
- **Accueil desktop, fil d'activité et Today** : côte à côte (2/3 – 1/3). Le panneau Today fixe la hauteur de la rangée ; le fil des amis prend la même hauteur et fait défiler ses 10 dernières entrées. Empilés quand la place manque (sous 1 128 px de fenêtre), le fil s'affiche alors en entier.
- **Carte d'offre de trade** : en-tête (joueur, expiration, statut), deux colonnes « You give » / « You get » avec total estimé, pied avec l'écart de valeur et les actions.

## 4. Écrans et fichiers

| Écran | Desktop | Mobile | Phase |
|---|---|---|---|
| Accueil (invité / connecté) | `Main.dc.html` | `Mobile-Home.dc.html` | 1 |
| Caisses | `Cases.dc.html` | `Mobile-Cases.dc.html` | 1 |
| Ouverture | `Opening.dc.html` | `Mobile-Opening.dc.html` | 1 |
| Inventaire | `Inventory.dc.html` | `Mobile-Inventory.dc.html` | 1–2 |
| Fiche objet | `Item.dc.html` | `Mobile-Item.dc.html` | 3 |
| Album | `Album.dc.html` | `Mobile-Album.dc.html` | 3 |
| Connexion Discord | `Connect.dc.html` | `Mobile-Connect.dc.html` | 1 |
| Menu More | — | `Mobile-More.dc.html` | 4 |
| Amis | `Friends.dc.html` | `Mobile-Friends.dc.html` | 4 |
| Profil + vitrine | `Profile.dc.html` | `Mobile-Profile.dc.html` | 4 |
| Trades | `Trades.dc.html` | `Mobile-Trades.dc.html` | 5 |
| Nouvelle offre | `TradeNew.dc.html` | `Mobile-TradeNew.dc.html` | 5 |
| Maison des ventes | `Market.dc.html` | `Mobile-Market.dc.html` | 6 |
| Fiche d'enchère | `Auction.dc.html` | `Mobile-Auction.dc.html` | 6 |
| Mise en vente | `Sell.dc.html` | `Mobile-Sell.dc.html` | 6 |
| Contrat d'échange | `TradeUp.dc.html` | `Mobile-TradeUp.dc.html` | 7 |
| Classement | `Leaderboard.dc.html` | `Mobile-Leaderboard.dc.html` | 7 |
| Fondations (tokens, composants) | `Foundations.dc.html` | — | — |

Le panneau admin (`Admin-*.dc.html`, 18 maquettes) est décrit dans `docs/ADMIN.md`.

## 5. Comportements à reproduire

**Ouverture**
- Bouton « Open case · 250 CR ». Le serveur tire le résultat, puis le client lance la roulette.
- Bande de 48 cartes (152 × 184 px, pas de 160 px) ; le résultat est la carte 40, la 41e est une carte « ★ Rare special » pour l'effet « presque ». Le repère central est un trait blanc avec deux triangles. Bords de la bande en fondu.
- Révélation selon la rareté :

| Rareté | Halo | Fond de scène | Coins HUD | Autre |
|---|---|---|---|---|
| Mil-Spec | petit | neutre | non | — |
| Restricted | moyen | neutre | non | — |
| Classified | grand | lueur rose | oui | — |
| Covert | maximal, pulsé | lueur rouge | oui | — |
| Couteau / gants | — | — | — | plein écran or, rayons tournants, « Announced to every player » |

- Actions : Keep, Recycle (+valeur), List on market, Open another. Recycler demande une confirmation à partir de Classified.

**Inventaire** : filtres rareté, StatTrak, usure, caisse, recherche ; tri valeur, date, float. Chaque carte a une case de sélection séparée du lien vers la fiche. Recycler une sélection qui contient du Classified ou mieux demande une confirmation.

**Album** : skins possédés en couleur avec le meilleur float ; manquants en silhouette sombre, cadre en pointillés, « Not collected » et lien vers le marché. Barre de complétion segmentée par skin.

**Trades** : les objets d'une offre ouverte sont verrouillés partout. Étiquette « Album +1 » sur un objet qui comblerait un trou dans un album du joueur. Accepter échange les deux côtés en une seule opération.

**Enchères** : enchère minimale = enchère actuelle + 5 % (arrondi au supérieur). Le montant est bloqué sur le solde (« Held in bids » sous le solde) et rendu dès que quelqu'un surenchérit. Une enchère dans les 2 dernières minutes ajoute 2 minutes. Achat immédiat avec confirmation, disponible tant que l'enchère actuelle est sous ce prix. Interdit d'enchérir sur ses propres ventes.

**Mise en vente** : prix de départ, achat immédiat optionnel (doit dépasser le prix de départ), durée 24 h ou 48 h. Affiche le net après la taxe de 5 % et la valeur de recyclage pour comparer. 10 ventes actives maximum.

**Contrat d'échange** : 10 emplacements d'une même rareté, tous StatTrak ou aucun, Covert interdit pour l'instant. Probabilité d'un résultat = (nombre d'entrées de sa collection / 10) / nombre de skins de la rareté supérieure dans cette collection. Float du résultat = min + moyenne × (max − min). Bouton « Add N more » tant que ce n'est pas plein.

**Connexion Discord** : états `idle`, `waiting` (fenêtre Discord ouverte), `success`, `conflict` (ce compte Discord a déjà une collection), `error`. La progression invité passe sur un **nouveau** compte ; elle n'est jamais fusionnée dans un compte existant (sinon on pourrait farmer des caisses gratuites avec des sessions invité).

**Classement** : valeur d'inventaire (prix moyen récent, sinon valeur de recyclage) ou complétion d'albums ; tout le monde ou amis ; la ligne du joueur reste visible même hors du top.

## 6. Données des maquettes

Tout ce qui est affiché est fictif : joueurs (vex, kenji, lou…), prix, historiques, intervalles de float des skins et une partie du contenu des caisses (écrit de mémoire, à vérifier). Le vrai contenu vient de l'API au moment de l'import. Les armes et caisses sont des silhouettes génériques à remplacer par les images de l'API.

## 7. Points encore ouverts

1. ~~Caisse gratuite~~ : tranché, **une toutes les 10 min, jusqu'à 5 en réserve** (revu le 05/11/2026 ; avant : une toutes les 4 h). Le jeu affiche la réserve (« 3/5 », en mono) et, tant qu'elle n'est pas pleine, le temps avant la suivante (`mm:ss`). Les maquettes montrent encore l'ancien « every 4 h ».
2. Invité : ouvrir des caisses est libre ; amis, trades et marché demandent un compte (proposé par le design).
3. Durée d'expiration des offres de trade : 1, 3 ou 7 jours au choix (proposé).
4. Trades réservés aux amis ou ouverts à tous : les maquettes passent par la liste d'amis.
5. Float uniforme ou pondéré pour rendre Factory New plus rare.

## 8. Lire les maquettes

Chaque `.dc.html` est une page HTML autonome :
- la mise en page est en HTML avec styles en ligne (`style="…"`) : c'est la source des valeurs ;
- le bloc `<helmet><style>` contient les classes partagées (`.mono`, `.lbl`, survols, animations) ;
- `{{nom}}` est une valeur fournie par le script en bas de fichier ; `<sc-for list="{{x}}" as="y">` répète un bloc ; `<sc-if value="{{x}}">` l'affiche sous condition ;
- le `<script type="text/x-dc">` en bas contient les données fictives et la logique de démo (`renderVals()` renvoie tout ce qui est affiché) ;
- `support.js` est le moteur de l'outil de design, il n'existe pas hors de l'outil et ne doit pas être recréé.

`design/canvas.json` liste les écrans et leur position sur le canevas, utile seulement pour retrouver un écran.
