// Layout audit, evaluated in the page by dev/screenshot.mjs. Reports:
//   SPILL-X          content wider than its box while overflow is visible (text paints over neighbours)
//   SCROLLBAR-X/Y    real scrollbars (Y is often intended; X almost never is)
//   OUT-OF-VIEWPORT  element outside the window
//   OVERLAP          two visible text leaves that paint over each other
// Overlays (toasts, the selection bar) legitimately cover content, so a few OVERLAP lines are expected.
(() => {
	const out = [];
	const desc = (el) => {
		const cls = (el.getAttribute("class") || "").split(/\s+/).slice(0, 4).join(".");
		return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
	};
	const all = [...document.querySelectorAll("body *")];
	for (const el of all) {
		const cs = getComputedStyle(el);
		if (cs.display === "none" || cs.visibility === "hidden") continue;
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) continue;
		if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible" && el.clientWidth > 0)
			out.push(`SPILL-X ${desc(el)} scrollW=${el.scrollWidth} clientW=${el.clientWidth} text="${(el.textContent || "").trim().slice(0, 40)}"`);
		if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1)
			out.push(`SCROLLBAR-X ${desc(el)} scrollW=${el.scrollWidth} clientW=${el.clientWidth}`);
		if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1)
			out.push(`SCROLLBAR-Y ${desc(el)} scrollH=${el.scrollHeight} clientH=${el.clientHeight}`);
		if (r.right > innerWidth + 1 || r.left < -1) out.push(`OUT-OF-VIEWPORT ${desc(el)} left=${Math.round(r.left)} right=${Math.round(r.right)}`);
	}
	// visible rect = own rect clipped by every clipping ancestor and by the viewport
	const visibleRect = (el) => {
		let { left, top, right, bottom } = el.getBoundingClientRect();
		for (let p = el.parentElement; p; p = p.parentElement) {
			const cs = getComputedStyle(p);
			if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
			const pr = p.getBoundingClientRect();
			left = Math.max(left, pr.left);
			top = Math.max(top, pr.top);
			right = Math.min(right, pr.right);
			bottom = Math.min(bottom, pr.bottom);
		}
		left = Math.max(left, 0);
		top = Math.max(top, 0);
		right = Math.min(right, innerWidth);
		bottom = Math.min(bottom, innerHeight);
		return { left, top, right, bottom, width: right - left, height: bottom - top };
	};
	const leaves = all.filter((el) => el.childElementCount === 0 && (el.textContent || "").trim() && getComputedStyle(el).display !== "none");
	const rects = leaves.map((el) => ({ el, r: visibleRect(el) })).filter((x) => x.r.width > 0 && x.r.height > 0);
	for (let i = 0; i < rects.length; i++)
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i];
			const b = rects[j];
			if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
			const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
			const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
			if (ox > 2 && oy > 2)
				out.push(
					`OVERLAP ${desc(a.el)}"${a.el.textContent.trim().slice(0, 20)}" x ${desc(b.el)}"${b.el.textContent.trim().slice(0, 20)}" (${Math.round(ox)}x${Math.round(oy)})`,
				);
		}
	return `viewport=${innerWidth}x${innerHeight} docScrollW=${document.documentElement.scrollWidth}\n` + (out.length ? [...new Set(out)].join("\n") : "clean");
})();
