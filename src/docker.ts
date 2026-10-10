// Talks to the Docker Engine API over the mounted unix socket to stop, start and restart the sibling
// game service. No docker CLI in the image.
const SOCKET_PATH = "/var/run/docker.sock";
const SERVICE_NAME = process.env.VALHEIM_SERVICE || "valheim";

export async function dockerFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`http://localhost${path}`, {
		...init,
		unix: SOCKET_PATH,
	} as RequestInit);
}

interface Container {
	Id: string;
	Names?: string[];
	State?: string;
	Status?: string;
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
		const inspect = await dockerFetch(`/containers/${c.Id}/json`);
		const startedAt = inspect.ok ? (((await inspect.json()) as { State?: { StartedAt?: string } }).State?.StartedAt ?? null) : null;
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

export type ContainerAction = "restart" | "stop" | "start";

export async function containerAction(action: ContainerAction): Promise<{ ok: boolean; message: string }> {
	try {
		for (const c of await gameContainers()) {
			const t = action === "start" ? "" : "?t=60";
			const res = await dockerFetch(`/containers/${c.Id}/${action}${t}`, {
				method: "POST",
			});
			if (!res.ok && res.status !== 204 && res.status !== 304)
				return {
					ok: false,
					message: `${action} failed (${res.status}) for ${c.Names?.[0] ?? c.Id}`,
				};
		}
		return { ok: true, message: `${SERVICE_NAME}: ${action} done` };
	} catch (e) {
		return { ok: false, message: (e as Error).message };
	}
}
