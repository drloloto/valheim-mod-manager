FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src ./src
COPY public ./public

# The game container runs as root and the bind mount is root-owned; stay root so restores and installs can write.
USER root
ENV NODE_ENV=production \
    PORT=9002 \
    CONFIG_DIR=/config \
    BACKUP_DIR=/backups \
    ENV_FILE=/env/valheim.env \
    VALHEIM_SERVICE=valheim

EXPOSE 9002
CMD ["bun", "run", "src/server.ts"]
