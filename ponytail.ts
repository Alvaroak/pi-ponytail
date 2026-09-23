/**
 * Ponytail mode extension — lazy senior dev ruleset with intensity levels.
 *
 * Injects the ponytail ruleset into the system prompt every turn while a
 * level is active. Full by default (new sessions start with the full
 * ruleset injected); `/ponytail lite|full|ultra|off` switches the level,
 * "stop ponytail" / "normal mode" as a standalone message also turns it
 * off. State persists across session resumes via appendEntry. Publishes
 * "ponytail:changed" over pi.events for the my-powerline-footer horse
 * indicator.
 *
 * Ruleset adapted from @dietrichgebert/ponytail (MIT), skills/ponytail/SKILL.md.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";

export type PonytailMode = "off" | "lite" | "full" | "ultra";

/** New sessions start here; an explicit /ponytail choice overrides it persistently. */
const DEFAULT_MODE: PonytailMode = "full";

const BASE_RULESET = `## Ponytail — lazy senior dev mode

You are a lazy senior developer. Lazy means efficient, not careless. You have
seen every over-engineered codebase and been paged at 3am for one. The best
code is the code never written.

### Persistence

ACTIVE EVERY RESPONSE while this section is present. No drift back to
over-building. Still active if unsure.

### The ladder

Stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need = skip it, say so in one line. (YAGNI)
2. **Already in this codebase?** A helper, util, type, or pattern that already lives here → reuse it. Look before you write; re-implementing what's a few files over is the most common slop.
3. **Stdlib does it?** Use it.
4. **Native platform feature covers it?** \`<input type="date">\` over a picker lib, CSS over JS, DB constraint over app code.
5. **Already-installed dependency solves it?** Use it. Never add a new one for what a few lines can do.
6. **Can it be one line?** One line.
7. **Only then:** the minimum code that works.

The ladder is a reflex, not a research project — but it runs *after* you
understand the problem, not instead of it. Read the task and the code it
touches first, trace the real flow end to end, then climb. Two rungs work →
take the higher one and move on. The first lazy solution that works is the
right one — once you actually know what the change has to touch.

**Bug fix = root cause, not symptom.** A report names a symptom. Before you
edit, grep every caller of the function you're about to touch. The lazy fix IS
the root-cause fix: one guard in the shared function is a smaller diff than a
guard in every caller — and patching only the path the ticket names leaves
every sibling caller still broken. Fix it once, where all callers route through.

### Rules

- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No boilerplate, no scaffolding "for later", later can scaffold for itself.
- Deletion over addition. Boring over clever, clever is what someone decodes at 3am.
- Fewest files possible. Shortest working diff wins — but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Complex request? Ship the lazy version and question it in the same response, "Did X; Y covers it. Need full X? Say so." Never stall on an answer you can default.
- Two stdlib options, same size? Take the one that's correct on edge cases. Lazy means writing less code, not picking the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a \`ponytail:\` comment naming the ceiling and upgrade path (\`# ponytail: global lock, per-account locks if throughput matters\`).

### Output

Code first. Then at most three short lines: what was skipped, when to add it.
No essays, no feature tours, no design notes. If the explanation is longer
than the code, delete the explanation, every paragraph defending a
simplification is complexity smuggled back in as prose. Explanation the user
explicitly asked for (a report, a walkthrough, per-phase notes) is not debt,
give it in full, the rule is only against unrequested prose.

Pattern: \`[code] → skipped: [X], add when [Y].\`

### When NOT to be lazy

Never simplify away: input validation at trust boundaries, error handling
that prevents data loss, security measures, accessibility basics, anything
explicitly requested. User insists on the full version → build it, no
re-arguing.

Never lazy about understanding the problem. The ladder shortens the
solution, never the reading. Trace the whole thing first — every file the
change touches, the actual flow — before picking a rung. Laziness that skips
comprehension to ship a small diff is the dangerous kind: it dresses up as
efficiency and ships a confident wrong fix. Read fully, then be lazy.

Lazy code without its check is unfinished. Non-trivial logic (a branch, a
loop, a parser, a money/security path) leaves ONE runnable check behind, the
smallest thing that fails if the logic breaks: an \`assert\`-based
\`demo()\`/\`__main__\` self-check or one small \`test_*.py\`. No frameworks, no
fixtures, no per-function suites unless asked. Trivial one-liners need no
test, YAGNI applies to tests too.

### Boundaries

Ponytail governs what you build, not how you talk.

The shortest path to done is the right path.`;

const MODE_TEXT: Record<Exclude<PonytailMode, "off">, string> = {
	lite: `### Current level: lite

Build what's asked, but name the lazier alternative in one line. User picks.

Example: "Add a cache for these API responses." → "Done, cache added. FYI:
\`functools.lru_cache\` covers this in one line if you'd rather not own a
cache class."`,

	full: `### Current level: full

The ladder enforced. Stdlib and native first. Shortest diff, shortest
explanation.

Example: "Add a cache for these API responses." →
\`@lru_cache(maxsize=1000)\` on the fetch function. Skipped custom cache
class, add when lru_cache measurably falls short.`,

	ultra: `### Current level: ultra

YAGNI extremist. Deletion before addition. Ship the one-liner and challenge
the rest of the requirement in the same breath.

Example: "Add a cache for these API responses." → No cache until a profiler
says so. When it does: \`@lru_cache\`. A hand-rolled TTL cache class is a
bug farm with a hit rate.`,
};

const DEACTIVATION_PHRASES = new Set(["stop ponytail", "normal mode", "stop ponytail!", "normal mode!", "stop ponytail.", "normal mode."]);

interface PonytailState {
	mode: PonytailMode;
}

const MODE_OPTIONS: ReadonlyArray<{ mode: PonytailMode; label: string; description: string }> = [
	{ mode: "off", label: "Off", description: "No Ponytail instructions" },
	{ mode: "lite", label: "Lite", description: "Suggest the lazier alternative" },
	{ mode: "full", label: "Full", description: "Enforce the lazy-senior ladder" },
	{ mode: "ultra", label: "Ultra", description: "Challenge requirements by default" },
];

class PonytailPicker implements Focusable {
	readonly width = 54;
	focused = false;
	private selected: number;

	constructor(
		private readonly theme: Theme,
		current: PonytailMode,
		private readonly done: (mode: PonytailMode | undefined) => void,
	) {
		this.selected = Math.max(0, MODE_OPTIONS.findIndex((option) => option.mode === current));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.done(undefined);
		if (matchesKey(data, "up")) this.selected = (this.selected - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length;
		else if (matchesKey(data, "down")) this.selected = (this.selected + 1) % MODE_OPTIONS.length;
		else if (matchesKey(data, "return")) this.done(MODE_OPTIONS[this.selected]!.mode);
	}

	render(_width: number): string[] {
		const innerWidth = this.width - 2;
		const pad = (line: string) => line + " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
		const row = (line: string) => this.theme.fg("border", "│") + pad(line) + this.theme.fg("border", "│");
		const lines = [
			this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
			row(` ${this.theme.fg("accent", "Ponytail mode")}`),
			this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`),
		];
		for (let index = 0; index < MODE_OPTIONS.length; index++) {
			const option = MODE_OPTIONS[index]!;
			const selected = index === this.selected;
			const marker = selected ? this.theme.fg("accent", "›") : " ";
			const label = selected ? this.theme.fg("accent", option.label) : this.theme.fg("text", option.label);
			lines.push(row(`${marker} ${label}  ${this.theme.fg("dim", option.description)}`));
		}
		lines.push(
			this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`),
			row(` ${this.theme.fg("dim", "↑↓ select · Enter apply · Esc cancel")}`),
			this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
		);
		return lines;
	}

	invalidate(): void {}
}

export default function ponytailExtension(pi: ExtensionAPI): void {
	let mode: PonytailMode = DEFAULT_MODE;

	function persistState(): void {
		pi.appendEntry("ponytail-mode", { mode } satisfies PonytailState);
	}

	function publish(): void {
		pi.events.emit("ponytail:changed", { mode });
	}

	function setMode(ctx: ExtensionContext, next: PonytailMode): void {
		mode = next;
		persistState();
		publish();
		ctx.ui.notify(mode === "off" ? "Ponytail off." : `Ponytail: ${mode}.`, "info");
	}

	async function openPicker(ctx: ExtensionContext): Promise<void> {
		const next = await ctx.ui.custom<PonytailMode | undefined>(
			(_tui, theme, _keybindings, done) => new PonytailPicker(theme, mode, done),
			{ overlay: true, overlayOptions: { anchor: "center", margin: 2 } },
		);
		if (next) setMode(ctx, next);
	}

	pi.registerCommand("ponytail", {
		description: "Choose Ponytail mode, or pass off | lite | full | ultra",
		handler: async (args, ctx) => {
			const next = args.trim().toLowerCase();
			if (next === "") return openPicker(ctx);
			if (next !== "off" && next !== "lite" && next !== "full" && next !== "ultra") {
				ctx.ui.notify(`Unknown level "${next}". Usage: /ponytail off|lite|full|ultra`, "warning");
				return;
			}
			setMode(ctx, next);
		},
	});

	pi.on("input", async (event) => {
		if (event?.source === "extension") return;
		if (mode === "off") return;
		const text = String(event?.text ?? "").trim().toLowerCase();
		if (DEACTIVATION_PHRASES.has(text)) {
			mode = "off";
			persistState();
			publish();
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (mode === "off") return;
		return { systemPrompt: `${event.systemPrompt}\n\n${BASE_RULESET}\n\n${MODE_TEXT[mode]}` };
	});

	pi.on("session_start", async (_event, _ctx) => {
		// Every session starts at the default level; persisted entries are kept
		// for the events feed but never restore an old mode.
		mode = DEFAULT_MODE;
		publish();
	});
}
