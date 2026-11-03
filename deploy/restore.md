# Restoring a backup

Dumps are `pg_dump -Fc` files: `/opt/mint/backups/mint-YYYY-MM-DD-HHMM.dump` on the server, and the same names in the R2 bucket.

## On the server (replace the live database)

Stops the game for a minute; players' sessions are kept, since they are in the dump.

```bash
cd /opt/mint
docker compose stop app
docker compose exec -T postgres dropdb -U mint mint
docker compose exec -T postgres createdb -U mint mint
docker compose exec -T postgres pg_restore -U mint -d mint --no-owner < backups/mint-2026-10-28-0230.dump
docker compose start app
```

From R2 instead: download the file in the Cloudflare dashboard (R2 → bucket → the dump → Download), copy it to `/opt/mint/backups/` with `scp`, then run the same commands.

## On a dev machine (to check a backup)

With `pnpm db:local` running:

```bash
createdb -h localhost -p 54329 -U mint mint_restore
pg_restore -h localhost -p 54329 -U mint -d mint_restore --no-owner mint-2026-10-28-0230.dump
```

(`createdb` and `pg_restore` come with the embedded Postgres in `node_modules/.pnpm/@embedded-postgres+windows-x64@*/…/native/bin`.)

## Whole server

Hetzner's daily server backups (Cloud console → the server → Backups) restore the whole disk, bots included. Use them only if the server itself is broken: it rolls everything back to that day.
