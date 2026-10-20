// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
	it("renders GitHub-flavored markdown", () => {
		const html = renderMarkdown("# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n`code`");
		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("<table>");
		expect(html).toContain("<code>code</code>");
	});

	it("strips scripts, handlers and non-http urls, keeps https images and links", () => {
		const html = renderMarkdown(
			[
				"<script>alert(1)</script>",
				'<img src="https://example.com/a.png" onerror="alert(1)">',
				'<img src="javascript:alert(1)">',
				'<a href="javascript:alert(1)">x</a>',
				"[ok](https://example.com)",
				'<iframe src="https://example.com"></iframe>',
			].join("\n\n"),
		);
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("<iframe");
		expect(html).toContain('src="https://example.com/a.png"');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('loading="lazy"');
	});
});
