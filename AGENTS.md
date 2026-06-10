# pi-arch-mode Agent Guide

Architecture mode extension for Pi — collaborative exploration, alignment, and decision-making.

**Location:** `AGENTS.md` at the repository root.

## Table of Contents

1. [Policies & Mandatory Rules](#policies--mandatory-rules)
2. [Project Structure Guide](#project-structure-guide)
3. [Operation Guide](#operation-guide)

## Policies & Mandatory Rules

### Tool Safety Rules

When modifying `extensions/arch-mode.ts`:

- `DESTRUCTIVE_PATTERNS` and `SAFE_PATTERNS` arrays must remain comprehensive. Every new destructive command pattern added to `DESTRUCTIVE_PATTERNS` requires a corresponding safe alternative in `SAFE_PATTERNS` if one exists.
- The `isSafeCommand` function must always return `false` for commands not explicitly in `SAFE_PATTERNS`.
- `edit` and `write` in `ARCH_TOOLS` are guarded by `isWriteablePath` in the `tool_call` hook. Any new tool added to `ARCH_TOOLS` that can modify files requires a corresponding guard.

### State Persistence Rules

- State is persisted via `pi.appendEntry(STATE_ENTRY_TYPE, ...)` on every state change.
- State is restored in `session_start` from `ctx.sessionManager.getEntries()`.
- The `previousTools` array is NOT persisted — it's in-memory only and rebuilt on restore from `pi.getActiveTools()`.

### API Consistency

- All `pi.on()` handlers must match the documented event signatures exactly (event, ctx).
- The `ask_user_question` tool parameters must validate questions: 1-3 questions, each with 2-4 options.
- Tool answers format: `{ [id: string]: string }` where id is the snake_case question id.

## Project Structure Guide

### Overview

A single-file Pi extension that registers a command, a custom tool, and lifecycle event handlers to implement architecture mode.

### Repo Structure & Important Files

- `package.json` — Package metadata with `keywords: ["pi-package"]` and `peerDependencies`
- `extensions/arch-mode.ts` — Full implementation (command, tool, events, bash filtering)
- `extensions/guardrail.ts` — Bash safety filter and writeable-path guard
- `tests/arch-flow.test.ts` — E2E tests using pi RPC mode
- `justfile` — Dev recipes (`just fmt`, `just check`, `just test`)
- `biome.json` — Biome format/lint config
- `adrs/` — Architecture Decision Records
- `README.md` — User-facing documentation
- `AGENTS.md` — This file

### Architecture

The extension follows the plan-mode pattern from Pi's examples:

1. **Command handlers**:
   - `/arch [topic]`: TUI entry point, enters mode, accepts optional topic
   - `/arch-off`: Exits architecture mode
2. **Event listeners** (`pi.events`): Handle extension-to-extension RPC
   - `cmd:arch:enter` — enter architecture mode (no payload)
   - `cmd:arch:exit` — exit architecture mode (no payload)
   - `arch:state-changed` — broadcast on state change
3. **Tool registration** (`ask_user_question`): Structured Q&A tool, only active in architecture mode
4. **Lifecycle events**:
   - `session_start`: Restore persisted state, bridge `ExtensionContext`, broadcast initial state
   - `session_shutdown`: Clear status UI
   - `before_agent_start`: Inject architecture system prompt
   - `tool_call`: Guard edit/write to documentation-only files; restrict bash to safe commands
   - `tool_result`: Improve error messages for disabled tools

### Key Design Decisions

- **`ask_user_question` is only active during architecture mode**: It's added to `ARCH_TOOLS` and removed when mode exits. This prevents the LLM from blocking during normal task execution.
- **Tool restriction uses `pi.setActiveTools`/`pi.getActiveTools`**: Same approach as pi-plan-mode. Save current tools on enter, restore on exit.
- **State persisted via `pi.appendEntry`**: Survives `/fork` (entries are copied to the new session).
- **Bash filtering uses allowlist + blocklist**: Commands must NOT match destructive patterns AND must match a safe pattern.
- **`/arch` enters, does NOT toggle**: Toggle is anti-pattern for slash commands. Use `/arch` to enter, `/arch-off` to exit.

### System Prompt Design

The system prompt deliberately avoids framing document output as a mandatory step. The agent's primary goal is **understanding and alignment**. Writing documents (ADRs, PRDs, design notes) is an available tool, used when clarity is reached — not a required checkpoint.

## Operation Guide

### Prerequisites

- Pi coding agent (`@earendil-works/pi-coding-agent`) installed
- Node.js runtime (for jiti TypeScript loading)
- Node.js 22+ (for native TypeScript stripping in tests)

### Development Workflow

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Format and lint**:

   ```bash
   just fmt
   just check
   ```

3. **Run tests**:

   ```bash
   just test
   ```

4. **Test the extension manually**:

   ```bash
   pi -e ./extensions/arch-mode.ts
   ```

5. **Test architecture mode enter/exit**:

   ```
   /arch
   # Status shows "🏗️ arch mode"
   /arch-off
   # Mode turned off
   ```

### Testing & Automated Checks

#### E2E Tests (pi RPC mode)

```bash
just test
```

Tests use pi's `--mode rpc` to spawn a headless pi instance with the extension loaded. Commands execute immediately without LLM calls.

**Test coverage**:
- Extension starts with architecture mode OFF
- `/arch` enters architecture mode
- `/arch-off` exits architecture mode
- Re-entering mode shows "Already" notification

**Test architecture**:
- Spawns `pi --mode rpc --no-session --offline -e <ext>`
- Communicates via JSONL over stdin/stdout
- Verifies state transitions via `ctx.ui.notify()` messages (emitted as `extension_ui_request` events)

### Utilities & Tips

- Fast iteration: `pi -e ./extensions/arch-mode.ts` for quick testing without installation
- After code changes, use `/reload` to pick up changes without restarting pi
- If `ask_user_question` hangs, check that `ctx.ui.select()` is available (non-print mode)
