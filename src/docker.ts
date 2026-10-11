// Talks to the Docker Engine API over the mounted unix socket to stop, start and restart the sibling
// game service. No docker CLI in the image.
const SOCKET_PATH = "/var/run/docker.sock";
const SERVICE_NAME = process.env.VALHEIM_SERVICE || "valheim";

/**
 * Lower bound for the stop timeout. The image sends SIGINT and Valheim saves the world before it exits; on
 * a big world that takes longer than Docker's default 10 s. A longer stop_grace_period in compose wins.
 */
export const MIN_STOP_SECONDS = 120;

export async function dockerFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`http://localhost${path}`, {
		...init,
		unix: SOCKET_PATH,
		// A stop waits for the world save; Bun's default request timeout must not cut it short.
		timeout: false,
	} as RequestInit);
}

interface Container {
	Id: string;
	Names?: string[];
	State?: string;
	Status?: string;
}

interface Inspect {
	State?: { Running?: boolean; Status?: string; StartedAt?: string };
	Config?: { StopTimeout?: number };
}

async function gameContainers(): Promise<Container[]> {
	const hostname = process.env.HOSTNAME;
	if (!hostname) throw new Error("no HOSTNAME, cannot find the compose project");
	const self = await dockerFetch(`/containers/${hostname}/json`);
	if (!self.ok) throw new Error(`docker socket not reachable (${self.status}); is /var/run/docker.sock mounted?`);
	const project = ((await self.json()) as { Config?: { Labels?: Record<string, string> } }).Config?.Labels?.["com.docker.compose.project"];
	if (!project) throw new Error("no com.docker.compose.project label on this container");
	const filters = encodeURIComponent(
		JSON.stringify({
			label: [`com.docker.compose.project=${project}`, `com.docker.compose.service=${SERVICE_NAME}`],
		}),
	);
	const list = await dockerFetch(`/containers/json?all=true&filters=${filters}`);
	if (!list.ok) throw new Error(`container list failed (${list.status})`);
	const containers = (await list.json()) as Container[];
	if (!containers.length) throw new Error(`no container for service "${SERVICE_NAME}" in project "${project}"`);
	return containers;
}

async function inspect(id: string): Promise<Inspect> {
	const res = await dockerFetch(`/containers/${id}/json`);
	if (!res.ok) throw new Error(`inspect failed (${res.status})`);
	return (await res.json()) as Inspect;
}

export async function gameContainerId(): Promise<string> {
	return (await gameContainers())[0].Id;
}

export interface ContainerState {
	id: string;
	name: string;
	state: string;
	status: string;
	startedAt: string | null;
}

export async function containerState(): Promise<ContainerState | null> {
	try {
		const c = (await gameContainers())[0];
		const startedAt = (await inspect(c.Id).catch(() => null))?.State?.StartedAt ?? null;
		return {
			id: c.Id.slice(0, 12),
			name: c.Names?.[0]?.replace(/^\//, "") ?? c.Id,
			state: c.State ?? "unknown",
			status: c.Status ?? "",
			startedAt,
		};
	} catch {
		return null;
	}
}

/** true / false from Docker, null when the socket is unavailable. */
export async function gameRunning(): Promise<boolean | null> {
	try {
		for (const c of await gameContainers()) if ((await inspect(c.Id)).State?.Running) return true;
		return false;
	} catch {
		return null;
	}
}

export type ContainerAction = "restart" | "stop" | "start";

/** Seconds Docker waits before SIGKILL: the container's own stop_grace_period, but never below the minimum. */
export const stopSeconds = (configured: number | undefined) => Math.max(configured ?? 0, MIN_STOP_SECONDS);

export async function containerAction(action: ContainerAction): Promise<{ ok: boolean; message: string }> {
	try {
		for (const c of await gameContainers()) {
			const name = c.Names?.[0] ?? c.Id;
			const t = action === "start" ? "" : `?t=${stopSeconds((await inspect(c.Id)).Config?.StopTimeout)}`;
			const res = await dockerFetch(`/containers/${c.Id}/${action}${t}`, {
				method: "POST",
			});
			if (!res.ok && res.status !== 204 && res.status !== 304) return { ok: false, message: `${action} failed (${res.status}) for ${name}` };
			// A stop is only done when Docker says the container is no longer running.
			if (action === "stop" && (await inspect(c.Id)).State?.Running) return { ok: false, message: `${name} is still running after stop` };
		}
		return { ok: true, message: `${SERVICE_NAME}: ${action} done` };
	} catch (e) {
		return { ok: false, message: (e as Error).message };
	}
}
