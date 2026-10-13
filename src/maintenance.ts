// The one path every change to the game's files goes through: stop the server and make sure it is down,
// back the world up, change things, start it again if it was running before. Nothing is touched when the
// stop or the backup fails, so a running server can never save over a restored world and no mod change
// happens without a way back.
import { createBackup } from "./backups";
import { FEATURES } from "./config";
import { containerAction, gameRunning } from "./docker";
import { worldEntries } from "./worlds";

export interface MaintenanceOptions {
	/** world to back up first */
	world: string;
	/** backup file suffix, e.g. "pre-release" */
	label: string;
	/** stop/start the game container (needs COMPANION_ALLOW_CONTROL) */
	control: boolean;
	/** the change is unsafe while the game runs (world restore): refuse unless it is verifiably stopped */
	requireStopped: boolean;
	/** back the world up first (default true); the admin may skip it for a config-only release */
	backup?: boolean;
	log?: (line: string) => void;
}

export interface MaintenanceReport {
	backup: { id: string; size: number } | null;
	stopped: { ok: boolean; message: string } | null;
	started: { ok: boolean; message: string } | null;
	/** the companion could not stop/start the server itself: the admin restarts it */
	restartRequired: boolean;
}

export async function withServerStopped<T>(opts: MaintenanceOptions, fn: () => Promise<T>): Promise<{ value: T } & MaintenanceReport> {
	const log = opts.log ?? (() => {});
	const control = opts.control && FEATURES.control;
	const wasRunning = await gameRunning();

	let stopped: MaintenanceReport["stopped"] = null;
	if (control && wasRunning !== false) {
		stopped = await containerAction("stop");
		if (!stopped.ok) throw new Error(`The server did not stop (${stopped.message}); nothing was changed.`);
		log("server stopped");
	}
	if (opts.requireStopped && !stopped && wasRunning !== false) {
		throw new Error(
			wasRunning === null
				? "Cannot confirm that the server is stopped (Docker socket unavailable); nothing was changed."
				: "The server is running and COMPANION_ALLOW_CONTROL is off: stop it first; nothing was changed.",
		);
	}
	// Only a server the companion stopped is started again; one the admin had stopped stays down.
	const startAgain = async () => (stopped ? await containerAction("start") : null);

	let backup: MaintenanceReport["backup"] = null;
	try {
		if (opts.backup === false) log("backup skipped by request");
		else if ((await worldEntries(opts.world)).length) {
			const b = await createBackup(opts.world, opts.label);
			backup = { id: b.id, size: b.size };
			log(`backup ${b.id}`);
		} else log(`no world "${opts.world}" on disk yet, nothing to back up`);
	} catch (e) {
		await startAgain();
		throw new Error(`Backup failed (${(e as Error).message}); nothing was changed.`);
	}

	let value: T;
	try {
		value = await fn();
	} catch (e) {
		await startAgain();
		throw new Error(`${(e as Error).message}${backup ? ` (backup before the change: ${backup.id})` : ""}`);
	}
	const started = await startAgain();
	if (started) log(started.ok ? "server started" : `start failed: ${started.message}`);
	return { value, backup, stopped, started, restartRequired: !control };
}
