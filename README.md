# pi-arch-mode

A Pi extension that puts the coding agent into **architecture mode** — a mode for deep exploration, collaborative thinking, and decision-making. The agent reads your codebase, asks clarifying questions, and when clarity is reached, records key decisions that can drive future development.

## Installation

```bash
pi install npm:@kkkiio/pi-arch-mode
```

Or install from git:

```bash
pi install git:github.com/kkkiio/pi-arch-mode
```

Or install locally for development:

```bash
# cd /path/to/pi-arch-mode
pi install .
```

## Usage

Enter architecture mode:

```
/arch
```

Or enter with a topic:

```
/arch I need to figure out how to handle multi-tenant data isolation
```

Exit architecture mode:

```
/arch-off
```

In architecture mode, the agent:

- Explores your codebase to understand the current state
- Asks structured clarifying questions via the `ask_user_question` tool
- Surfaces hidden assumptions and trade-offs
- Can write design documents (`.md`, `.mdx`, `.txt`, `.html`) when decisions are reached
- Cannot modify implementation code (`.ts`, `.js`, `.rs`, `.py`, `.go`, etc.)

The status bar shows `🏗️ arch mode` while active.

### Example session

```
You: /arch I need to figure out how to handle multi-tenant data isolation

Agent: [reads db/schema.ts, middleware/tenant.ts, config/]
       I've reviewed the current database schema and tenant middleware.
       Before I think through the options, let me ask a few things. [uses ask_user_question]

You:    [answers: Postgres RLS, shared tables, strict isolation]

Agent: Given your constraints, row-level security with shared tables is the
       right call. The trade-off is that all queries must include tenant
       context — I'll note this as a core constraint in an ADR.
       [writes adrs/005-multi-tenant-isolation.md]

       Key decisions recorded. Run /arch-off when you're ready to move forward.

You: /arch-off
```

## Features

- **Exploration-first**: Agent reads and understands before suggesting, not the other way around
- **Structured Q&A**: Custom `ask_user_question` tool lets the agent ask clarifying questions with selectable options
- **Decision recording**: Agent can write ADRs, PRDs, and design notes when alignment is reached
- **Safe by default**: Implementation code is write-protected; bash is restricted to safe commands
- **State persistence**: Architecture mode state survives session restarts and `/fork`

## Relationship to automated development loops

Architecture mode is designed to be the **upstream input** for automated agent workflows ("Loop"): align on goals, constraints, and key decisions here, then let automated loops decompose tasks, write code, review, and iterate based on those decisions.

## Development

See [AGENTS.md](./AGENTS.md) for contributor documentation.
