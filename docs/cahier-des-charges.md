# Jeu de collection de skins CS — cahier des charges

Oct 20, 2026 · @Mathys

## Concept

Un jeu web de collection pure basé sur les vrais skins de Counter-Strike 2 : on ouvre des caisses, on collectionne, on échange et on revend aux enchères. Il n'y a aucun système de combat.

Les simulateurs d'ouverture de caisse existent déjà. Ce qui différencie ce projet, c'est l'économie entre joueurs : maison des ventes aux enchères, trades, amis, classement et albums à compléter.

Comment utiliser ce doc :

1. Donner à Claude Design les sections Concept, Mécaniques de base, Fonctionnalités et Pour Claude Design, pour concevoir l'interface.
2. Donner ensuite le doc entier et les maquettes à Claude Code, pour coder les fonctionnalités dans l'ordre des phases.

## Données

Tout le catalogue vient de [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), une API JSON non officielle de Counter-Strike 2, hébergée sur GitHub et traduite dans plus de 20 langues. URL de base : `https://bymykel.github.io/CSGO-API/api/{langue}/`.

| Fichier | Contenu | Usage dans le jeu |
|---|---|---|
| `skins_not_grouped.json` | Un skin par état et variante (normal, StatTrak, souvenir), avec `min_float` et `max_float` | Catalogue des skins tirables et intervalle de float |
| `skins.json` | Skins groupés, avec rareté et image | Fiches skin |
| `crates.json` | Caisses et leur contenu | Définition des caisses et de leurs objets spéciaux |
| `collections.json` | Collections de skins | Albums à compléter |
| `keys.json` | Clés de caisse | Optionnel |

Les images sont hébergées sur GitHub et référencées par URL dans les JSON. Le jeu importe ces fichiers dans sa base avec un script, plutôt que d'appeler l'API à chaque requête. Le script se relance quand Valve ajoute des caisses.

Points à vérifier à l'import : les noms exacts des champs de contenu des caisses (objets normaux et objets spéciaux séparés) et la disponibilité du français.

## Mécaniques de base

Chaque objet obtenu est un exemplaire unique, défini par sa rareté, son float, son état, son pattern et son statut StatTrak. On reprend les règles de CS2 telles quelles.

### Raretés

Toutes les caisses utilisent les mêmes taux. À l'intérieur d'une rareté, chaque skin de la caisse a la même chance.

| Rareté | Couleur | Chance par ouverture |
|---|---|---|
| Mil-Spec | Bleu | 79,92 % |
| Restricted | Violet | 15,98 % |
| Classified | Rose | 3,20 % |
| Covert | Rouge | 0,64 % |
| Couteau ou gants | Or | 0,26 % |

### StatTrak

10 % de chance qu'un objet tiré soit StatTrak. C'est une variante à part entière : elle vaut plus cher et ne se mélange pas avec les versions normales dans les contrats d'échange.

### Float et état

Le float est un nombre tiré entre le `min_float` et le `max_float` du skin. L'état en découle directement.

| État | Abréviation | Float |
|---|---|---|
| Factory New | FN | 0,00 à 0,07 |
| Minimal Wear | MW | 0,07 à 0,15 |
| Field-Tested | FT | 0,15 à 0,38 |
| Well-Worn | WW | 0,38 à 0,45 |
| Battle-Scarred | BS | 0,45 à 1,00 |

Un skin dont le `max_float` vaut 0,80 ne peut jamais sortir au-dessus de 0,80. Version simple : tirage uniforme dans l'intervalle. Une pondération qui rend Factory New plus rare reste possible plus tard.

### Pattern

Un entier de 0 à 999 tiré à l'ouverture et affiché sur la fiche de l'objet. Il n'est pas rendu visuellement au départ : les joueurs décideront eux-mêmes quels numéros sont « rares ».

## Économie

Une seule monnaie virtuelle (nom à choisir), qui ne s'achète jamais avec de l'argent réel. La monnaie doit sortir du jeu plus vite qu'elle n'y entre, sinon les prix s'envolent.

Boucle de l'économie (7 étapes) : la monnaie sort par les caisses et la taxe de 5 %.

- Caisses gratuites (une toutes les 10 min, jusqu'à 5 en réserve) → objet tiré → Inventaire (le recyclage ou la vente le transforme en monnaie)
- Monnaie → Ouvrir une caisse (prix de la caisse, tirage côté serveur) → objet tiré → Inventaire (exemplaires uniques)
- Inventaire → mise en vente → Maison des ventes (taxe de 5 % au vendeur) → vente moins 5 % → Monnaie
- Inventaire ↔ Trades et contrats (échangés ou fusionnés)
- Inventaire → recycler → Recyclage (valeur fixe par rareté) → valeur de recyclage → Monnaie

Les objets entrent par les caisses et sortent par le recyclage ou le contrat d'échange ; une vente envoie l'objet à l'acheteur et la monnaie au vendeur, moins la taxe.

- **Entrées** : solde de départ, recyclage (y compris des objets de la caisse gratuite). Les ventes entre joueurs ne créent pas de monnaie, elles la déplacent. Il n'y a plus de récompense quotidienne en crédits (décision du 22/10/2026).
- **Sorties** : achat de caisses, taxe de 5 % sur chaque vente aux enchères.
- **Sorties d'objets** : recyclage (l'objet est détruit) et contrat d'échange (10 objets détruits pour 1 créé).

### Valeurs par défaut (à équilibrer)

| Élément | Valeur proposée |
|---|---|
| Solde de départ | 1 000 |
| Caisse gratuite | 1 toutes les 10 min, jusqu'à 5 en réserve (plus de récompense quotidienne en crédits) |
| Prix d'une caisse | 250 |
| Recyclage Mil-Spec | 30 |
| Recyclage Restricted | 120 |
| Recyclage Classified | 500 |
| Recyclage Covert | 2 500 |
| Recyclage couteau ou gants | 10 000 |
| Multiplicateur StatTrak | ×2 |
| Multiplicateur d'état | FN ×1,5 · MW ×1,2 · FT ×1 · WW ×0,9 · BS ×0,8 |
| Taxe de la maison des ventes | 5 % du prix final, payée par le vendeur |

Avec ces valeurs, recycler tout ce qu'on ouvre rapporte en moyenne environ 100 par caisse, soit 40 % de son prix. Ouvrir des caisses reste donc une perte, et vendre aux autres joueurs devient plus intéressant que recycler.

## Fonctionnalités

Dix fonctionnalités : six de base (ouverture, inventaire, recyclage, trade, maison des ventes, amis) et quatre en plus (contrat d'échange, classement, annonce globale, vitrine).

### Ouverture de caisse

- Liste des caisses avec leur prix ; aperçu du contenu groupé par rareté, avec les taux.
- Animation de roulette horizontale qui défile puis s'arrête sur l'objet obtenu. Le résultat est tiré par le serveur avant le début de l'animation.
- Écran de révélation : image, nom, état, float, pattern, badge StatTrak. Actions : garder, recycler, mettre en vente.
- Une caisse gratuite toutes les 10 minutes, qui s'accumulent jusqu'à 5 (un nouveau joueur commence avec les 5), sur la « caisse du jour » (qui change toutes les 4 h, à 00:00, 04:00, 08:00… UTC ; réglable dans admin › Economy). On les ouvre une par une.

### Inventaire et album de collection

- Inventaire en grille, filtrable par arme, rareté, état, StatTrak et caisse ; triable par valeur, date d'obtention et float.
- Sélection multiple pour recycler ou mettre en vente plusieurs objets.
- Album par caisse ou collection : les skins possédés sont affichés, les manquants sont grisés, avec un pourcentage de complétion. C'est le moteur principal d'un jeu de collection pure.

### Recyclage

- Transforme un objet en monnaie selon la grille de la section Économie.
- Confirmation obligatoire à partir de Classified, pour éviter les erreurs.

### Trade

- Une offre contient des objets proposés, des objets demandés, et éventuellement de la monnaie de chaque côté.
- Statuts : envoyée, acceptée, refusée, annulée, expirée.
- Les objets d'une offre en cours sont verrouillés : impossible de les vendre, les recycler ou les proposer ailleurs.
- Les deux joueurs confirment, puis l'échange s'exécute en une seule opération côté serveur.

### Maison des ventes (enchères)

- Mise en vente : prix de départ, prix d'achat immédiat optionnel, durée de 24 ou 48 h.
- Chaque nouvelle enchère dépasse la précédente d'au moins 5 %.
- Une enchère placée dans les 2 dernières minutes prolonge la vente de 2 minutes (anti-sniping).
- Le montant enchéri est bloqué sur le solde de l'enchérisseur et lui est rendu dès qu'il est dépassé.
- Taxe de 5 % prélevée sur le vendeur à la fin de la vente.
- Historique des prix par skin et par état (dernières ventes, prix moyen).
- Interdit d'enchérir sur ses propres ventes ; nombre limité de ventes actives par joueur (10 proposé).

### Amis et fil d'activité

- Ajout par pseudo, avec une demande à accepter.
- Consultation de l'inventaire, de l'album et du profil d'un ami.
- Fil d'activité des amis : ouvertures à partir de Classified, ventes conclues, contrats réussis.

### Contrat d'échange

- 10 skins de la même rareté donnent 1 skin de la rareté supérieure, tiré parmi les collections des skins donnés, au prorata.
- Les 10 skins sont tous StatTrak ou tous normaux ; le résultat suit.
- Float du résultat : la moyenne des floats donnés, ramenée dans l'intervalle du skin obtenu.
- Au départ, pas de contrat avec des Covert ni avec des couteaux ou gants.

### Classement

- Classement par valeur d'inventaire : prix moyen récent à la maison des ventes, ou valeur de recyclage si l'objet n'a jamais été vendu.
- Second classement par complétion des albums.

### Annonce globale

- Un bandeau visible par tous les joueurs annonce chaque couteau ou paire de gants ouvert, avec le pseudo et l'objet.
- Pas d'annonce pour les autres raretés, pour garder l'événement rare.

### Vitrine de profil

- Chaque joueur expose 5 objets de son choix sur son profil, visibles par les autres.

## Pour Claude Design

Une interface web sombre, inspirée de l'ambiance des inventaires CS2 mais avec sa propre identité : pas de logo ni de nom Counter-Strike dans la marque. Desktop d'abord, utilisable sur mobile.

### Couleurs des raretés

La rareté se lit d'abord par la couleur, sur chaque carte d'objet. Valeurs indicatives, proches de celles du jeu :

| Rareté | Couleur |
|---|---|
| Mil-Spec | Bleu `#4B69FF` |
| Restricted | Violet `#8847FF` |
| Classified | Rose `#D32CE6` |
| Covert | Rouge `#EB4B4B` |
| Couteau ou gants | Or `#E4AE39` |

### Écrans à concevoir

| Écran | Éléments clés |
|---|---|
| Accueil | Solde, caisse gratuite du jour, fil d'activité des amis, bandeau d'annonce globale |
| Caisses | Grille des caisses avec image et prix |
| Ouverture | Contenu de la caisse par rareté et taux, roulette horizontale, révélation de l'objet et ses actions |
| Inventaire | Grille de cartes, filtres, tri, sélection multiple (recycler, vendre) |
| Fiche objet | Grande image, nom, état, barre de float, pattern, StatTrak, historique des prix, actions |
| Album | Skins d'une caisse ou collection, manquants grisés, pourcentage de complétion |
| Maison des ventes | Liste filtrable, fiche d'enchère avec compte à rebours et historique des enchères, formulaire de mise en vente |
| Trades | Création d'offre en deux colonnes (ce que je donne, ce que je demande), offres reçues et envoyées |
| Contrat d'échange | 10 emplacements, float moyen calculé, aperçu des résultats possibles |
| Amis | Liste, demandes en attente, recherche par pseudo |
| Profil | Vitrine de 5 objets, statistiques, complétion des albums |
| Classement | Classement par valeur d'inventaire et par complétion |

### Composants récurrents

- **Carte d'objet** : image, nom, liseré de la couleur de rareté, état abrégé (FN, MW, FT, WW, BS), badge StatTrak, prix ou valeur.
- **Barre de float** : les 5 zones d'état côte à côte, avec un curseur à la position exacte du float.
- **Compte à rebours** pour les enchères, mis en avant dans les 2 dernières minutes.
- **Bandeau d'annonce globale** pour les couteaux et gants, visible sur tous les écrans.

## Pour Claude Code

Le serveur décide de tout : le client affiche des résultats, il ne les calcule jamais. Stack suggérée : React pour le front, Node pour le back, PostgreSQL pour la base (verrouillage de lignes et transactions).

### Règles non négociables

- Tous les tirages (rareté, skin, float, pattern, StatTrak) se font côté serveur, avec un générateur aléatoire cryptographique.
- Toute opération qui déplace un objet ou de la monnaie est une transaction en base, avec verrouillage des lignes concernées : ouverture, recyclage, trade, enchère, fin de vente, contrat d'échange.
- Un objet n'a qu'un statut à la fois : disponible, en vente, en trade, détruit. Seul un objet disponible peut être vendu, proposé, recyclé ou utilisé dans un contrat.
- La fin des enchères et l'expiration des offres de trade sont traitées par une tâche planifiée côté serveur.
- Chaque mouvement de monnaie ou d'objet est écrit dans un journal, pour retrouver l'origine de n'importe quel bug d'économie.

### Modèle de données

| Table | Champs principaux |
|---|---|
| `users` | id, pseudo, solde, réserve de caisses gratuites, créé le |
| `skins` | id, nom, arme, rareté, min_float, max_float, image, collection (catalogue importé) |
| `crates` | id, nom, prix, image |
| `crate_items` | crate_id, skin_id, spécial (couteau ou gants) |
| `items` | id, skin_id, owner_id, float, pattern, stattrak, statut, obtenu le, propriétaire d'origine |
| `auctions` | id, item_id, vendeur_id, prix de départ, achat immédiat, fin le, statut |
| `bids` | id, auction_id, user_id, montant, créé le |
| `trades` | id, expéditeur_id, destinataire_id, monnaie de chaque côté, statut, expire le |
| `trade_items` | trade_id, item_id, côté |
| `friendships` | user_a, user_b, statut |
| `showcase` | user_id, item_id, position (1 à 5) |
| `activity` | id, user_id, type, item_id, créé le |
| `ledger` | id, user_id, type, montant, item_id, créé le (journal) |

### Ordre de développement

1. Import du catalogue, comptes, ouverture de caisse, inventaire.
2. Monnaie, recyclage, récompense quotidienne (supprimée depuis, remplacée par la caisse gratuite : une toutes les 10 min, jusqu'à 5 en réserve).
3. Fiche objet et album de collection.
4. Amis, profil, vitrine, fil d'activité.
5. Trades.
6. Maison des ventes.
7. Contrat d'échange, classement, annonce globale.

Chaque phase doit être jouable avant de passer à la suivante.

## Contraintes et questions ouvertes

### Contraintes

- **Zéro argent réel**, ni en entrée ni en sortie : pas d'achat de monnaie, pas de revente d'objets contre de l'argent. Dès que de l'argent réel circule, le jeu devient juridiquement un jeu d'argent.
- **Propriété de Valve** : les skins et leurs images appartiennent à Valve. Le projet reste un projet fan gratuit, sans monétisation, et le nom du jeu n'utilise pas la marque Counter-Strike.

### Questions ouvertes

- [x] Nom du jeu et nom de la monnaie → **Mint**, monnaie **Credits (CR)**
- [x] Web classique ou activité Discord ? → **les deux** (web desktop, tablette, mobile, activité Discord)
- [x] Connexion : pseudo et mot de passe, ou connexion Discord ? → **Discord**, après une première partie en invité
- [x] Trades réservés aux amis ou ouverts à tous ? → **entre amis seulement** (phase 5)
- [x] Float tiré uniformément ou pondéré pour rendre Factory New plus rare ? → **uniforme** dans la plage du skin (pas de pondération)
- [ ] Valeurs de l'économie à rééquilibrer après les premiers tests (à surveiller en priorité depuis le passage à une caisse gratuite toutes les 10 min : jusqu'à 144 caisses gratuites par jour pour un joueur très actif, contre 6 avant)
- [x] Caisse gratuite : par jour ou par heure ? → **toutes les 4 h**, et la récompense quotidienne de 250 CR est supprimée ; revu le 05/11/2026 : **une toutes les 10 min, jusqu'à 5 en réserve**, toujours sur la caisse du jour, ouvertes une par une, réserve pleine au départ (nouveaux joueurs et joueurs existants)
- [x] Caisse du jour : une par jour ? → revu le 06/11/2026 : **elle change toutes les 4 h** (créneaux alignés sur 00:00 UTC), durée réglable dans admin › Economy (« Case of the day every », 1 à 168 h). Un choix du staff dans Catalog reste prioritaire et fige la caisse
- [x] Progression invité → **jamais transférée**, ni dans un compte existant ni dans un nouveau (anti-farm) : le compte Discord démarre avec sa propre collection et l'invité est supprimé

## Sources

- [ByMykel/CSGO-API (GitHub)](https://github.com/ByMykel/CSGO-API)
- Discussion sur les float caps, ByMykel/CSGO-API
- CS2 Case Odds, csdb.gg
- CS2 Case Drop Rates Guide, wecoach.gg
