// "What changed" between two versions: the slice of a Thunderstore CHANGELOG.md whose version headings
// lie in (installed, target]. Pure, so the update dialog can be tested without the network.

const VERSION = /(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/** Numeric, segment-wise; missing segments count as 0. Non-numeric suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
	const pa =
		a
			.match(VERSION)
			?.slice(1)
			.map((x) => Number(x ?? 0)) ?? [];
	const pb =
		b
			.match(VERSION)
			?.slice(1)
			.map((x) => Number(x ?? 0)) ?? [];
	for (let i = 0; i < 4; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

export interface ChangelogSlice {
	/** Markdown of the matching sections, newest first as in the file. */
	markdown: string;
	/** Versions found in headings between installed (exclusive) and target (inclusive). */
	versions: string[];
	/** True when the changelog has version headings but none in range; false when it has none at all. */
	hasHeadings: boolean;
}

/**
 * Splits at headings that carry a version number and keeps the sections in (installed, target].
 * Headings without a version (e.g. "# Changelog") are dropped; text before the first heading is kept
 * only when no version headings exist at all, so a free-form changelog still shows something.
 */
export function sliceChangelog(markdown: string, installed: string, target: string): ChangelogSlice {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const sections: { version: string | null; lines: string[] }[] = [{ version: null, lines: [] }];
	for (const line of lines) {
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (heading) {
			const v = heading[1].match(VERSION)?.[0] ?? null;
			sections.push({ version: v, lines: [line] });
		} else {
			sections[sections.length - 1].lines.push(line);
		}
	}
	const versioned = sections.filter((s) => s.version);
	if (!versioned.length) {
		return { markdown: markdown.trim(), versions: [], hasHeadings: false };
	}
	const inRange = versioned.filter((s) => compareVersions(s.version!, installed) > 0 && compareVersions(s.version!, target) <= 0);
	return {
		markdown: inRange.map((s) => s.lines.join("\n").trim()).join("\n\n"),
		versions: inRange.map((s) => s.version!),
		hasHeadings: true,
	};
}
