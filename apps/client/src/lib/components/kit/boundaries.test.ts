// Architecture rules: app pages use only kit/shell, colors only via tokens.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const ROOT = join(__dirname, "..", "..", "..", "..");
const files = (dir: string) =>
	(readdirSync(join(ROOT, dir), { recursive: true }) as string[]).filter((f) => f.endsWith(".svelte") || f.endsWith(".ts")).map((f) => join(dir, f));

describe("UI boundaries", () => {
	it("app pages do not import ui primitives directly", () => {
		const offenders = [...files("src/routes"), ...files("src/lib/components/app")].filter((f) =>
			/from\s+["'](?:[#$]lib|@vmm\/ui)\/components\/ui\//.test(readFileSync(join(ROOT, f), "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("no hard-coded color values in Svelte components", () => {
		const svelte = [
			...files("src/routes"),
			...files("src/lib/components/app"),
			...files("src/lib/components/kit"),
			...files("src/lib/components/shell"),
			...files("../../packages/ui/src/components/kit"),
		]
			.filter((f) => f.endsWith(".svelte"))
			.filter((f) => !f.endsWith("title-bar.svelte"));
		const offenders = svelte.filter((f) => /oklch\(|(?<![{\w])#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(join(ROOT, f), "utf8")));
		expect(offenders).toEqual([]);
	});
});
