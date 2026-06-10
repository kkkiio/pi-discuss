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

### Option C: Allow edit/write on document files only (chosen)

**Pros**: Allows the agent to produce written artifacts (ADRs, plans, notes) while blocking modifications to implementation code.

**Cons**: File extension is an imperfect signal. `.ts` files can be type declarations, `.md` files can contain instructions that cause harm if run. However, a small allowlist of document extensions strikes a pragmatic balance.

## Decision

**Allow `edit` and `write` in discussion mode, constrained by file extension filtering and system prompt guidance.**

Two layers of enforcement:

| Layer | Mechanism | What it blocks |
|---|---|---|
| Hard block | File extension allowlist | `tool_call` hook rejects `edit`/`write` on paths not ending in `.md`, `.mdx`, `.txt`, `.html` |
| Soft guidance | System prompt | Instructs the agent to write documentation and plans, not implementation code |

The system prompt states:

> You may write documentation, design documents, and plans. Do NOT write or modify implementation code. If unsure whether a change counts as implementation, ask the user.

Bash remains restricted to safe read-only commands, as bash commands are unbounded in their destructive potential (`git reset --hard`, `rm -rf`, etc.).

## Consequences

### Positive

- Agent can produce ADRs, PRDs, implementation plans, and research summaries during discussion without mode switching.
- File extension filtering prevents accidental source code modifications even if the LLM ignores the system prompt.
- Discussion mode becomes a self-contained research + documentation workflow.

### Negative

- File extension filtering can produce false negatives (a `.ts` file containing only type declarations is blocked). Mitigation: the block message guides the agent to write Markdown instead and ask the user if they want to proceed.
- An LLM that both ignores the system prompt AND targets a document file extension could produce harmful output. Mitigation: bash safety filtering prevents destructive shell execution; the user reviews written files.
- Users who want a guaranteed no-modification mode need a separate "strict discussion" variant (out of scope).

## What is NOT changed

Bash safety filtering ([ADR-002](./002-safe-bash-filtering.md)) is retained unchanged. This decision only affects `edit` and `write`. Bash remains restricted because:

1. Bash commands are unbounded — one `git reset --hard` can discard uncommitted work.
2. When an LLM hits a tool block, it tends to try alternative approaches aggressively. If bash were unrestricted, a confused LLM could cycle through destructive commands seeking a workaround.
3. Safe bash provides the read-only exploration capability that is core to discussion mode (`cat`, `ls`, `grep`, `find`, `git log`, `git diff`).

## Related

- `extensions/discussion-mode.ts` — `DISCUSSION_TOOLS` constant and `DISCUSSION_SYSTEM_PROMPT`
- `tests/discussion-flow.test.ts` — E2E tests verifying discussion mode behavior
