# @alvaroak/pi-ponytail

Lazy senior dev mode with **intensity levels** for the [Pi coding agent](https://github.com/earendil-works/pi).

The ruleset comes from [@dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail) (MIT) — a skill the model reads when it notices the task matches. This extension turns that document into an **enforced runtime state**: the ruleset is injected into the system prompt every turn, so it cannot drift away mid-session.

## Why an extension instead of the skill

- **Guaranteed persistence** — system-prompt injection every turn; no reliance on the model re-reading a skill, no silent drift.
- **Intensity levels** — the original is one static ruleset; this adds `lite`, `full`, and `ultra` tiers.
- **State survives resumes** — mode is persisted in the session and restored on resume; new sessions start at `full`.
- **Reliable off-switch** — "stop ponytail" / "normal mode" as a standalone message is intercepted directly.
- **Ecosystem surface** — publishes `ponytail:changed` over `pi.events` so status footers can show the current mode.

## Usage

```bash
/ponytail            # status
/ponytail lite       # gentle nudge
/ponytail full       # the standard ruleset (default)
/ponytail ultra      # aggressively minimal
/ponytail off        # off
```

## Install

```bash
pi install git:github.com/Alvaroak/pi-ponytail@v0.1.0
```

## Credits

Ruleset adapted from [@dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail) (MIT).

## License

MIT
