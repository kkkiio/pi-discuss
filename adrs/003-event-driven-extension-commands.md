# ADR-003: Event-driven extension commands (replace input event interception)

**Status:** Accepted  
**Date:** 2026-06-10  
**Deciders:** [@kkkiio](https://github.com/kkkiio)

## Context

Architecture mode exposes a `/arch` slash command. When the user types `/arch`
in the terminal, `pi.registerCommand("arch", ...)` handles it. No problem.

The problem is when **another extension** (e.g. a Web UI) wants to trigger
architecture mode. There were two approaches in play:

### Status quo: input event interception

```typescript
pi.on("input", async (event, ctx) => {
  if (!event.text.startsWith("/arch")) return;
  if (event.source !== "extension") return;
  // parse and handle...
  return { action: "handled" };
});
```

This exists because pi skips `pi.registerCommand` handlers when the message
source is `"extension"` (i.e. sent via `pi.sendUserMessage()`). The input handler
acts as a workaround — it catches `/arch` commands that arrive through the
extension-source message pipeline.

**Problems:**

- **Semantic mismatch.** The input handler is intercepting a user-facing event to
  serve as an ad-hoc extension RPC mechanism.
- **String parsing fragility.** The caller must construct a valid slash-command
  string (`"/arch some topic"`) and the receiver must parse it back.
- **No structured payload.** Topic text is the only data that can pass through.
- **Not generalizable.** Every extension that wants to expose actions to other
  extensions would need its own input event parser, with potential conflicts.

### Proposed: `pi.events` event bus

```typescript
// Other extension sends a request
pi.events.emit("cmd:arch:enter", { topic: "重构 auth" });

// Arch extension handles it
pi.events.on("cmd:arch:enter", (data) => {
  const { topic } = data as { topic?: string };
  enterMode(savedCtx, topic);
});
```

Pi exposes `pi.events` — a shared event bus — explicitly for extension-to-extension
communication. The `on()` method returns an unsubscribe function.

## Decision

**Replace the input event interception with `pi.events` listeners.**

The `pi.on("input", ...)` handler is removed. Architecture mode accepts external
triggers through two event channels:

| Channel | Direction | Meaning |
|---|---|---|
| `cmd:arch:enter` | External → arch | Request to enter architecture mode |
| `cmd:arch:exit` | External → arch | Request to exit architecture mode |

State changes are broadcast for any interested listener:

| Channel | Direction | Meaning |
|---|---|---|
| `arch:state-changed` | Arch → all | Architecture mode state changed |

### Event naming convention

```
cmd:{domain}:{verb}     → Request (command): "please do X"
{domain}:{verb}         → Notification (event): "X happened"
```

`cmd:` prefix marks a request/command channel. Without prefix, the channel
reports that something has already occurred. This separates the two distinct
semantics that `pi.events` carries:

| Type | Channel pattern | Semantics | Direction |
|---|---|---|---|
| Command | `cmd:*` | "Please perform this action" | Point-to-point (targets a specific extension) |
| Event | `*:*` (no `cmd:` prefix) | "This state has changed" | Broadcast (anyone may listen) |

### Payload design

```typescript
// → cmd:arch:enter
interface ArchEnterPayload {
  topic?: string;
}

// → cmd:arch:exit
// (no payload needed)

// ← arch:state-changed
interface ArchStateChanged {
  enabled: boolean;
  topic?: string;
}
```

### Context bridging

`pi.events.on` callbacks do not receive `ExtensionContext`. The official event-bus
example solves this by saving `ctx` from `session_start`:

```typescript
let savedCtx: ExtensionContext | undefined;

pi.on("session_start", async (_event, ctx) => {
  savedCtx = ctx;
  // restore persisted state...
  // broadcast initial state
  if (state.enabled) {
    pi.events.emit("arch:state-changed", { enabled: true, topic: currentTopic });
  }
});

pi.events.on("cmd:arch:enter", (data) => {
  if (!savedCtx) return;
  enterMode(savedCtx, data.topic);
});
```

`pi.events.on` handlers are registered in the extension factory. Factories run to
completion before any `session_start` handler fires. Therefore all event listeners
are active before arch broadcasts its initial state — no ordering race.

### Registration timing

Event listeners MUST be registered at factory top-level, not inside
`session_start`. This guarantees they are active before any `session_start`
handler runs and emits events.

## Options Considered

### Option A: Keep input interception (status quo)

**Pros:** Already works. No changes needed.

**Cons:** String parsing, semantic mismatch, not generalizable. Couples the
arch extension to pi's message pipeline internals.

### Option B: Use `pi.events` with request-response pattern

Each command would have a matching `:result` response channel, and callers would
await a correlated response.

**Pros:** Callers get explicit confirmation. Errors are propagated.

**Cons:** Complexity (timeouts, correlation IDs, listener cleanup). Unnecessary
for architecture mode where enter/exit are idempotent and state is visible via the
`state-changed` broadcast. The caller can infer success from the broadcast.

### Option C: Use `pi.events` with fire-and-forget + broadcast (chosen)

Commands are fire-and-forget. The arch extension broadcasts state changes.
Callers subscribe to the broadcast to stay in sync.

**Pros:** Simple. No correlation IDs, no timeouts, no cleanup. Natural fit for
idempotent mode toggle operations.

**Cons:** Callers cannot distinguish "request received but failed" from
"request never received." For this use case, the failure mode is acceptable:
if the arch extension is not loaded, the mode won't change and the broadcast
won't fire — the caller's UI simply won't update, which is the correct behavior.

### Option D: Pi core enhancement — `pi.invokeCommand()` API

Pi could add an API to invoke a registered command by name from another extension:

```typescript
pi.invokeCommand("arch", "重构 auth");
```

**Pros:** Cleanest abstraction. No events needed for this use case.

**Cons:** Does not exist today. Requires pi upstream changes. Out of scope for
this ADR.

## Consequences

### Positive

- **Clean semantics.** Commands are commands, events are events. The channel
  naming makes intent explicit.
- **Structured payloads.** No string parsing. Callers pass typed objects.
- **Generalizable.** The `cmd:{domain}:{verb}` / `{domain}:{verb}` convention
  can be adopted by any extension. Web UIs can discover supported commands
  through a consistent pattern.
- **No new dependencies.** `pi.events` is already available in the ExtensionAPI.
- **Input pipeline is no longer coupled.** Removing the input handler eliminates
  a workaround that relied on pi's internal message routing behavior.

### Negative

- **`pi.events` has no type safety.** Channels and payloads are untyped
  (`string`, `unknown`). Callers and handlers must agree on the contract
  through documentation, not the compiler.
- **No built-in error propagation.** If a command handler throws, the caller
  has no way to know. For architecture mode this is acceptable — state changes are
  visible through the broadcast. For extensions that need error feedback, a
  request-response pattern with `:result` channels can be added later without
  breaking the convention.
- **Context bridging is manual.** Every extension that needs `ExtensionContext`
  in its event handlers must implement the `savedCtx` pattern from
  `session_start`. This is a known pattern (demonstrated in pi's official
  event-bus example) but still boilerplate.

## What is removed

The `pi.on("input", ...)` handler and the `handleArchCommand` function in
`arch-mode.ts` are removed entirely. The arg-parsing logic that checked
for `"off"` / `"exit"` substrings is eliminated — that behavior is now served
by a separate `/arch-off` command.

Slash commands from user input (`/arch`, `/arch-off`) work through
dedicated `pi.registerCommand` registrations.

## Related

- `extensions/arch-mode.ts` — Implementation
- [pi event-bus example](https://github.com/earendil-works/pi-coding-agent/blob/main/packages/coding-agent/examples/extensions/event-bus.ts) — Official example demonstrating the `savedCtx` pattern
- [pi-web-ui ADR-0002](../pi-web-ui/adrs/0002-web-ui-extension-event-protocol.md) — Thin event forwarding and naming conventions for Web UI integration
