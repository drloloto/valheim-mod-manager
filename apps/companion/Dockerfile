# Built from the repository root, because the workspace lockfile and the shared packages live there:
#   docker build -f apps/companion/Dockerfile -t valheim-companion:local .
# Dockerfile.dockerignore next to this file keeps the context to the companion and the workspace files.

# Stage 1: the workspace toolchain. Node for Vite+ (vp runs on Node), Bun as the package manager. Builds the
# SvelteKit UI to static files; none of it reaches the runtime image.
FROM node:26-alpine AS workspace
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
# Every workspace package.json: the frozen lockfile covers the whole workspace.
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/companion/package.json apps/companion/
COPY apps/companion/ui/package.json apps/companion/ui/
COPY packages/ui/package.json packages/ui/
# No lifecycle scripts: the root's `prepare` installs git hooks (needs git, pointless in an image). esbuild
# loads its platform package, which the lockfile pins, so its postinstall is not needed.
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/ui packages/ui
COPY apps/companion apps/companion
# the workspace's own vp (bun links it into node_modules/.bin); the bun image ships bunx only as a symlink
RUN node_modules/.bin/vp run --filter @vmm/companion-ui build

# Stage 2: the companion's runtime dependencies only (hono, fflate), at the lockfile's versions.
FROM oven/bun:1-alpine AS runtime-deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/
COPY apps/companion/package.json apps/companion/
COPY apps/companion/ui/package.json apps/companion/ui/
COPY packages/ui/package.json packages/ui/
# a filtered install lands in the package's own node_modules, not the workspace root
RUN bun install --production --frozen-lockfile --ignore-scripts --filter @vmm/companion

# Stage 3: the companion server (Hono on Bun) with its runtime dependencies and the built UI.
# The workspace layout stays: bun links the package's dependencies into its own node_modules as symlinks
# into the store at /repo/node_modules/.bun.
FROM oven/bun:1-alpine
WORKDIR /repo/apps/companion

COPY apps/companion/package.json ./
COPY --from=runtime-deps /repo/node_modules /repo/node_modules
COPY --from=runtime-deps /repo/apps/companion/node_modules ./node_modules
COPY apps/companion/src ./src
COPY --from=workspace /repo/apps/companion/ui/build ./ui/build

# The game container runs as root and the bind mount is root-owned; stay root so restores and installs can write.
USER root
ENV NODE_ENV=production \
    PORT=9002 \
    CONFIG_DIR=/config \
    BACKUP_DIR=/backups \
    ENV_FILE=/env/valheim.env \
    VALHEIM_SERVICE=valheim

EXPOSE 9002
# `docker compose up --wait` (install.sh) and `docker ps` show whether the companion really serves requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:9002/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "run", "src/server.ts"]
