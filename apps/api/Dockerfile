# apps/api production image — first pass (docs/ULTM8-MASTER-ROADMAP.md §3 "genuine
# gaps": no Dockerfile existed anywhere in this repo before this). Confirmed deploy
# target is AWS ECS Fargate (Spec §11.6, Decision 11) — this image is built for that,
# not for local dev (the devcontainer's docker-compose.yml already covers that, with
# a real Postgres/Redis; this Dockerfile only ever runs apps/api's own compiled code).
#
# Uses `turbo prune --docker` (see infra/terraform/README.md and the root turbo.json)
# rather than a hand-rolled multi-COPY layout: apps/api has zero internal workspace
# dependencies (`turbo prune @ultm8/api --docker` emits nothing under out/full/packages
# or out/full/apps besides apps/api itself — verified directly before writing this,
# not assumed), so this is the standard Turborepo Docker recipe, not overkill for a
# bigger dependency graph than actually exists here.
#
# Base image: node:20-bookworm-slim, not -alpine. Prisma's own query-engine binary is
# platform-specific (glibc vs musl) and historically needs extra `libssl`/openssl
# packages on Alpine to avoid an engine-not-found failure at runtime — Debian-slim
# avoids that whole class of problem for a first-pass image; revisit only if image
# size becomes a real, measured problem.
#
# Deliberately does NOT run `prisma migrate deploy` in the image's own entrypoint —
# running migrations from every replica's own container boot (Fargate can and does
# scale to N tasks) races multiple replicas against the same migration lock for no
# benefit. Migrations are a separate CD-pipeline step (see .github/workflows/deploy.yml
# once it exists) or a manual `prisma migrate deploy` run, same as every other
# migration in this repo has been verified so far (see this repo's own migration
# file headers — "verify with a real Postgres run before trusting this").

FROM node:20-bookworm-slim AS pruner
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN npx turbo prune @ultm8/api --docker

# ---- Install: only the pruned lockfile subset, for layer-cache efficiency ----
FROM node:20-bookworm-slim AS installer
WORKDIR /workspace
COPY --from=pruner /workspace/out/json/ .
RUN npm ci

# ---- Build: full pruned source + the installed node_modules from above ----
FROM node:20-bookworm-slim AS builder
WORKDIR /workspace
COPY --from=installer /workspace/ .
COPY --from=pruner /workspace/out/full/ .
# Prisma's generate step needs the `prisma` CLI (a devDependency) and writes
# generated client code into node_modules/@prisma/client + node_modules/.prisma —
# both captured below before the prod-only prune.
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npx turbo run build --filter=@ultm8/api
RUN npm prune --omit=dev

# ---- Runtime: the smallest image — no devDependencies, no build tooling ----
FROM node:20-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 ultm8 \
    && useradd --system --uid 1001 --gid ultm8 ultm8
COPY --from=builder --chown=ultm8:ultm8 /workspace/node_modules ./node_modules
COPY --from=builder --chown=ultm8:ultm8 /workspace/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=ultm8:ultm8 /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=ultm8:ultm8 /workspace/apps/api/prisma ./apps/api/prisma
USER ultm8
EXPOSE 3000
# Matches main.ts's own PORT env var read (defaults to 3000) — see
# apps/api/src/main.ts. No HEALTHCHECK instruction: this repo has no dedicated
# /health(z) route yet (confirmed by reading main.ts/app.module.ts directly, not
# assumed) — ECS's own target-group health check can point at any real route
# (e.g. GET /v1/docs) until one exists; adding a fabricated endpoint here would be
# inventing API surface this Dockerfile has no business deciding.
CMD ["node", "apps/api/dist/main.js"]
