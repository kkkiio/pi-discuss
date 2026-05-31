# ADR-001: Allow edit/write tools in discussion mode

**Status:** Accepted  
**Date:** 2026-05-30  
**Deciders:** [@kkkiio](https://github.com/kkkiio)

## Context

Discussion mode (`/discuss`) puts the agent into a read-only research mode. The initial implementation restricted tools to `read`, `bash` (safe-only), `grep`, `find`, `ls`, and the custom `ask_user_question` tool. `edit` and `write` were blocked.

During testing, we observed that a pure read-only approach prevents the agent from producing useful written artifacts during discussion:

- **ADR (Architecture Decision Records)**: The agent cannot write the decision it just helped analyze.
- **PRD (Product Requirements Documents)**: The agent cannot record requirements derived from discussion.
- **Implementation plans**: The agent cannot write down the plan it just formulated, forcing the user to manually copy from chat or switch modes.

Blocking `edit`/`write` treats all file modifications as identical, but they are not:

| Modification | Should be blocked? |
|---|---|
| Editing source code (`.ts`, `.rs`, `.py`) | Ideally yes |
| Writing a plan document (`.md`) | No |
| Writing an ADR (`.md` in `adrs/`) | No |
| Updating README with research findings | No |

## Options Considered

### Option A: Keep edit/write blocked (status quo)

**Pros**: Guarantees no accidental code changes; simple to implement.

**Cons**: Strips the agent of a key output medium. Forces mode switching for any written output, breaking the discussion flow. The agent becomes a "talk-only" companion rather than a research partner that produces artifacts.

### Option B: Allow edit/write on `.md` files only (file extension filtering)

**Pros**: Allows documentation while blocking code files.

**Cons**: File extension is a poor signal. `.ts` files can be pure type declarations, `.json` can be configuration documentation, `.rs` files can be plan drafts. Conversely, `.md` files can contain harmful instructions. Maintaining an accurate extension blocklist/allowlist is high maintenance and fragile.

### Option C: Allow edit/write, guide via system prompt (chosen)

**Pros**: Gives the agent full expressive power. Behavior is constrained by the discussion system prompt, which explicitly instructs the agent to write documentation and plans but not implementation code. Modern LLMs are capable of understanding and following this distinction.

**Cons**: Relies on LLM judgment rather than a hard rule. An LLM in a confused state could potentially modify source code.

## Decision

**Allow `edit` and `write` in discussion mode, constrained by the system prompt.**

The system prompt explicitly states:

> You may write documentation, design documents, and plans. Do NOT write or modify implementation code. If unsure whether a change counts as implementation, ask the user.

Bash remains restricted to safe read-only commands, as bash commands are unbounded in their destructive potential (`git reset --hard`, `rm -rf`, etc.).

## Consequences

### Positive

- Agent can produce ADRs, PRDs, implementation plans, and research summaries during discussion without mode switching.
- Discussion mode becomes a self-contained research + documentation workflow.
- No fragile file extension filtering to maintain.

### Amendment (2026-05-30)

After testing, we found that system prompt alone was insufficient — the agent frequently ignored the "do not modify implementation code" instruction and started editing source files. We added **file extension filtering** as a hard block: `edit`/`write` is only allowed on `.md`, `.mdx`, `.txt`, `.html` files. Other extensions get an immediate block with guidance to write Markdown instead.

This does not change the core decision (edit/write are allowed), but adds a lightweight enforcement layer. The "no fragile filtering" claim was wrong — a small allowlist of document extensions is simpler and more effective than relying entirely on LLM instruction-following.

### Negative

- An LLM that ignores the system prompt could modify source code. Mitigated by: the discussion system prompt is injected every turn; file extension filtering blocks writes to implementation files; bash safety filtering prevents destructive shell-based changes.
- Users who want a guaranteed no-modification mode will need a separate "strict discussion" variant (out of scope for now).

## Bash safety filtering retained

This decision only affects `edit` and `write`. The safe-command filtering on `bash` is retained because:

1. Bash commands are unbounded — one `git reset --hard` can discard uncommitted work.
2. When an LLM hits a tool block, it tends to try alternative approaches aggressively. If bash were unrestricted, a confused LLM could cycle through destructive commands seeking a workaround.
3. Safe bash provides the read-only exploration capability that is core to discussion mode (`cat`, `ls`, `grep`, `find`, `git log`, `git diff`).

## Related

- `extensions/discussion-mode.ts` — `DISCUSSION_TOOLS` constant and `DISCUSSION_SYSTEM_PROMPT`
- `tests/discussion-flow.test.ts` — E2E tests verifying discussion mode behavior
