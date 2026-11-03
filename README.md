# Mint

Jeu web de collection de skins (voir `CLAUDE.md`, `docs/cahier-des-charges.md`, `docs/DESIGN.md`).
React (Vite) + API Node (Hono), PostgreSQL, connexion Discord. En production : un serveur avec Docker Compose (Postgres, le jeu, Caddy pour le HTTPS), voir « Déploiement ».

## Lancer en local

Prérequis : Node 24, pnpm (`corepack enable`).

```bash
pnpm install
cp .env.example .env          # puis remplir CRON_SECRET, IP_HASH_SALT (et Discord si besoin)
pnpm db:local                 # terminal 1 : Postgres local sur le port 54329 (aucune installation, Ctrl+C pour arrêter)
pnpm db:migrate               # crée les tables
pnpm catalog:import           # importe les 42 caisses depuis ByMykel/CSGO-API (ajouter --dry-run pour le rapport seul)
pnpm dev                      # API sur :3000 + front sur http://localhost:5173
```

Sans variables Discord, le jeu marche en invité ; l'écran de connexion indique que Discord n'est pas configuré.

| Commande | Rôle |
|---|---|
| `pnpm test` | Tests unitaires (tirages, état, valeur) et d'intégration (sur la base `mint_test` de `pnpm db:local`) |
| `pnpm typecheck` | Vérification TypeScript du serveur et du front |
| `pnpm db:generate` | Nouvelle migration après une modification de `server/db/schema.ts` |
| `pnpm catalog:import [--dry-run] [--commit <sha>]` | Import du catalogue, à relancer quand Valve ajoute des caisses |
| `pnpm check:ledger` | Vérifie que la somme du journal égale le solde de chaque joueur, et que les enchères menées correspondent aux crédits bloqués |
| `pnpm staff:set <discordId> <viewer|moderator|admin>` | Donne un rôle staff à un compte Discord (panneau `/admin`) ; `pnpm staff:remove <discordId>`, `pnpm staff:list` |

## Panneau admin

`/admin` (hors activité Discord) est réservé au staff. Le premier admin se crée en ligne de commande : se connecter une fois au jeu avec son compte Discord, puis `pnpm staff:set <son Discord ID> admin` (sur le serveur, dans `/opt/mint` : `docker compose exec app node --import tsx scripts/staff.ts set <Discord ID> admin`). Chaque changement de rôle est écrit dans l'admin log.

Les nouvelles caisses d'un import arrivent éteintes : on les allume dans Catalog. Le tout premier import (base vide) les allume toutes.

Les chiffres de l'économie (prix d'une caisse, taux, recyclage, taxe du marché, limites des trades…) se règlent dans admin › Economy, sans déploiement : ils sont en base (`economy_settings`) et chaque instance les relit en moins de 10 s. Une base vide utilise les valeurs par défaut de `server/game/economy.ts`.

## Application Discord

Sur <https://discord.com/developers/applications>, créer une application, puis :

1. **OAuth2 → Redirects** : ajouter `http://localhost:5173/api/auth/discord/callback` et `https://<domaine de prod>/api/auth/discord/callback`.
2. Copier le **Client ID** dans `DISCORD_CLIENT_ID` et `VITE_DISCORD_CLIENT_ID`, et le **Client Secret** dans `DISCORD_CLIENT_SECRET`. Seul le scope `identify` est demandé. (Sur le serveur, `DISCORD_CLIENT_ID` suffit : le build en fait `VITE_DISCORD_CLIENT_ID`.)
3. **General Information** : Terms of Service URL `https://<domaine>/terms`, Privacy Policy URL `https://<domaine>/privacy`.
4. **Activities** : activer l'activité, puis dans **URL Mappings** :

| Préfixe | Cible |
|---|---|
| `/` | `<domaine de prod>` (sans `https://`) |
| `/steamcdn` | `community.akamai.steamstatic.com` |
| `/discordcdn` | `cdn.discordapp.com` |

Pour tester l'activité en local, exposer `localhost:5173` avec un tunnel (par exemple `cloudflared tunnel --url http://localhost:5173`) et mettre l'URL du tunnel dans le mapping `/`.

## Déploiement (un serveur)

Mint tourne sur un seul serveur Linux, à côté d'autres programmes (les bots Discord du serveur actuel) : trois conteneurs Docker dans le projet `mint` (`docker-compose.yml`) :

| Conteneur | Rôle |
|---|---|
| `postgres` | Postgres 18, jamais exposé à Internet, données dans le volume `mint_pgdata` |
| `app` | `server/main.ts` : l'API, le jeu buildé (`dist/`) et le planificateur (offres et enchères réglées chaque minute, purge des invités 04:00, contrôle du journal 05:00). Migrations à chaque démarrage. Écoute sur `127.0.0.1:3080` seulement |
| `caddy` | HTTPS (certificat Let's Encrypt automatique) sur 80/443, seulement si ces ports sont libres (`COMPOSE_PROFILES=caddy`) |

Mémoire plafonnée (`PG_MEM_LIMIT`, `APP_MEM_LIMIT`) pour ne jamais prendre celle des bots. Les scripts de `deploy/` n'ajoutent que des choses : jamais de redémarrage du serveur, jamais d'arrêt d'un autre programme.

### Première installation

1. **Domaine** : l'acheter, puis un enregistrement DNS `A` vers l'IP du serveur.
2. **Sauvegardes Hetzner** : console Hetzner Cloud → le serveur → Backups (sauvegarde de tout le disque chaque jour).
3. **Code sur le serveur** (le dépôt GitHub est privé : une clé de déploiement en lecture seule) :

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/mint_deploy -N "" -C mint-deploy
   cat ~/.ssh/mint_deploy.pub     # GitHub → le dépôt → Settings → Deploy keys → Add (sans write access)
   GIT_SSH_COMMAND="ssh -i ~/.ssh/mint_deploy -o IdentitiesOnly=yes" git clone git@github.com:<compte>/mint.git /opt/mint
   cd /opt/mint && git config core.sshCommand "ssh -i ~/.ssh/mint_deploy -o IdentitiesOnly=yes"
   ```

4. `sudo bash deploy/setup.sh` : montre l'état du serveur, installe Docker s'il manque, crée `.env` avec des secrets neufs, ouvre 80/443 si ufw est actif, ajoute la sauvegarde nocturne (`/etc/cron.d/mint`). Il demande avant chaque changement.
5. `nano .env` : `MINT_DOMAIN`, `APP_BASE_URL`, Discord, `CONTACT_EMAIL`, R2 (voir `.env.production.example`).
6. `bash deploy/deploy.sh` : build, migrations, démarrage, attend que `/api/health` réponde.
7. Catalogue, une fois : `docker compose exec app node --import tsx scripts/import-catalog.ts`.
8. Premier admin : se connecter au jeu avec Discord, puis `docker compose exec app node --import tsx scripts/staff.ts set <Discord ID> admin`.

Dans le conteneur, lancer les scripts avec `node --import tsx scripts/….ts` plutôt que `pnpm <script>` : pnpm vérifie les dépendances avant de lancer un script et, l’utilisateur `node` ne pouvant pas écrire dans `/app`, échouait avec `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR` (le `Dockerfile` désactive maintenant cette vérification).

Si 80/443 sont déjà pris (nginx…), `setup.sh` laisse Caddy éteint : brancher le serveur web existant sur `127.0.0.1:3080` avec `deploy/nginx-mint.conf`.

### Mettre à jour

Pousser sur GitHub, puis sur le serveur : `cd /opt/mint && bash deploy/deploy.sh`. Les onglets ouverts pendant un déploiement se rechargent seuls (`vite:preloadError`, page d'erreur).

### Au quotidien

| Commande (dans `/opt/mint`) | Rôle |
|---|---|
| `docker compose ps` | État des conteneurs |
| `docker compose logs -f app` | Journaux du jeu |
| `docker compose exec app node --import tsx scripts/check-ledger.ts` | Contrôle du journal |
| `bash deploy/backup.sh` | Sauvegarde tout de suite (sinon chaque nuit à 02:30) |
| `docker stats --no-stream` | Mémoire utilisée par Mint |

Sauvegardes : `backups/mint-*.dump` (14 jours) et, si R2 est configuré, une copie sur Cloudflare R2 (offre gratuite, 10 Go). Restauration : `deploy/restore.md`. Surveillance conseillée : UptimeRobot (gratuit) sur `https://<domaine>/api/health`.

## Autre option : Vercel + Neon

Le code tourne toujours sur Vercel (`api/index.ts`, `vercel.json`, base Neon par l'intégration Vercel, variables de `.env.example`, `ENABLE_EXPERIMENTAL_COREPACK=1`, catalogue importé avec `DATABASE_URL_UNPOOLED=<url directe> pnpm catalog:import`). Limites du plan gratuit : les crons ne passent qu'une fois par jour (les offres et enchères échues sont aussi réglées à la lecture), Neon Free = 0,5 Go et environ 100 heures de calcul par mois, Vercel Hobby réservé à un usage non commercial.
