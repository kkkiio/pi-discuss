# ADR-002: Safe-command filtering for bash in discussion mode

**Status:** Accepted  
**Date:** 2026-05-30  
**Deciders:** [@kkkiio](https://github.com/kkkiio)

## Context

Discussion mode restricts bash to safe, read-only commands. This is a safety net — the agent should explore and discuss, not execute destructive operations, even accidentally.

The filtering uses a **dual-pattern approach** (blocklist + allowlist) borrowed from pi-plan-mode.

## Decision

A bash command is allowed only if it passes **both** checks:

| Check | Logic |
|---|---|
| **DESTRUCTIVE_PATTERNS** (blocklist) | Command must NOT match any destructive pattern |
| **SAFE_PATTERNS** (allowlist) | Command must match at least one safe pattern |

If a command matches no destructive pattern but also matches no safe pattern, it is blocked. This conservative design ensures that unknown commands are treated as unsafe by default.

### DESTRUCTIVE_PATTERNS (blocklist)

Patterns that are always rejected:

| Category | Examples |
|---|---|
| File removal | `rm`, `rmdir`, `shred` |
| File modification | `mv`, `cp`, `mkdir`, `touch`, `chmod`, `chown`, `chgrp`, `ln`, `tee`, `truncate`, `dd` |
| Package managers (write ops) | `npm install`, `pip install`, `brew install`, `apt-get install` |
| Git (write ops) | `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git checkout`, `git stash` |
| Privilege escalation | `sudo`, `su` |
| Process termination | `kill`, `pkill`, `killall` |
| System control | `reboot`, `shutdown`, `systemctl start/stop`, `service start/stop` |
| Editors | `vim`, `nano`, `emacs`, `code`, `subl` |

### SAFE_PATTERNS (allowlist)

Commands explicitly allowed (must match `^\s*<cmd>\b`):

| Category | Commands |
|---|---|
| File reading | `cat`, `head`, `tail`, `less`, `more`, `bat` |
| Search | `grep`, `rg`, `find`, `fd` |
| Listing | `ls`, `eza`, `tree` |
| Path/identity | `pwd`, `which`, `whereis`, `type`, `whoami`, `id` |
| Environment | `env`, `printenv`, `uname` |
| System info | `date`, `cal`, `uptime`, `ps`, `top`, `htop`, `free`, `du`, `df` |
| File info | `file`, `stat`, `wc`, `sort`, `uniq`, `diff` |
| Output | `echo`, `printf` |
| Git (read-only) | `git status`, `git log`, `git diff`, `git show`, `git branch`, `git remote`, `git config --get`, `git ls-*` |
| Package managers (read-only) | `npm list/ls/view/info/search/outdated/audit`, `yarn list/info/why/audit` |
| Version checks | `node --version`, `python --version` |
| HTTP (read-only) | `curl`, `wget -O -` |
| Text processing | `jq`, `sed -n`, `awk` |

## What changed from plan-mode

Two patterns were removed from the blocklist because `edit` and `write` are now available in discussion mode (see [ADR-001](./001-allow-edit-write-in-discussion-mode.md)), making shell redirection unnecessary to gate:

| Removed pattern | Reason |
|---|---|
| `/(^|[^<])>(?!>)/` | `>` redirection is equivalent to `write` tool |
| `/>>/` | `>>` append is equivalent to `edit`/`write` tool |

All other patterns are retained unchanged.

## Consequences

- Commands with harmless redirections (`pwd 2>/dev/null`, `echo foo > /tmp/bar`) no longer trigger false positives.
- The agent cannot escalate to destructive shell operations even if it ignores the system prompt.
- Edges cases exist: `git stash`, `git checkout` are blocked but are sometimes used in read-only ways. Mitigation: the block message now guides the agent to explain what it was trying to do, letting the human decide.

## Related

- `extensions/guardrail.ts` — `DESTRUCTIVE_PATTERNS`, `SAFE_PATTERNS`, `isSafeCommand()`
- `extensions/discussion-mode.ts` — imports `isSafeCommand` from guardrail
- [ADR-001: Allow edit/write in discussion mode](./001-allow-edit-write-in-discussion-mode.md)
