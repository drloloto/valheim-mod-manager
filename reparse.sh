#!/usr/bin/env bash
# Compares what really runs on this server (companion installs, hand-installed packages in plugins/, loose
# files) with the mod lock, package by package with versions. Nothing changes without --write.
#
#   bash companion/reparse.sh            show the comparison; exit 0 = lock matches disk, 1 = differences
#   bash companion/reparse.sh --write    replace the lock with what is on disk, unless something blocks it
#                                        (unresolved package, staged release, entries that would be dropped)
#   bash companion/reparse.sh --write --force   accept a staged release and dropped entries; unresolved
#                                        packages still block
#   --json                               machine-readable report
#
# Run it in the folder with the server's docker-compose.yaml (where install.sh put the companion). The
# comparison runs inside the companion container, so it sees the same /config the companion serves.
# Resolving hand-installed packages asks Thunderstore once per package. A written lock is published to the
# gist by the running companion on its next poll.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
if ! docker compose ps --status running companion --format '{{.Name}}' 2>/dev/null | grep -q .; then
	echo "the companion container is not running here (docker compose ps companion)" >&2
	exit 3
fi
exec docker compose exec -T companion bun run src/reparse.ts "$@"
