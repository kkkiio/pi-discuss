# pi-discuss

A Pi extension that puts the coding agent into **discussion mode** — a read-only, research-focused mode where the agent explores your codebase and asks clarifying questions before making any changes.

## Installation

```bash
pi install npm:@kkkiio/pi-discuss
```

Or install from git:

```bash
pi install git:github.com/kkkiio/pi-discuss
```

Or install locally for development:

```bash
# cd /path/to/pi-discuss
pi install .
```

## Usage

Enter discussion mode:

```
/discuss
```

Or enter with a topic:

```
/discuss How should I refactor the auth module?
```

Exit discussion mode:

```
/discuss off
/discuss exit
```

The agent enters discussion mode:

- Only read-only tools are available (`read`, `bash`, `grep`, `find`, `ls`)
- Bash is restricted to safe commands (no `rm`, `mv`, `git commit`, etc.)
- The custom `ask_user_question` tool lets the agent ask you structured clarifying questions
- The status bar shows "💬 discussing"

### Example session

```
You: /discuss How should I add rate limiting to the API?

Agent: [reads server.ts, middleware/, config/]
       I can see the middleware pattern in middleware/auth.ts. Before I propose a design,
       let me ask a few questions. [uses ask_user_question]

Agent: Based on your answers (Redis, per-IP, 100 req/min), here's my recommendation:
       1. Create middleware/rate-limit.ts using express-rate-limit
       2. Configure limits in config/rate-limit.ts
       3. Apply globally in server.ts
       Run /discuss off to start implementing.

You: /discuss off

Agent: [now has full tool access, starts implementing]
```

## Features

- **Read-only research**: Agent explores the codebase without making changes
- **Structured Q&A**: Custom `ask_user_question` tool for interactive clarifying questions
- **Safe bash**: Destructive commands are blocked automatically
- **State persistence**: Discussion mode state survives `/fork` and session restarts
