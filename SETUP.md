# Running the app locally (GitHub Codespaces)

This is the full sequence to get `apps/api` + `apps/school-portal` up and
reachable in your own browser, with realistic dummy data, starting from a
fresh Codespace. It does not cover deploying anywhere outside Codespaces.

## 1. Create the Codespace

On `github.com/codestudio26/ULTM8` → green **Code** button → **Codespaces**
tab → make sure the branch selector reads **master**, then create. First
boot runs `npm ci` + Prisma client generation automatically
(`.devcontainer/devcontainer.json`'s `postCreateCommand`) — give it a few
minutes. Postgres and Redis come up as sibling containers from
`.devcontainer/docker-compose.yml`; migrations apply automatically on every
start (`postStartCommand`).

## 2. Seed the dummy data

```bash
cd apps/api
node prisma/seed-dummy-data.js
```

This is idempotent (upserts on fixed IDs) — safe to re-run.

## 3. Start both dev servers

Two terminals:

```bash
# terminal 1
cd apps/api && npm run dev

# terminal 2
cd apps/school-portal && npm run dev
```

If `apps/api`'s `npm run dev` throws
`Error: Cannot find module '.../dist/main'` right after a clean "Found 0
errors" message, that's a stale build cache — see **Troubleshooting**
below. As a one-off workaround: `npm run build && node dist/main.js`
instead of `npm run dev` (no live-reload, but reliable).

## 4. Wire up the forwarded URLs

Codespaces serves each port behind its own `https://<codespace-name>-<port>.app.github.dev`
URL, not literally `localhost` — two things need to know about that:

**a. Point the frontend at the forwarded API URL.** The portal defaults to
`http://localhost:3000`, which doesn't resolve from your actual browser.
Grab port 3000's forwarded URL from the **Ports** tab, then:

```bash
echo 'VITE_API_BASE_URL=https://<codespace-name>-3000.app.github.dev' > apps/school-portal/.env.local
```

Restart the `apps/school-portal` dev server (Ctrl+C, `npm run dev` again) —
Vite only reads env files at startup.

**b. Allow the forwarded frontend origin in CORS.** Grab port 5173's
forwarded URL too, then in the `apps/api` terminal, before (or after —
just restart after) starting the API:

```bash
export CORS_ALLOWED_ORIGINS="http://localhost:5173,https://<codespace-name>-5173.app.github.dev"
```

**c. Visit the API's own forwarded URL directly once.** Open
`https://<codespace-name>-3000.app.github.dev/v1/docs` in a tab before
trying to log in. Port 3000 defaults to **Private** visibility, which gates
on a per-port GitHub auth handshake — visiting it directly completes that
handshake; a background `fetch()` call from the portal to a port you've
never opened directly can fail even though the API itself is reachable and
correctly configured.

## 5. Log in

`dev@ultm8.local` / `123456` (School Owner + Student). Also seeded:
`coach.alex@ultm8.local` / `123456` (Instructor), `jamie.lee@ultm8.local` /
`123456` (Student) — all passcode `123456`.

## Sharing the link with someone else

Both ports default to **Private** (only your own GitHub-authenticated
browser can open them). To let someone else in: Ports tab → right-click the
**School Portal (Vite)** row → **Port Visibility** → **Public**, then send
them the forwarded 5173 URL. This exposes it to anyone with the link, not
just them — fine for dummy/dev data, not something to do with real data.

This is also not a durable link: GitHub stops the Codespace after ~30 min
idle, and the `npm run dev` processes don't auto-restart on resume — you'd
need to start them again, same as section 3.

## Troubleshooting

**Saving a form fails with "each value in … must be a UUID" on dummy data.**
Older seed scripts gave demo records ids like
`40000000-0000-0000-0000-000000000001`, which the API's UUID validation
rejects (the version digit must be 1–8). The seeds now use valid ids such
as `40000000-0000-4000-8000-000000000001`. Re-running the seeds over an
old database only adds a second copy of the demo data next to the old one,
so wipe the dev database and reseed instead. This deletes everything in
it, including anything you created by hand:
```bash
cd apps/api
npx prisma migrate reset --force
node prisma/seed-dummy-data.js
```

**`Error: Cannot find module '.../dist/main'` right after a clean compile.**
Not a timing fluke — `apps/api/tsconfig.build.tsbuildinfo` is TypeScript's
incremental build cache. It used to live outside `dist/`, so deleting
`dist/` (by hand, or via `nest-cli.json`'s `deleteOutDir`) didn't clear it;
TypeScript then trusted the stale cache, believed everything was already
emitted, and silently wrote nothing. Fixed by keeping the cache inside
`dist/` (`apps/api/tsconfig.build.json`'s `tsBuildInfoFile`), so it can
never outlive the output it describes — this should no longer happen at
all on current `master`. If you do still hit it somehow:
```bash
rm -rf dist
npm run build
```

**Login fails with a generic "Something went wrong," nothing more
specific.** Almost always one of section 4's three steps not done yet, in
this order of likelihood: (a) frontend still pointed at `localhost:3000`
(check `apps/school-portal/.env.local` exists and the dev server was
restarted after creating it — confirm via DevTools → Network tab → the
failed request's **Request URL**), (b) CORS origin not set to the real
forwarded 5173 URL, (c) never visited the API's own forwarded URL directly
(step 4c).
