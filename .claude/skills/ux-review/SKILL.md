---
name: ux-review
description: Heuristic UX review of the Mod Manager's pages in the mock preview (Nielsen heuristics, UX best practices, prioritized findings), written from fresh screenshots. Pass page routes as arguments, default all pages.
disable-model-invocation: true
---

# UX review of the mock preview

## Steps

1. Get fresh evidence. The mock preview must be running (`bun run mock` at the root; if port 1420 answers
   without the mock, say so and stop). Run `bun run mock:audit` (German, 1100 × 680, every page), then read
   the screenshots in `apps/client/dev/out/` for the pages in `$ARGUMENTS` (default: all) and the audit's
   findings. Open a page component under `apps/client/src/lib/components/app/` only where a screenshot raises a
   question. Click paths that matter (a selected row, an open popover, an empty filter result) go through
   `bun run mock:shot …` with `ACTION`, see `apps/client/dev/screenshot.mjs`.
2. Judge against this project's own rules, not generic taste: the design reference
   `docs/design/2026-10-02-mod-manager-designs.html` (variant 1a "Werkbank"), the layout rules in
   `apps/client/AGENTS.md` (minimum window 1100 × 680, German catalog, container queries), and "one vocabulary
   per state" (a state is derived once and rendered the same everywhere; the action is offered where the
   state arises).
3. Write the review in German, in the structure below. Every finding names the page, the element and the
   concrete change; nothing generic, no finding without a screenshot or code line behind it. Keep it to what
   changes a decision: at most ten issues, ranked.

## Review structure

1. Usability Heuristics Evaluation
   - Visibility of system status
   - Match between system and real world
   - User control and freedom
   - Consistency and standards
   - Error prevention
   - Recognition rather than recall
   - Flexibility and efficiency of use
   - Aesthetic and minimalist design
   - Help users recognize, diagnose, and recover from errors
   - Help and documentation

2. UX Best Practices Review
   - Information architecture
   - Visual hierarchy
   - Accessibility considerations
   - Responsive design (here: the minimum window and the pane widths, not the viewport)
   - Interaction patterns
   - Content clarity

3. Specific Issues Identified
   - Heuristic violations
   - Usability concerns
   - Accessibility issues
   - Consistency problems
   - User experience gaps

4. Prioritized Recommendations
   - Critical issues (must fix)
   - Important improvements (should fix)
   - Nice-to-have enhancements (consider)

5. Design Strengths
   - What works well
   - Best practices followed
   - Positive patterns used

6. Improvement Suggestions
   - Specific design changes
   - Alternative approaches
   - Examples or references

Format as a structured design review with specific, actionable feedback based on UX principles. Do not change
code during the review; the owner decides what to pick up, then the usual spec → plan → implement path applies.
