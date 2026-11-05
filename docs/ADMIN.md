# Mint — panneau admin

Référence pour construire l'espace staff. Les maquettes sont dans `design/Admin-*.dc.html` ; elles réutilisent exactement les tokens de `docs/DESIGN.md` (aucune nouvelle couleur).

## 1. Contexte

- Route `/admin`, séparée du jeu. 1 à 5 personnes : le propriétaire et quelques modérateurs.
- Desktop 1440 d'abord. Le mobile (390) sert à chercher un joueur et à bannir en déplacement.
- Tout ce qui est fait ici modifie le vrai état du jeu. Chaque mouvement de crédits ou d'objet va dans le `ledger`, chaque action du staff va dans l'`admin_log` avec une raison.
- Heures en UTC partout, dites une fois dans l'en-tête de page.

## 2. Rôles

| Action | Viewer | Moderator | Admin |
|---|---|---|---|
| Voir tous les écrans et journaux | ✓ | ✓ | ✓ |
| Bannir, débannir, renommer, déconnecter partout | — | ✓ | ✓ |
| Annuler enchères et offres, régler une enchère en retard, classer un signalement, traiter un report, annonces, masquer un drop | — | ✓ | ✓ |
| Ajuster les crédits, donner / déplacer / restaurer / débloquer un objet | — | — | ✓ |
| Réglages d'économie, catalogue et import, événements | — | — | ✓ |
| Supprimer un compte, lancer un job, gérer le staff | — | — | ✓ |

- Le serveur vérifie le rôle sur chaque route admin. L'interface ne fait que refléter ce contrôle.
- Une action interdite n'est **jamais cachée** : bouton désactivé (icône cadenas) avec l'indication « Admins only » ou « Moderators and admins ». La puce de rôle est dans la carte staff en bas de la barre latérale.
- Les maquettes ont un réglage `role` (admin / moderator / viewer) pour voir les trois cas. Le viewer « sam » est un nom de démo.

## 3. Règles de toute action

1. Le titre dit l'action en entier : « Remove 5,000 CR from vex ».
2. Avant / après visible avant de confirmer (« Balance 4,870 → 9,870 CR »). Un résultat impossible est bloqué et expliqué (« vex only has 4,870 CR. Remove 4,870 CR or less. »).
3. Champ **Reason** obligatoire, montré dans l'admin log. Le bouton reste désactivé tant qu'il est vide.
4. Actions destructrices (supprimer un compte, ban permanent) : taper le pseudo pour confirmer.
5. Le bouton nomme exactement ce qui se passe : « Ban vex for 7 days », « Cancel auction », « Delete vex for good ».
6. Après : toast au passé qui mentionne le journal, « Banned vex for 7 days · logged ». Pied des dialogues : « Logged as mathys ».
7. Écriture en base : une transaction qui fait le changement, écrit le `ledger` si besoin, puis l'`admin_log` `{time, staff, action, target, before, after, reason}`. L'admin log n'est jamais modifié ni supprimé.

## 4. Shell

- **Desktop** : barre latérale 248 px (`#0D0E11`) avec le logo + étiquette `ADMIN` en contour, 8 sections (Overview, Players, Items, Economy, Catalog, Market & trades, Moderation, Logs & tools), pastilles blanches de compte sur Market & trades (flags ouverts) et Moderation (reports ouverts). En bas : carte staff (avatar, nom, puce de rôle) et « Back to the game ».
- **Recherche globale** 44 px en haut : « Search a player, Discord ID or item ID », raccourci `⌘K`, résultats groupés Players / Items.
- **En-tête de page** : libellé `// SECTION`, titre 40 px, une ligne de sous-titre, actions à droite. Contenu max 1680 px, marges 48 px.
- **Mobile** : en-tête 52 px (logo + `ADMIN`, loupe qui ouvre une recherche plein écran), barre d'onglets 84 px Overview / Players / Items / More. More ouvre une feuille avec les 5 autres sections. Les tableaux deviennent des lignes empilées, les dialogues des feuilles en bas d'écran.
- **Tiroir de détail** : panneau 520 px à droite, au-dessus du contenu assombri, actions épinglées en bas. Les joueurs ont une page entière à la place.

## 5. Écrans et fichiers

| Écran | Desktop | Mobile | Priorité | À voir dans la maquette (réglages) |
|---|---|---|---|---|
| Overview | `Admin-Overview.dc.html` | `Admin-M-Overview.dc.html` | v1 | périodes 24 h / 7 d / 30 d, Run now |
| Players (liste) | `Admin-Players.dc.html` | `Admin-M-Players.dc.html` | v1 | `state` : ready, loading, empty, error ; suppression groupée d'invités |
| Joueur (détail) | `Admin-Player.dc.html` | `Admin-M-Player.dc.html` | v1 | `player` : vex ou nyx (banni) ; `role` |
| Items | `Admin-Items.dc.html` | — | v1 | `open` : objet bloqué, détruit, en vente ; `state` ; `role` |
| Catalog | `Admin-Catalog.dc.html` | — | v1 | `drawer` : Fever (images cassées), Kilowatt, case of the day ; `import` |
| Logs & tools | `Admin-Logs.dc.html` | — | v1 (admin log), plus tard (outils) | `tab` : log, ledger, jobs, errors ; `check` : ok / mismatch |
| Market & trades | `Admin-Market.dc.html` | — | plus tard | `tab` : auctions, auction-live, auction-overdue, trades, flags |
| Moderation | `Admin-Moderation.dc.html` | — | plus tard | reports, annonces, global drop, événements |
| Economy | `Admin-Economy.dc.html` | — | plus tard | `edits` : pending / none |

| Dialogue | Fichier | Bouton | Particularités |
|---|---|---|---|
| Adjust credits | `Admin-Dlg-Credits.dc.html` | « Add 5,000 CR » / « Remove 5,000 CR » | `mode` : add, remove, blocked (solde négatif refusé + « Remove 4,870 CR instead ») |
| Grant item | `Admin-Dlg-Grant.dc.html` | « Grant AK-47 \| Redline » | recherche de skin avec suggestions, usure, float validé dans la plage de l'usure, StatTrak, motif, aperçu de la carte |
| Ban | `Admin-Dlg-Ban.dc.html` + mobile `Admin-M-Ban.dc.html` | « Ban vex for 7 days » | 24 h / 7 d / 30 d / Permanent ; effets immédiats listés ; aperçu de ce que voit le joueur ; permanent = taper le pseudo |
| Delete account | `Admin-Dlg-Delete.dc.html` | « Delete vex for good » | ce qui est supprimé / gardé ; taper le pseudo |
| Save economy changes | `Admin-Dlg-Economy.dc.html` | « Save 3 changes » | diff, simulateur avant / après, conséquences |

Chaque dialogue se confirme pour de vrai dans la maquette : la page derrière se met à jour (solde, bandeau de ban…) et le toast apparaît.

## 6. Comportements

**Overview** : 6 tuiles KPI (valeur mono, ligne de variation, sparkline blanche sur piste `#1E2227` ; une valeur à surveiller reçoit le point urgent, jamais un chiffre rouge ou vert). Flux de crédits : barres journalières, créés au-dessus de l'axe par source, détruits en dessous, ligne nette en pointillés. Taux de drop configurés vs réels sur les 10 000 dernières ouvertures, avec un repère 0.8× / 1× / 1.2×.

**Players** : filtres Type, Status, Joined, tri ; filtres actifs répétés en puces retirables + « Clear filters ». Cases à cocher **uniquement sur les invités** ; la barre de sélection propose « Delete N guests » avec raison obligatoire.

**Joueur** : en-tête (avatar 80, puces Account / Online / Banned, Discord ID copiable), actions Adjust credits, Grant item, Refill free cases (remet la réserve de caisses gratuites au maximum), Sign out everywhere, Ban, menu ⋯ (Rename, Delete account). Bandeau pleine largeur si banni : « Banned until Oct 30, 11:02 · by lea · Reason: … » + Unban. Bande de stats, carte Signals (âge du compte, autres comptes sur la même IP, trades signalés, reports), onglets Inventory (filtre par statut), Openings, Trades, Market, Friends, Ledger, Sessions, Notes (staff seulement).

**Items** : recherche par ID (9 chiffres) ou nom, puces de rareté, statut (dont « Stuck »), StatTrak. Un objet est **bloqué** quand son statut dit Listed ou In trade alors qu'aucune vente ou offre vivante ne le tient : le serveur doit savoir le détecter (requête ou job), l'interface affiche le point urgent, l'explication et « Unlock ». Tiroir : scène de l'objet, faits (ID, caisse d'origine, propriétaires, statut, valeurs), chronologie liée, actions Move to player, Restore (si détruit, avec option de reprendre les crédits de recyclage), Unlock, Remove from showcase.

**Catalog** : table des caisses (image, sortie, contenu, interrupteurs Active et New, prix, ouvertures 7 j), « Case of the day ». On ne peut pas désactiver la caisse du jour sans en choisir une autre. Rallumer une caisse avec des images cassées est possible mais annoncé. Import ByMykel en deux temps : **Dry run** (ne change rien) → rapport (+3 caisses, +58 skins, 2 retirés, 1 image cassée) → **Apply import** confirmé. Les nouvelles caisses arrivent éteintes, les objets des joueurs ne sont jamais touchés.

**Economy** : chaque réglage a sa valeur actuelle, un champ avec unité et « Changed Oct 19 by mathys ». Les cotes doivent faire **100.00 %** pour enregistrer. Simulateur : retour moyen par caisse si tout est recyclé, actuel vs modifié (Σ cote × valeur de recyclage × facteur usure/StatTrak ; le facteur 1.117 des maquettes est une estimation à remplacer par le calcul réel). Changements en attente avec annulation ligne par ligne, puis dialogue d'enregistrement. Historique de tous les changements.

**Market & trades** : enchères (minuteur inversé avec point clignotant dans les 2 dernières minutes, statut Overdue si la clôture a raté), tiroir avec historique des enchères, **Cancel auction** (objet rendu au vendeur, meilleure enchère remboursée, pas de taxe) et **Settle now** si en retard. Offres : « Cancel offer » libère objets et crédits. Flags : cartes avec point urgent si important, joueurs, preuves chiffrées, Review player / Dismiss (raison) / Ban.

**Moderation** : file de reports (catégorie, joueur signalé, auteur, message) avec Rename / Ban / Dismiss ; un pseudo offensant est masqué par défaut (« Show name »). Annonces : 140 caractères max, début / fin, aperçu exact du bandeau de 40 px. Global drop : masquer un drop ★ du bandeau des joueurs. Événements (admins) : caisse gratuite pour tous, crédits offerts à tous, **coût total affiché avant de confirmer** (joueurs × montant, effet sur les crédits en circulation).

**Logs & tools** : admin log (filtres staff, type d'action, cible, date ; une ligne s'ouvre sur avant / après en mono), export CSV. Outils : explorateur de ledger + « Check ledger » (« Ledger OK: 1,284 players, 48,210 entries » ou la liste des écarts), une carte par job planifié (dernier passage, résultat, durée, Run now), erreurs (codes les plus fréquents sur 24 h, dernières erreurs serveur).

## 7. Données à prévoir

Tables suggérées en plus du cahier des charges : `staff (discord_id, role)`, `admin_log`, `flags`, `reports`, `announcements`, `economy_settings` + `economy_history`, `catalog_imports`, `job_runs`. Les seuils des flags (trades répétés, comptes sur une même IP, prix inhabituel, compte récent) sont à définir.

## 8. Histoire des données de démo

Les écrans racontent une même journée, utile pour vérifier qu'on n'a rien oublié :
- vex reçoit deux fois le remboursement de l'enchère #8812 (bug `duplicate_refund`), mathys retire les 5,000 CR en trop à 14:10 ;
- nyx (compte de 2 jours, 7 comptes sur une IP) est banni 7 jours par lea pour tentative d'arnaque ; mathys rend les 6 objets reçus ;
- la MP7 | Skulls 000479555 de vex est restée « In trade » après l'expiration de l'offre #2231 : c'est l'objet bloqué ;
- Fever Case est éteinte depuis le 22 octobre à cause de 2 images cassées ;
- l'enchère #8803 n'a pas été réglée par le job : elle est « Overdue ».

## 9. Points ouverts

1. ~~Caisse gratuite~~ : tranché, **une toutes les 10 min, jusqu'à 5 en réserve**, partout (jeu et admin ; revu le 05/11/2026, avant une toutes les 4 h). Les deux chiffres se règlent dans Economy (« Free case every », « Free case stack »). Les caisses gratuites d'un événement s'ajoutent à la réserve, sans plafond. La caisse du jour est choisie par un admin (Catalog) ou, à défaut, par la rotation quotidienne ; un choix s'applique tout de suite.
2. Pas d'écran Items mobile : l'onglet Items et la feuille More renvoient vers les pages desktop.
3. ~~Seuils des moniteurs~~ : tranchés (24/10/2026), vérifiés au moment de l'événement (acceptation d'un trade, ouverture d'une session, vente) :
   - *Repeated trades* : au moins 4 trades acceptés entre les deux mêmes joueurs en 48 h, au moins 80 % de la valeur dans un sens, au moins 10 000 CR déplacés ; urgent dès 25 000 CR ;
   - *Many accounts, 1 IP* (revu le 05/11/2026 : les invités et le wifi partagé levaient de fausses alertes) : au moins 3 comptes Discord (jamais les invités, qui ne peuvent ni échanger ni vendre) créés depuis une même adresse en 7 jours, **qui ont envoyé ensemble au moins 10 000 CR** (objets + crédits, trades acceptés) à un même joueur ; urgent dès 25 000 CR. Plusieurs comptes sur une adresse sans transfert ne lèvent rien (le signal « autres comptes sur cette IP » de la fiche joueur reste). Vérifié à l'ouverture d'une session et après chaque trade accepté ;
   - *Unusual price* : une vente à au moins 5 × la moyenne sur 30 jours du même skin, StatTrak et usure (valeur de recyclage sans vente) ;
   - *New account* : un compte de moins de 3 jours qui a reçu au moins 10 000 CR d'objets en trades.
   Un ban ferme les flags ouverts du joueur ; un ban ou un rename ferme les reports sur lui.
4. ~~Facteur du simulateur~~ : le simulateur est maintenant **exact** (taux × valeur de recyclage × multiplicateur d'usure moyen sur la plage de float de chaque skin × facteur StatTrak attendu, par caisse active), plus de facteur 1,117.
