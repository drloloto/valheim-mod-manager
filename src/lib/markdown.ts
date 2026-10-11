// Thunderstore markdown (readme, changelog, wiki) → sanitized HTML for `{@html}`.
// marked renders, DOMPurify strips everything that could run or navigate: scripts, event handlers,
// iframes, javascript: URLs. Images and links are kept but only over http(s); links are opened by the
// Markdown component through `openExternal`, never by the WebView itself.
import DOMPurify from "dompurify";
import { marked } from "marked";

marked.use({ gfm: true, breaks: false });

const ALLOWED_SCHEME = /^(https?:|mailto:|#)/i;

let hooked = false;
function hook() {
	if (hooked) return;
	hooked = true;
	DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
		if (data.attrName === "href" || data.attrName === "src") {
			const v = data.attrValue.trim();
			if (v && !ALLOWED_SCHEME.test(v)) data.keepAttr = false;
		}
	});
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.nodeName === "IMG") node.setAttribute("loading", "lazy");
	});
}

export function renderMarkdown(source: string): string {
	hook();
	const html = marked.parse(source, { async: false });
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
	});
}
