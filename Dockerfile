# Stage 1: build the SvelteKit UI to static files. Its toolchain never reaches the runtime image.
FROM oven/bun:1-alpine AS ui
WORKDIR /ui
COPY ui/package.json ui/bun.lock* ./
RUN bun install --frozen-lockfile
COPY ui/ ./
RUN bun run build

# Stage 2: the companion server (Hono on Bun) with two runtime dependencies and the built UI.
FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY --from=ui /ui/build ./ui/build

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
