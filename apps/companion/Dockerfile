# Built from the repository root, because the workspace lockfile and the shared packages live there:
#   docker build -f apps/companion/Dockerfile -t valheim-companion:local .
# Dockerfile.dockerignore next to this file keeps the context to the companion and the workspace files.

# Stage 1: the workspace toolchain. Builds the SvelteKit UI to static files and deploys the server's two
# runtime dependencies; none of it reaches the runtime image.
FROM node:24-alpine AS workspace
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/companion/package.json apps/companion/
COPY apps/companion/ui/package.json apps/companion/ui/
RUN pnpm install --frozen-lockfile --filter @vmm/companion --filter @vmm/companion-ui
COPY apps/companion apps/companion
RUN pnpm --filter @vmm/companion-ui build \
    && pnpm --filter @vmm/companion deploy --prod /out

# Stage 2: the companion server (Hono on Bun) with its runtime dependencies and the built UI.
FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=workspace /out/package.json ./
COPY --from=workspace /out/node_modules ./node_modules
COPY --from=workspace /out/src ./src
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
