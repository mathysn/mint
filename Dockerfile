# Mint, self-hosted: one image with the API, the built game and the scheduler (server/main.ts).
# Built on the server by `docker compose build` (deploy/deploy.sh).
FROM node:24-bookworm-slim

# pnpm (version from package.json) is cached where the `node` user can read it too.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/usr/local/share/corepack \
    CI=1
RUN corepack enable
WORKDIR /app

# Dependencies first, so a code change doesn't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm install --frozen-lockfile \
    # The embedded Postgres binaries only serve `pnpm db:local` on a dev machine.
    && rm -rf node_modules/.pnpm/@embedded-postgres* node_modules/embedded-postgres

COPY . .

# Vite bakes these into the game at build time (public values, not secrets).
ARG VITE_DISCORD_CLIENT_ID=""
ARG VITE_CONTACT_EMAIL=""
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL
RUN pnpm build

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=384
EXPOSE 3000
USER node

# Migrations on every start (they are idempotent), then the server.
CMD ["sh", "-c", "node --import tsx scripts/migrate.ts && exec node --import tsx server/main.ts"]
