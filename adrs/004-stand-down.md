# ADR-004: Stand Down — persistent behavioral feedback after edit rejection

**Status:** Accepted  
**Date:** 2026-06-11  
**Deciders:** [@kkkiio](https://github.com/kkkiio)

## Context

Architecture mode blocks `edit`/`write` on implementation files. The system prompt
explicitly tells the agent:

> "Do NOT write or modify implementation code."

In practice, agent behavior after a rejected edit varies:

| Behavior | Observed with | Risk |
|---|---|---|
| Stops, explains, aligns with user | Some models | ✅ Desired |
| Tries to bypass via `python3 -c "..."`, `sed -i`, `node -e "..."`, etc. | DeepSeek, others | ❌ Escalation risk |

The bash filter already blocks destructive shell patterns (see
[ADR-002](./002-safe-bash-filtering.md)), but playing whack-a-mole — adding every
possible bypass command to the blocklist — is fragile and endless. A determined
model will always find another vector.

The root problem is behavioral: the model receives a single rejection message,
then the rejection context vanishes. Nothing in the subsequent tool results
reminds it that it's on the wrong track. The model drifts back to its original
intent and tries a different angle.

## Decision

Introduce **stand-down mode**: once the agent is blocked from editing an
implementation file, the system enters a stand-down state for the remainder of
the turn. Every subsequent tool result — regardless of which tool was used —
carries a stand-down message commanding the agent to stop, align with the user,
and await further instruction.

Not a warning. A command to halt.

### Mechanism

Three lifecycle hooks cooperate:

1. **`turn_start`** — reset `standDownThisTurn` to `false`. Each turn starts clean.
2. **`tool_call`** — when `edit` or `write` is blocked on an implementation file,
   or when a `bash` command is blocked for being unsafe, set `standDownThisTurn = true`. Detection and flagging happen in the same hook
   that already handles the rejection.
3. **`tool_result`** — if `standDownThisTurn` is active, prepend the stand-down
   message to the result content before it reaches the model.

No new tool restrictions. No new bash patterns. The mechanism exploits the
agent's own context window: every result becomes a speed bump, breaking the
"try another tool" loop.

### Naming: why `standDownThisTurn`

The `ThisTurn` suffix is intentional and load-bearing. When an LLM reads the
variable name in code or sees the stand-down message, `ThisTurn` explicitly
communicates:

- **Temporary.** This state is scoped to the current turn only. It is not a
  permanent mark, strike, or reputation score against the agent.
- **Self-resolving.** The agent doesn't need to "clear" anything. Stand down,
  align with the user, and the next turn starts fresh.
- **Safe to comply.** There's no shame in triggering it — it's a procedural
  guard, not a judgment. The naming encourages the agent to see it as a
  momentary pause, not a failure.

This matters because models like DeepSeek can react to negative feedback by
getting defensive or doubling down. `standDownThisTurn` frames the intervention
as a lightweight, transient circuit-breaker rather than an accusation.

### Stand-down message

Every tool result in stand-down mode carries this message:

> 🛑 Architecture mode: you were blocked from editing implementation files
> earlier this turn. Stand down — stop and align with the user. Do NOT try
> workarounds with python, sed, bash, or any other tool. Ask the user how
> they want to proceed, or suggest exiting architecture mode with /arch-off.

Key design choices in the message:

- **🛑 emoji** — visually distinct from ⚠️ (warning). A stop sign, not a caution.
- **"Stand down"** — active-voice command, not passive "you were warned."
- **Names the bypass tools explicitly** — prevents "I wasn't using a workaround"
  rationalization by preemptively calling out python, sed, bash.
- **Offers a path forward** — "ask the user" or "suggest /arch-off" gives the
  agent a compliant action to take instead.

### Scope

- **Per-turn only.** `standDownThisTurn` resets to `false` on every `turn_start`.
  A new turn is a clean slate — the agent gets a fresh chance to stay aligned.
- **All successful tool results.** `read`, `bash`, `grep`, `find`, `ls` — every
  successful call gets the stand-down message prepended. Error results from blocked
  `edit`/`write`/`bash` already carry a rejection reason from `tool_call` and pass
  through unchanged; disabled-tool errors are replaced with a friendly message.

## Options Considered

### Option A: Blocklist expansion — add every bypass pattern

Keep adding new patterns to `DESTRUCTIVE_PATTERNS` as bypass vectors are
discovered.

**Pros:** Familiar mechanism. No new hooks needed.

**Cons:** Whack-a-mole. Infinite surface area (interpreters, compilers,
inline scripts, heredocs, encoded payloads, etc.). Each new pattern risks
false positives on legitimate read-only usage. Does not address the
behavioral root cause — a blocked command just means the model tries the next
thing.

### Option B: System prompt hardening

Strengthen the system prompt with stronger language about not bypassing
restrictions.

**Pros:** Zero code changes.

**Cons:** System prompt is global and static. Models ignore or forget it under
enough context pressure. DeepSeek in particular is known to override system
instructions when it strongly wants to complete a code-modification task. A
static instruction cannot match the dynamic, just-in-time feedback of seeing
the consequence in every result.

### Option C: Persistent behavioral feedback — "Stand Down" (chosen)

Inject a persistent stand-down message into every tool result after the first
edit rejection of the turn.

**Pros:**
- Addresses the root cause: the model's context window loses the rejection
  signal over time.
- No new bash patterns needed. Language-agnostic. Works regardless of which
  tool the model tries next.
- Lightweight: a single boolean flag gating a single hook. No new state persistence, no new tool restrictions.
- Resets automatically each turn — no cleanup needed.

**Cons:**
- Consumes context window tokens (one message per tool result). Acceptable
  trade-off: the stand-down message is ~200 tokens and the stand-down state
  only activates after a violation, which should be rare.
- Does not physically prevent bypass — a sufficiently determined model could
  still ignore the repeated messages. Mitigation: the message is designed to
  be unavoidable (it appears in *every* result), making it extremely hard for
  the model to maintain a bypass strategy across multiple tool calls.

### Option D: Hard kill — terminate the turn on edit rejection

Instead of a warning or stand-down, immediately terminate the turn with an
error message when an edit is rejected.

**Pros:** Absolute prevention. No bypass possible.

**Cons:** Too aggressive. Architecture mode is a collaborative discussion space.
The agent might be one `ask_user_question` away from alignment, or the edit
might be an honest mistake (wrong path). Killing the turn destroys productive
context. Stand-down preserves the conversation while applying persistent
pressure to realign.

## Consequences

### Positive

- **Bypass resilience.** The model cannot simply try a different tool and
  leave the rejection behind. Every result reinforces the stand-down order.
- **No new attack surface.** The mechanism doesn't parse or filter commands.
  It operates purely at the tool-result layer, independent of the tool itself.
- **Behavioral, not adversarial.** Stand-down doesn't fight the model — it
  helps the model stay on track by keeping the constraint visible.
- **Minimal footprint.** Adds one boolean and one conditional branch to existing hooks. No new hooks, no new state persistence.
- **Graceful degradation.** If the model genuinely reforms and starts asking
  the user questions, the stand-down message is still present but non-blocking
  — it's a reminder, not a gag.

### Negative

- **Token cost.** Each stand-down message is ~200 tokens × number of tool calls
  in the remainder of the turn. In the worst case (violation early, many tool
  calls), this could add ~2-5K tokens to the context window. Mitigation: the
  state only triggers on a violation, which should be infrequent.
- **Does not distinguish tools.** A `read` result and a `bash` result both
  get the same message, even though `read` is harmless. Intentional: the
  point is persistence, not precision. If we made exceptions, the model would
  learn to only use "harmless" tools to bypass.
- **No physical enforcement.** The model can still ignore the messages.
  However, in practice, a repeated message in every result creates strong
  attentional pressure that models find hard to override.

## Related

- `extensions/arch-mode.ts` — Implementation
- [ADR-001: Allow edit/write in architecture mode](./001-allow-edit-write-in-arch-mode.md)
- [ADR-002: Safe-command filtering for bash](./002-safe-bash-filtering.md)
- [ADR-003: Event-driven extension commands](./003-event-driven-extension-commands.md)
