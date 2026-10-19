#!/usr/bin/env bash
# Adds the Valheim companion to an existing valheim-server compose project, without touching the game.
#
# Run it from a checkout of the repository next to your compose file (git clone …/valheim-mod-manager):
#
#   valheim-mod-manager/apps/companion/install.sh              check only: what would happen (changes nothing)
#   valheim-mod-manager/apps/companion/install.sh install      add the companion; the game keeps running, players stay connected
#   valheim-mod-manager/apps/companion/install.sh update       rebuild and restart only the companion (after a git pull);
#                                                              an install from the old companion repository is moved to this checkout
#   valheim-mod-manager/apps/companion/install.sh status       check the running companion against the game
#   valheim-mod-manager/apps/companion/install.sh uninstall    remove the companion; its data (config/modmanager, backups/) stays
#
# Options: --dir <compose dir>   default: the folder the repository checkout sits in
#          --bind <ip>           default: the server's LAN address (only loopback/private addresses are accepted)
#          --port <n>            default: 9002
#          --service <name>      the game service, when it is not found by its image
#          --yes                 no confirmation question
#
# How it stays out of the way: your compose file is never edited. The companion lives in
# compose.companion.yaml, and three marked lines in .env (COMPOSE_FILE) make `docker compose` load it.
# Every step before those writes is read-only; any failure after them is rolled back.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep /var/run/... as it is

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT_DIR_NATIVE=$(cd "$SCRIPT_DIR" && (pwd -W 2>/dev/null || pwd)) # C:/... under Git Bash, for docker.exe
CMD=check DIR="" BIND="" PORT=9002 SERVICE="" YES=0
while [ $# -gt 0 ]; do
	case "$1" in
	check | install | update | status | uninstall) CMD=$1 ;;
	--dir) DIR=${2:?--dir needs a value}; shift ;;
	--bind) BIND=${2:?--bind needs a value}; shift ;;
	--port) PORT=${2:?--port needs a value}; shift ;;
	--service) SERVICE=${2:?--service needs a value}; shift ;;
	--yes | -y) YES=1 ;;
	-h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
	*) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
	esac
	shift
done

IMAGE=valheim-companion:local
FILE=compose.companion.yaml
MARK_BEGIN="# >>> valheim companion (managed by companion/install.sh, remove with: bash companion/install.sh uninstall)"
MARK_END="# <<< valheim companion"
MARK_EOL="# (install.sh added the line break above this block)"

ok() { printf '  \033[32mok\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
confirm() {
	[ "$YES" = 1 ] && return 0
	printf '\n%s [y/N] ' "$1"
	read -r a </dev/tty || a=""
	case "$a" in y | Y | yes | j | J | ja) return 0 ;; *) echo "Aborted, nothing was changed."; exit 1 ;; esac
}
# The companion's analysis tools run in its own image: the server needs no jq, python or node.
onboard() { docker run --rm -i "$IMAGE" bun run src/onboard.ts "$@"; }
# Prints the INFO/WARN/ERROR lines of onboard.ts as ok/WARN/FAIL lines.
report() {
	local line
	while IFS= read -r line; do
		case "$line" in
		INFO:*) ok "${line#INFO: }" ;;
		WARN:*) warn "${line#WARN: }" ;;
		ERROR:*) printf '  \033[31mFAIL\033[0m  %s\n' "${line#ERROR: }" ;;
		esac
	done
}

# ---- 1. Read-only checks ----
preflight() {
	step "Checking the server (read-only)"
	command -v docker >/dev/null || fail "docker is not installed"
	docker info >/dev/null 2>&1 || fail "cannot talk to Docker; run as a user in the docker group or with sudo"
	local v
	v=$(docker compose version --short 2>/dev/null) || fail "Docker Compose v2 is missing (the 'docker compose' plugin)"
	[ "${v%%.*}" -ge 2 ] 2>/dev/null || fail "Docker Compose $v is too old, v2 is needed"
	ok "Docker and Compose $v"

	DIR=${DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)} # apps/companion → the checkout → the folder it sits in
	cd "$DIR" || fail "cannot enter $DIR"
	BASE=""
	for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do [ -f "$f" ] && { BASE=$f; break; }; done
	[ -n "$BASE" ] || fail "no compose file in $DIR; run this from the folder next to your docker-compose.yaml (or pass --dir)"
	# Compose loads <base>.override.y(a)ml on its own, but not once COMPOSE_FILE is set: list it explicitly.
	FILES=$BASE
	for f in "${BASE%.*}.override.yaml" "${BASE%.*}.override.yml"; do [ -f "$f" ] && { FILES="$FILES:$f"; break; }; done
	docker compose config -q >/dev/null 2>&1 || fail "the compose project does not parse: run 'docker compose config' to see why"
	ok "compose project in $DIR (${FILES//:/ + })"
	# Paths as Compose writes them (C:\... under Git Bash), so they can be shortened to ./...
	DIR_NATIVE=$(pwd -W 2>/dev/null || pwd)
	case "$SCRIPT_DIR/" in "$(pwd)/"*) COMPANION_REL="./${SCRIPT_DIR#"$(pwd)"/}" ;; *) COMPANION_REL=$SCRIPT_DIR ;; esac

	INSTALLED=0
	if [ -f .env ] && grep -qF "$MARK_BEGIN" .env; then INSTALLED=1; fi
	if [ "$INSTALLED" = 0 ]; then
		[ -z "${COMPOSE_FILE:-}" ] || fail "COMPOSE_FILE is set in your shell; unset it first"
		if [ -f .env ] && grep -qE '^[[:space:]]*COMPOSE_(FILE|PATH_SEPARATOR)=' .env; then
			fail ".env already sets COMPOSE_FILE; add $FILE there yourself or remove it first"
		fi
		[ ! -e "$FILE" ] || fail "$FILE exists but is not wired up in .env; remove it or run uninstall"
	fi

	local host
	host=$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || echo "")
	case "$host" in
	unix://*) DOCKER_SOCK=${host#unix://} ;;
	npipe://*) DOCKER_SOCK=/var/run/docker.sock ;; # Docker Desktop: the socket inside its VM
	*) fail "Docker is reached through '$host'; the companion needs the local Docker socket" ;;
	esac
	ok "Docker socket $DOCKER_SOCK"

	if [ -z "$BIND" ]; then
		BIND=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
		[ -n "$BIND" ] || BIND=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
		[ -n "$BIND" ] || BIND=127.0.0.1
	fi
}

check_port() {
	if docker ps --format '{{.Ports}}' | grep -qE "(^|[ ,])[^ ,]*:$PORT->"; then fail "port $PORT is already published by a container; pass --port"; fi
	if command -v ss >/dev/null && [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null)" ]; then fail "port $PORT is in use on this host; pass --port"; fi
	ok "port $PORT is free"
}

game_state() {
	GAME_ID=$(docker compose ps -aq "$SERVICE" 2>/dev/null | head -n1)
	GAME_STARTED="" GAME_RUNNING=0 GAME_WORLD=""
	if [ -n "$GAME_ID" ]; then
		GAME_STARTED=$(docker inspect -f '{{.State.StartedAt}}' "$GAME_ID")
		[ "$(docker inspect -f '{{.State.Running}}' "$GAME_ID")" = true ] && GAME_RUNNING=1
		GAME_WORLD=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$GAME_ID" | sed -n 's/^WORLD_NAME=//p' | tail -n1)
		GAME_WORLD=${GAME_WORLD:-Dedicated} # the image's default
	fi
}

build_image() {
	step "Building the companion image (does not touch the game)"
	local log
	log=$(mktemp)
	# The image builds from the repository root (workspace lockfile); this script lives in apps/companion.
	if ! docker build -t "$IMAGE" -f "$SCRIPT_DIR_NATIVE/Dockerfile" "$SCRIPT_DIR_NATIVE/../.." >"$log" 2>&1; then
		tail -n 30 "$log" >&2
		rm -f "$log"
		fail "the image did not build; nothing was changed"
	fi
	rm -f "$log"
	ok "image $IMAGE"
}

plan() {
	step "Reading your compose project"
	local out rc=0
	# --no-interpolate: secrets like ${PLAYIT_SECRET_KEY} stay placeholders and never leave Compose.
	out=$(docker compose config --format json --no-interpolate |
		onboard plan --project-dir "$DIR_NATIVE" --companion-dir "$COMPANION_REL" --bind "$BIND" --port "$PORT" \
			--docker-sock "$DOCKER_SOCK" ${SERVICE:+--service "$SERVICE"}) || rc=$?
	printf '%s\n' "$out" | sed '/^---YAML---$/q' | report
	[ "$rc" = 0 ] || fail "the companion cannot be added safely as things are; nothing was changed"
	SERVICE=$(printf '%s\n' "$out" | sed -n 's/^SERVICE=//p')
	YAML=$(printf '%s\n' "$out" | sed '1,/^---YAML---$/d')

	game_state
	if [ -z "$GAME_ID" ]; then
		warn "the game container does not exist yet; the companion is checked against it once it runs"
	else
		ok "game container ${GAME_ID:0:12} $([ "$GAME_RUNNING" = 1 ] && echo running || echo stopped), world $GAME_WORLD"
		if [ "$GAME_RUNNING" = 1 ] && ! docker exec "$GAME_ID" sh -c \
			'[ "$BEPINEX" != true ] || [ ! -d /opt/valheim/bepinex/BepInEx ] || [ -L /opt/valheim/bepinex/BepInEx/config ]' 2>/dev/null; then
			warn "BepInEx/config in the game is not linked to /config/bepinex (restored from a ZIP?); the game ignores the configs there"
		fi
	fi
}

companion_verify() {
	local args=(--running "$GAME_RUNNING" --game-id "${GAME_ID:-}")
	[ -n "$GAME_WORLD" ] && args+=(--world "$GAME_WORLD")
	VERIFY=$(docker compose exec -T companion bun run src/onboard.ts verify "${args[@]}") || {
		printf '%s\n' "$VERIFY" | report
		return 1
	}
	printf '%s\n' "$VERIFY" | report
	TOKEN=$(printf '%s\n' "$VERIFY" | sed -n 's/^TOKEN=//p')
}

# ---- 2. Writes (install) ----
write_files() {
	ENV_EXISTED=0
	[ -f .env ] && ENV_EXISTED=1 && cp -p .env .env.companion-backup
	printf '%s' "$YAML" >"$FILE.tmp" && mv "$FILE.tmp" "$FILE"
	# A missing final newline would glue our first line onto the user's last one; uninstall takes it out again.
	local added_eol=""
	if [ -s .env ] && [ -n "$(tail -c1 .env)" ]; then printf '\n' >>.env; added_eol="$MARK_EOL"$'\n'; fi
	printf '%s\n%sCOMPOSE_PATH_SEPARATOR=:\nCOMPOSE_FILE=%s:%s\n%s\n' "$MARK_BEGIN" "$added_eol" "$FILES" "$FILE" "$MARK_END" >>.env
}

remove_block() {
	[ -f .env ] || return 0
	if grep -qxF "$MARK_EOL" .env; then
		# the file had no final newline before install: print the rest without one
		awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0 == b { skip = 1 } !skip { printf "%s%s", (n++ ? "\n" : ""), $0 } $0 == e { skip = 0 }' .env >.env.tmp
	else
		awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0 == b { skip = 1 } !skip { print } $0 == e { skip = 0 }' .env >.env.tmp
	fi
	cat .env.tmp >.env && rm -f .env.tmp # cat keeps the file's owner and mode
	[ -s .env ] || rm -f .env            # it only held our block
}

rollback() {
	warn "rolling back"
	docker compose rm -sf companion >/dev/null 2>&1 || true
	if [ "$ENV_EXISTED" = 1 ]; then cat .env.companion-backup >.env; else rm -f .env; fi
	rm -f .env.companion-backup "$FILE" "$FILE.tmp"
	game_unchanged || true
	fail "the companion was not added; your setup is as before"
}

game_unchanged() {
	[ -z "$GAME_ID" ] && return 0
	local now
	now=$(docker compose ps -aq "$SERVICE" | head -n1)
	if [ "$now" != "$GAME_ID" ] || [ "$(docker inspect -f '{{.State.StartedAt}}' "$GAME_ID")" != "$GAME_STARTED" ]; then
		printf '  \033[31mFAIL\033[0m  the game container was restarted or recreated (this must not happen, please report it)\n' >&2
		return 1
	fi
	ok "game container untouched (same container, same start time)"
}

do_install() {
	preflight
	[ "$INSTALLED" = 0 ] || fail "the companion is already installed here; use 'update' or 'status'"
	check_port
	build_image
	plan
	step "Planned changes"
	echo "  + $DIR/$FILE (new file):"
	printf '%s\n' "$YAML" | sed 's/^/      /'
	echo "  + .env: 4 marked lines that load it (COMPOSE_FILE), the old .env is restored if anything fails"
	echo "  + config/modmanager/ and backups/ are created by the companion on its first start"
	echo "  = ${FILES//:/, }, the game container and its data are not touched"
	[ "$CMD" = check ] && { printf '\nCheck done, nothing was changed. Run "bash %s install" to add the companion.\n' "$0"; exit 0; }
	confirm "Add the companion now?"

	step "Adding the companion"
	local before after
	# What `docker compose up` sees today vs. with the new file: identical, or Compose would recreate the game.
	# (Interpolated: --no-interpolate ignores the service filter. Only compared in memory, never printed.)
	before=$(docker compose config "$SERVICE" 2>/dev/null)
	write_files
	trap rollback ERR
	after=$(docker compose config "$SERVICE" 2>/dev/null)
	[ "$before" = "$after" ] || { warn "the game service would change with the new file"; rollback; }
	ok "game service definition unchanged"
	# --no-deps: only the companion is created; Compose leaves every other container as it is.
	docker compose up -d --no-deps --no-build --wait --wait-timeout 120 companion >/dev/null 2>&1 || { warn "the companion did not become healthy"; docker compose logs --tail 30 companion >&2 || true; rollback; }
	ok "companion running and healthy"
	game_unchanged || rollback

	step "Checking that the companion sees the same server as the game"
	companion_verify || rollback
	trap - ERR
	rm -f .env.companion-backup

	step "Done"
	echo "  Open:   http://$BIND:$PORT"
	[ -n "${TOKEN:-}" ] && echo "  Token:  $TOKEN   (also in config/modmanager/companion-token)"
	echo "  Next:   publish your mod profile from the Valheim Mod Manager; hand-installed mods are moved"
	echo "          to config/modmanager/untracked/ (not deleted) when the first release is applied."
	echo "  Remove: bash $0 uninstall"
}

# ---- 3. update: an older install builds from the old companion repository ----
# The install.sh of the old repository wrote `build: "./companion"` (its checkout next to the compose file). The
# image now builds from this repository's root, so only that block is rewritten; every other line of the file
# (an admin's own environment entries, ports, comments) stays as it is. A `build:` block is left alone.
migrate_compose_file() {
	OLD_CHECKOUT=""
	local old repo before after
	old=$(sed -n 's/^    build: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "$FILE" | head -n1)
	[ -n "$old" ] || return 0
	repo=${COMPANION_REL%/apps/companion}
	step "Moving $FILE to this checkout"
	before=$(docker compose config "$SERVICE" 2>/dev/null)
	cp -p "$FILE" "$FILE.before-update"
	awk -v repo="$repo" '
		/^    build: / && !done { print "    build:"; print "      context: \"" repo "\""; print "      dockerfile: \"apps/companion/Dockerfile\""; done = 1; next }
		{ print }' "$FILE.before-update" >"$FILE.tmp" && mv "$FILE.tmp" "$FILE"
	after=$(docker compose config "$SERVICE" 2>/dev/null)
	if ! docker compose config -q >/dev/null 2>&1 || [ "$before" != "$after" ]; then
		cat "$FILE.before-update" >"$FILE"
		rm -f "$FILE.before-update"
		fail "the rewritten $FILE did not parse or changed the game service; the file is as before"
	fi
	ok "$FILE now builds the image from $repo (was: $old; the previous file is $FILE.before-update)"
	if [ -d "$old" ] && [ "$(cd "$old" && pwd)" != "$SCRIPT_DIR" ] && [ "$(cd "$old" && pwd)" != "$(cd "$repo" && pwd)" ]; then OLD_CHECKOUT=$old; fi
	return 0
}

do_update() {
	preflight
	[ "$INSTALLED" = 1 ] || fail "the companion is not installed here; run 'install'"
	SERVICE=$(sed -n 's/.*VALHEIM_SERVICE=\([^"]*\)".*/\1/p' "$FILE")
	migrate_compose_file
	build_image
	game_state
	step "Restarting only the companion"
	docker compose up -d --no-deps --no-build --wait --wait-timeout 120 companion >/dev/null 2>&1 || { docker compose logs --tail 30 companion >&2; fail "the new companion did not become healthy"; }
	ok "companion running and healthy"
	game_unchanged
	step "Checking that the companion sees the same server as the game"
	companion_verify || fail "see above"
	if [ -n "$OLD_CHECKOUT" ]; then
		echo "  Note:   $OLD_CHECKOUT is the old companion repository; nothing builds from it any more, remove it when you like"
	fi
}

do_status() {
	preflight
	[ "$INSTALLED" = 1 ] || fail "the companion is not installed here"
	SERVICE=$(sed -n 's/.*VALHEIM_SERVICE=\([^"]*\)".*/\1/p' "$FILE")
	game_state
	step "Companion"
	docker compose ps companion --format '  {{.Name}}  {{.Status}}'
	companion_verify || fail "see above"
}

do_uninstall() {
	preflight
	[ "$INSTALLED" = 1 ] || fail "the companion is not installed here (no marked block in .env)"
	echo "  - the companion container, $FILE and the marked lines in .env are removed"
	echo "  = config/modmanager/ (token, mod lock, moved-aside mods) and backups/ stay; delete them yourself if wanted"
	confirm "Remove the companion?"
	docker compose rm -sf companion >/dev/null
	remove_block
	rm -f "$FILE" "$FILE.before-update"
	ok "companion removed; 'docker image rm $IMAGE' frees its image"
}

case "$CMD" in
check | install) do_install ;;
update) do_update ;;
status) do_status ;;
uninstall) do_uninstall ;;
esac
